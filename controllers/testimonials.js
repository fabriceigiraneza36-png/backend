const { query } = require('../config/db');
const { paginate } = require('../utils/helpers');

const ALLOWED_FIELDS = ['name','location','avatar_url','rating','trip','date_text','testimonial_text','is_featured','is_active','sort_order'];
const COLS = 'id, name, location, avatar_url, rating, trip, date_text, testimonial_text, is_featured, is_active, sort_order, created_at, updated_at';

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, featured } = req.query;
    const params = []; const clauses = ['is_active = true']; let idx = 1;
    if (featured !== undefined) { clauses.push(`is_featured = $${idx++}`); params.push(featured === 'true'); }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const countRes = await query(`SELECT COUNT(*) FROM testimonials ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);
    params.push(pagination.limit, pagination.offset);
    const result = await query(`SELECT ${COLS} FROM testimonials ${where} ORDER BY is_featured DESC, sort_order ASC, created_at DESC LIMIT $${idx++} OFFSET $${idx}`, params);
    res.json({ success: true, data: result.rows, pagination });
  } catch (err) { next(err); }
};

exports.getFeatured = async (req, res, next) => {
  try {
    const result = await query(`SELECT ${COLS} FROM testimonials WHERE is_active = true AND is_featured = true ORDER BY sort_order ASC, created_at DESC LIMIT 12`);
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) { next(err); }
};

exports.getStats = async (req, res, next) => {
  try {
    const result = await query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active = true) AS active, COUNT(*) FILTER (WHERE is_active = false) AS inactive, COUNT(*) FILTER (WHERE is_featured = true) AS featured, ROUND(AVG(rating),2) AS avg_rating, COUNT(*) FILTER (WHERE rating = 5) AS five_star, COUNT(*) FILTER (WHERE rating = 4) AS four_star, COUNT(*) FILTER (WHERE rating <= 3) AS three_or_less FROM testimonials`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) return res.status(400).json({ success: false, error: 'Invalid ID' });
    const result = await query(`SELECT ${COLS} FROM testimonials WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Testimonial not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};

exports.adminGetAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, featured, active, search, rating, sort = 'created_at', order = 'DESC' } = req.query;
    const params = []; const clauses = []; let idx = 1;
    if (featured !== undefined) { clauses.push(`is_featured = $${idx++}`); params.push(featured === 'true'); }
    if (active !== undefined) { clauses.push(`is_active = $${idx++}`); params.push(active === 'true'); }
    if (rating) { clauses.push(`rating = $${idx++}`); params.push(parseInt(rating)); }
    if (search) { clauses.push(`(name ILIKE $${idx} OR testimonial_text ILIKE $${idx} OR location ILIKE $${idx} OR trip ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const SCOLS = ['id','name','rating','sort_order','created_at','updated_at'];
    const sortCol = SCOLS.includes(sort) ? sort : 'created_at';
    const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const countRes = await query(`SELECT COUNT(*) FROM testimonials ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count, 10), page, limit);
    params.push(pagination.limit, pagination.offset);
    const result = await query(`SELECT ${COLS} FROM testimonials ${where} ORDER BY ${sortCol} ${sortDir} LIMIT $${idx++} OFFSET $${idx}`, params);
    res.json({ success: true, data: result.rows, pagination });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, location, avatar_url, rating = 5, trip, date_text, testimonial_text, is_featured = false, is_active = true, sort_order = 0 } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    if (!testimonial_text?.trim()) return res.status(400).json({ success: false, error: 'Testimonial text is required' });
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ success: false, error: 'Rating must be 1-5' });
    const result = await query(
      `INSERT INTO testimonials (name, location, avatar_url, rating, trip, date_text, testimonial_text, is_featured, is_active, sort_order, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING ${COLS}`,
      [name.trim(), location?.trim()||null, avatar_url?.trim()||null, ratingNum, trip?.trim()||null, date_text?.trim()||null, testimonial_text.trim(), Boolean(is_featured), Boolean(is_active), parseInt(sort_order)||0]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Testimonial created' });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) return res.status(400).json({ success: false, error: 'Invalid ID' });
    const existing = await query('SELECT id FROM testimonials WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Testimonial not found' });
    const updates = {};
    for (const field of ALLOWED_FIELDS) { if (req.body[field] !== undefined) updates[field] = req.body[field]; }
    if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, error: 'No valid fields' });
    if (updates.rating !== undefined) {
      const ratingNum = parseInt(updates.rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ success: false, error: 'Rating must be 1-5' });
      updates.rating = ratingNum;
    }
    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...keys.map((k) => updates[k]), id];
    const result = await query(`UPDATE testimonials SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING ${COLS}`, values);
    res.json({ success: true, data: result.rows[0], message: 'Testimonial updated' });
  } catch (err) { next(err); }
};

exports.toggleFeatured = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) return res.status(400).json({ success: false, error: 'Invalid ID' });
    const result = await query(`UPDATE testimonials SET is_featured = NOT is_featured, updated_at = NOW() WHERE id = $1 RETURNING ${COLS}`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Testimonial not found' });
    const u = result.rows[0];
    res.json({ success: true, data: u, message: u.is_featured ? 'Marked as featured' : 'Removed from featured' });
  } catch (err) { next(err); }
};

exports.toggleActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) return res.status(400).json({ success: false, error: 'Invalid ID' });
    const result = await query(`UPDATE testimonials SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING ${COLS}`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Testimonial not found' });
    const u = result.rows[0];
    res.json({ success: true, data: u, message: u.is_active ? 'Activated' : 'Deactivated' });
  } catch (err) { next(err); }
};

exports.reorder = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, error: 'items array is required' });
    const ids = items.map((i) => parseInt(i.id));
    const sortOrders = items.map((i) => parseInt(i.sort_order));
    await query(`UPDATE testimonials AS t SET sort_order = v.sort_order::INTEGER, updated_at = NOW() FROM (SELECT UNNEST($1::INTEGER[]) AS id, UNNEST($2::INTEGER[]) AS sort_order) AS v WHERE t.id = v.id`, [ids, sortOrders]);
    res.json({ success: true, message: `${items.length} testimonials reordered` });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) return res.status(400).json({ success: false, error: 'Invalid ID' });
    const result = await query('DELETE FROM testimonials WHERE id = $1 RETURNING id, name', [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Testimonial not found' });
    res.json({ success: true, message: `"${result.rows[0].name}" deleted`, data: { id: result.rows[0].id } });
  } catch (err) { next(err); }
};

exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: 'ids array is required' });
    const validIds = ids.map((id) => parseInt(id)).filter((id) => !isNaN(id));
    if (validIds.length === 0) return res.status(400).json({ success: false, error: 'No valid IDs' });
    const result = await query(`DELETE FROM testimonials WHERE id = ANY($1::INTEGER[]) RETURNING id`, [validIds]);
    res.json({ success: true, message: `${result.rows.length} deleted`, data: { deleted: result.rows.map((r) => r.id) } });
  } catch (err) { next(err); }
};