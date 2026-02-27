const { query } = require("../config/db");
const { generateBookingNumber, paginate } = require("../utils/helpers");
const { sendBookingConfirmation } = require("../utils/email");

exports.create = async (req, res, next) => {
  try {
    const {
      destination_id, service_id, full_name, email, phone, whatsapp, nationality,
      travel_date, return_date, number_of_travelers,
      accommodation_type, special_requests,
    } = req.body;

    if (!full_name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    const booking_number = generateBookingNumber();

    const result = await query(
      `INSERT INTO bookings
       (booking_number, destination_id, service_id, full_name, email, phone, whatsapp, nationality,
        travel_date, return_date, number_of_travelers, accommodation_type, special_requests)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [booking_number, destination_id || null, service_id || null,
       full_name, email, phone, whatsapp, nationality,
       travel_date, return_date, number_of_travelers || 1,
       accommodation_type, special_requests]
    );

    // Send confirmation email (non-blocking)
    sendBookingConfirmation(result.rows[0]).catch(() => {});

    res.status(201).json({
      message: "Booking inquiry submitted successfully! We will contact you on WhatsApp.",
      data: {
        booking_number: result.rows[0].booking_number,
        status: result.rows[0].status,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.track = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT b.booking_number, b.status, b.travel_date, b.return_date,
              b.number_of_travelers, b.created_at,
              d.name AS destination_name, s.title AS service_name
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.booking_number = $1`,
      [req.params.bookingNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (status) { where += ` AND b.status = $${idx++}`; params.push(status); }
    if (search) {
      where += ` AND (b.full_name ILIKE $${idx} OR b.email ILIKE $${idx} OR b.booking_number ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countRes = await query(`SELECT COUNT(*) FROM bookings b ${where}`, params);
    const pagination = paginate(parseInt(countRes.rows[0].count), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT b.*, d.name AS destination_name, s.title AS service_name
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN services s ON b.service_id = s.id
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({ data: result.rows, pagination });
  } catch (err) {
    next(err);
  }
};

exports.getStats = async (req, res, next) => {
  try {
    const stats = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
      FROM bookings
    `);

    const monthly = await query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS count
      FROM bookings
      WHERE created_at > NOW() - INTERVAL '12 months'
      GROUP BY month ORDER BY month
    `);

    res.json({ data: { ...stats.rows[0], monthly: monthly.rows } });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT b.*, d.name AS destination_name, s.title AS service_name
       FROM bookings b
       LEFT JOIN destinations d ON b.destination_id = d.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Booking not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: "No fields" });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = [...keys.map((k) => fields[k]), id];

    const result = await query(
      `UPDATE bookings SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Booking not found" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query("DELETE FROM bookings WHERE id = $1 RETURNING id", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Booking not found" });
    res.json({ message: "Booking deleted" });
  } catch (err) {
    next(err);
  }
};