"use strict";

const router = require("express").Router();
const { query, pool } = require("../config/db");
const { protect, adminOnly } = require("../middleware/auth");
const { ensureAccountActivitySchema } = require("../utils/accountActivity");

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
};

// Users can only read their own immutable activity history.
router.get("/my", protect, async (req, res) => {
  try {
    await ensureAccountActivitySchema();
    const userId = req.user?.id;
    if (!userId || req.userType === "admin") return res.status(401).json({ success: false, message: "A traveller account is required." });
    const page = clampInt(req.query.page, 1, 1, 100000);
    const limit = clampInt(req.query.limit, 20, 1, 50);
    const offset = (page - 1) * limit;
    const params = [userId, limit, offset];
    const [items, total, requests] = await Promise.all([
      query(`SELECT id, event_type, title, description, outcome, metadata, created_at
               FROM account_activity_logs
              WHERE user_id = $1
              ORDER BY created_at DESC
              LIMIT $2 OFFSET $3`, params),
      query(`SELECT COUNT(*)::int AS total FROM account_activity_logs WHERE user_id = $1`, [userId]),
      query(`SELECT id, activity_id, reason, status, created_at, reviewed_at
               FROM account_activity_deletion_requests
              WHERE requester_id = $1
              ORDER BY created_at DESC LIMIT 20`, [userId]),
    ]);
    return res.json({
      success: true,
      data: items.rows,
      pagination: { page, limit, total: total.rows[0]?.total || 0 },
      deletionRequests: requests.rows,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not load account activity." });
  }
});

// A user may request review, but cannot delete or alter the activity record.
router.post("/my/:activityId/deletion-request", protect, async (req, res) => {
  try {
    await ensureAccountActivitySchema();
    const userId = req.user?.id;
    const activityId = Number.parseInt(req.params.activityId, 10);
    if (!userId || req.userType === "admin") return res.status(401).json({ success: false, message: "A traveller account is required." });
    if (!Number.isSafeInteger(activityId) || activityId < 1)
      return res.status(400).json({ success: false, message: "Invalid activity record." });

    const owned = await query(
      "SELECT id FROM account_activity_logs WHERE id = $1 AND user_id = $2",
      [activityId, userId],
    );
    if (!owned.rows[0]) return res.status(404).json({ success: false, message: "Activity record not found." });

    const pending = await query(
      `SELECT id FROM account_activity_deletion_requests
        WHERE activity_id = $1 AND requester_id = $2 AND status = 'pending' LIMIT 1`,
      [activityId, userId],
    );
    if (pending.rows[0])
      return res.status(409).json({ success: false, message: "A review request is already pending." });

    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    const created = await query(
      `INSERT INTO account_activity_deletion_requests (activity_id, requester_id, reason)
       VALUES ($1,$2,$3) RETURNING id, activity_id, reason, status, created_at`,
      [activityId, userId, reason],
    );
    return res.status(201).json({ success: true, data: created.rows[0], message: "Your request was sent to an administrator for review." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not submit the review request." });
  }
});

// Admin-only review queue.
router.get("/admin/deletion-requests", protect, adminOnly, async (_req, res) => {
  try {
    await ensureAccountActivitySchema();
    const result = await query(
      `SELECT r.id, r.activity_id, r.requester_id, r.reason, r.status, r.created_at,
              u.email AS requester_email, a.event_type, a.title, a.created_at AS activity_created_at
         FROM account_activity_deletion_requests r
         LEFT JOIN users u ON u.id = r.requester_id
         LEFT JOIN account_activity_logs a ON a.id = r.activity_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at ASC LIMIT 200`,
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not load deletion requests." });
  }
});

router.patch("/admin/deletion-requests/:requestId", protect, adminOnly, async (req, res) => {
  const requestId = Number.parseInt(req.params.requestId, 10);
  const decision = String(req.body?.decision || "").toLowerCase();
  if (!Number.isSafeInteger(requestId) || requestId < 1 || !["approve", "reject"].includes(decision))
    return res.status(400).json({ success: false, message: "A valid request and approve/reject decision are required." });

  let client;
  try {
    await ensureAccountActivitySchema();
    client = await pool.connect();
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT r.*, a.user_id, a.event_type, a.title, a.created_at AS activity_created_at FROM account_activity_deletion_requests r LEFT JOIN account_activity_logs a ON a.id = r.activity_id WHERE r.id = $1 AND r.status = 'pending' FOR UPDATE OF r",
      [requestId],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Pending request not found." });
    }

    if (decision === "approve" && row.user_id) {
      await client.query(
        "INSERT INTO account_activity_deletion_audit (activity_id, user_id, event_type, title, activity_created_at, requester_id, reviewer_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [row.activity_id, row.user_id, row.event_type, row.title, row.activity_created_at, row.requester_id, req.user.id, row.reason || ""],
      );
      await client.query("DELETE FROM account_activity_logs WHERE id = $1", [row.activity_id]);
    }

    const updated = await client.query(
      "UPDATE account_activity_deletion_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3 AND status = 'pending' RETURNING id, status, reviewed_by, reviewed_at",
      [decision === "approve" ? "approved" : "rejected", req.user.id, requestId],
    );
    if (!updated.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Request was already reviewed." });
    }
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ success: false, message: "A pending review request already exists for this record." });
    return res.status(500).json({ success: false, message: "Could not review the deletion request." });
  } finally {
    client?.release();
  }
});

module.exports = router;
