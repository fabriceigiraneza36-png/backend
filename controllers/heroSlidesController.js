// controllers/heroSlidesController.js
// ============================================================
// Hero Slides Controller
// ============================================================
'use strict';

const pool = require('../config/db');

/* ── helpers ── */
const ok  = (res, data, meta = {}) =>
  res.status(200).json({ success: true, data, ...meta });

const err = (res, status, message, details = null) =>
  res.status(status).json({ success: false, message, ...(details && { details }) });

/* ════════════════════════════════════════════════════════════
   PUBLIC
════════════════════════════════════════════════════════════ */

/**
 * GET /api/hero-slides
 * Returns all active hero slides ordered by display_order
 */
exports.getAll = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM v_active_hero_slides`,
    );
    return ok(res, rows);
  } catch (e) {
    console.error('[heroSlides.getAll]', e);
    return err(res, 500, 'Failed to fetch hero slides');
  }
};

/* ════════════════════════════════════════════════════════════
   ADMIN — CRUD
════════════════════════════════════════════════════════════ */

/**
 * POST /api/hero-slides
 */
exports.create = async (req, res) => {
  try {
    const {
      destination_id = null,
      title,
      subtitle,
      description,
      image_url,
      cta_label  = 'Explore',
      display_order = 0,
      is_active  = true,
    } = req.body;

    if (!title || !subtitle || !description || !image_url) {
      return err(res, 400, 'title, subtitle, description and image_url are required');
    }

    const { rows } = await pool.query(
      `INSERT INTO hero_slides
         (destination_id,title,subtitle,description,image_url,cta_label,display_order,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [destination_id, title, subtitle, description, image_url, cta_label, display_order, is_active],
    );

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('[heroSlides.create]', e);
    return err(res, 500, 'Failed to create hero slide');
  }
};

/**
 * PUT /api/hero-slides/:id
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const fields = [];
    const vals   = [];
    let   n       = 1;

    const allowed = [
      'destination_id','title','subtitle','description',
      'image_url','cta_label','display_order','is_active',
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${n++}`);
        vals.push(req.body[key]);
      }
    }

    if (!fields.length) return err(res, 400, 'No fields to update');

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE hero_slides SET ${fields.join(', ')} WHERE id = $${n} RETURNING *`,
      vals,
    );

    if (!rows.length) return err(res, 404, 'Hero slide not found');
    return ok(res, rows[0]);
  } catch (e) {
    console.error('[heroSlides.update]', e);
    return err(res, 500, 'Failed to update hero slide');
  }
};

/**
 * DELETE /api/hero-slides/:id
 */
exports.remove = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM hero_slides WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!rows.length) return err(res, 404, 'Hero slide not found');
    return ok(res, { deleted: rows[0].id });
  } catch (e) {
    console.error('[heroSlides.remove]', e);
    return err(res, 500, 'Failed to delete hero slide');
  }
};

/**
 * PATCH /api/hero-slides/reorder
 * Body: { order: [{ id, display_order }, ...] }
 */
exports.reorder = async (req, res) => {
  const client = await pool.connect();
  try {
    const { order = [] } = req.body;
    if (!Array.isArray(order) || !order.length) {
      return err(res, 400, 'order array is required');
    }
    await client.query('BEGIN');
    for (const item of order) {
      await client.query(
        'UPDATE hero_slides SET display_order = $1 WHERE id = $2',
        [item.display_order, item.id],
      );
    }
    await client.query('COMMIT');
    return ok(res, { reordered: order.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[heroSlides.reorder]', e);
    return err(res, 500, 'Failed to reorder slides');
  } finally {
    client.release();
  }
};