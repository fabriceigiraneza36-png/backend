"use strict";

const crypto = require("crypto");
const { query } = require("../config/db");

let schemaReady = null;
const PROVIDERS = new Set(["google", "github", "facebook", "passkey", "email", "authenticator", "recovery_code", "unknown"]);
const CATEGORIES = new Set([
  "configuration", "network", "provider_denied", "invalid_credential",
  "identity_mismatch", "email_missing", "account_not_found",
  "account_deactivated", "rate_limited", "challenge_expired",
  "challenge_invalid", "passkey_unsupported", "passkey_cancelled",
  "verification_failed", "validation", "unexpected",
]);

const clean = (value, max = 240) => String(value ?? "")
  .replace(/[\r\n\t]+/g, " ")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
  .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
  .replace(/(access_token|id_token|credential|client_secret|code)=([^&\s]+)/gi, "$1=[redacted]")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const safeCode = (value) => clean(value, 90).replace(/[^A-Za-z0-9_.:-]/g, "_") || "AUTH_FAILURE";
const safeProvider = (value) => PROVIDERS.has(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "unknown";
const safeCategory = (value) => CATEGORIES.has(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "unexpected";
const safeStage = (value) => clean(value, 80).replace(/[^A-Za-z0-9_./:-]/g, "_") || "unknown";

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS auth_diagnostics (
          id BIGSERIAL PRIMARY KEY,
          reference_id VARCHAR(64) NOT NULL UNIQUE,
          provider VARCHAR(24) NOT NULL DEFAULT 'unknown',
          stage VARCHAR(90) NOT NULL DEFAULT 'unknown',
          category VARCHAR(40) NOT NULL DEFAULT 'unexpected',
          error_code VARCHAR(100) NOT NULL DEFAULT 'AUTH_FAILURE',
          source VARCHAR(16) NOT NULL DEFAULT 'server',
          severity VARCHAR(12) NOT NULL DEFAULT 'warning',
          http_status INTEGER,
          message VARCHAR(300) NOT NULL DEFAULT 'Authentication could not be completed.',
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          page_path VARCHAR(240),
          origin VARCHAR(180),
          user_agent VARCHAR(500),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_auth_diagnostics_created
        ON auth_diagnostics(created_at DESC)
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_auth_diagnostics_provider_created
        ON auth_diagnostics(provider, created_at DESC)
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const normalizeDetails = (value) => {
  const src = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const safe = {};
  for (const key of ["errorName", "clientCode", "browser", "os", "online", "attempt", "expectedOrigin", "actualOrigin"]) {
    if (src[key] === undefined || src[key] === null) continue;
    safe[key] = typeof src[key] === "boolean" ? src[key] : clean(src[key], 120);
  }
  return safe;
};

const classifyCategory = (code, message, status) => {
  const value = `${String(code || "")} ${String(message || "")}`.toLowerCase();
  if (/not configured|missing .*client|oauth.*configuration|client id/.test(value)) return "configuration";
  if (String(code || "") === "23505" || /duplicate key|unique constraint|state mismatch|identity mismatch|different account|already linked|origin mismatch|rp id|relying party|audience/.test(value)) return "identity_mismatch";
  if (/email.*(missing|required|not returned)|could not retrieve email/.test(value)) return "email_missing";
  if (/rate limit|too many|cooldown|wait .*second/.test(value) || Number(status) === 429) return "rate_limited";
  if (/expired|timeout|timed out/.test(value)) return "challenge_expired";
  if (/cancel|dismissed|user aborted/.test(value)) return "passkey_cancelled";
  if (/not supported|unsupported|publickeycredential/.test(value)) return "passkey_unsupported";
  if (/account not found|couldn't find an altuvera account/.test(value) || Number(status) === 404) return "account_not_found";
  if (/deactivated|disabled account/.test(value) || Number(status) === 403) return "account_deactivated";
  if (/network|failed to fetch|connection|offline|enotfound|econn/.test(value)) return "network";
  if (/credential|token|signature|invalid assertion|invalid code|incorrect code|verification failed/.test(value) || Number(status) === 401) return "invalid_credential";
  if (/challenge/.test(value)) return "challenge_invalid";
  if (/provider denied|access_denied/.test(value)) return "provider_denied";
  if (/invalid email|email.*invalid|name.*required/.test(value)) return "validation";
  return "unexpected";
};

const createReferenceId = () => `AUTH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

async function recordDiagnostic(input = {}) {
  await ensureSchema();
  const referenceId = clean(input.referenceId, 64) || createReferenceId();
  const provider = safeProvider(input.provider);
  const stage = safeStage(input.stage);
  const category = safeCategory(input.category || classifyCategory(input.errorCode, input.message, input.httpStatus));
  const errorCode = safeCode(input.errorCode);
  const source = input.source === "client" ? "client" : "server";
  const httpStatus = Number.isInteger(Number(input.httpStatus)) && Number(input.httpStatus) >= 100 && Number(input.httpStatus) <= 599
    ? Number(input.httpStatus) : null;
  const message = clean(input.message, 300) || "Authentication could not be completed.";
  const pagePath = clean(input.pagePath, 240).split("?")[0] || null;
  let origin = "";
  try { origin = new URL(input.origin || "").origin; } catch { origin = ""; }
  const userAgent = clean(input.userAgent, 500) || null;
  const details = normalizeDetails(input.details);

  await query(
    `INSERT INTO auth_diagnostics
      (reference_id, provider, stage, category, error_code, source, severity,
       http_status, message, details, page_path, origin, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
     ON CONFLICT (reference_id) DO NOTHING`,
    [
      referenceId, provider, stage, category, errorCode, source,
      category === "unexpected" || category === "invalid_credential" ? "error" : "warning",
      httpStatus, message, JSON.stringify(details), pagePath, origin || null, userAgent,
    ],
  );
  return referenceId;
}

const capture = async (req, res) => {
  try {
    const body = req.body || {};
    const referenceId = await recordDiagnostic({
      referenceId: body.referenceId,
      provider: body.provider,
      stage: body.stage,
      category: body.category,
      errorCode: body.errorCode,
      source: "client",
      httpStatus: body.httpStatus,
      message: body.message,
      details: body.details,
      pagePath: body.pagePath,
      origin: req.headers.origin,
      userAgent: req.headers["user-agent"],
    });
    return res.status(202).json({ success: true, referenceId });
  } catch (error) {
    // Diagnostics are best-effort and must never block the sign-in UI.
    console.error("[AuthDiagnostics] Could not persist client report:", error.message);
    return res.status(202).json({ success: false, message: "Diagnostic could not be stored." });
  }
};

const list = async (req, res) => {
  try {
    await ensureSchema();
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, requested)) : 50;
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
    const provider = PROVIDERS.has(String(req.query.provider || "").toLowerCase()) ? String(req.query.provider).toLowerCase() : null;
    const category = CATEGORIES.has(String(req.query.category || "").toLowerCase()) ? String(req.query.category).toLowerCase() : null;
    const where = [];
    const params = [];
    if (provider) { params.push(provider); where.push(`provider = $${params.length}`); }
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows, count, grouped] = await Promise.all([
      query(
        `SELECT id, reference_id, provider, stage, category, error_code, source,
                severity, http_status, message, details, page_path, origin,
                user_agent, created_at
           FROM auth_diagnostics ${clause}
          ORDER BY created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM auth_diagnostics ${clause}`, params),
      query(`
        SELECT provider, COUNT(*)::int AS total
          FROM auth_diagnostics
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY provider
         ORDER BY total DESC
      `),
    ]);
    return res.json({
      success: true,
      data: rows.rows,
      pagination: { limit, offset, total: count.rows[0]?.total || 0 },
      summary: grouped.rows,
    });
  } catch (error) {
    console.error("[AuthDiagnostics] Admin list failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not load authentication diagnostics." });
  }
};

const recordServerFailure = (input) => recordDiagnostic({ ...input, source: "server" });

module.exports = { capture, list, recordServerFailure, recordDiagnostic, classifyCategory, createReferenceId };
