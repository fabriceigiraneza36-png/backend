const { query } = require("../config/db");
const { paginate } = require("../utils/helpers");
const { sendEmail } = require("../utils/emailService");
const { welcomeSubscriberEmail } = require("../utils/emailTemplates");

exports.subscribe = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Check if email already exists and is active
    const existing = await query(
      "SELECT id, is_active FROM subscribers WHERE email = $1",
      [email]
    );

    const isResubscribe =
      existing.rows.length > 0 && existing.rows[0].is_active;

    // Upsert subscriber
    await query(
      `INSERT INTO subscribers (email, is_active, subscribed_at)
       VALUES ($1, true, NOW())
       ON CONFLICT (email) DO UPDATE 
       SET is_active = true, subscribed_at = NOW(), unsubscribed_at = NULL`,
      [email]
    );

    // Send welcome email (fire-and-forget — don't block the response)
    if (!isResubscribe) {
      sendEmail(
        email,
        "🌿 Welcome to East Africa Explorer — Your Adventure Begins!",
        welcomeSubscriberEmail(email)
      ).catch((err) => {
        console.error("Failed to send welcome email:", err.message);
      });
    }

    res.status(201).json({ message: "Subscribed successfully" });
  } catch (err) {
    next(err);
  }
};

exports.unsubscribe = async (req, res, next) => {
  try {
    const result = await query(
      "UPDATE subscribers SET is_active = false, unsubscribed_at = NOW() WHERE email = $1 RETURNING id",
      [req.params.email]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Email not found" });

    // If request is from browser (GET), show a simple HTML page
    if (req.method === "GET") {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Unsubscribed</title></head>
        <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;background:#F0FDF4;">
          <div style="text-align:center;padding:40px;background:white;border-radius:20px;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:400px;">
            <div style="font-size:48px;margin-bottom:16px;">👋</div>
            <h2 style="color:#14532D;margin-bottom:8px;">You've Been Unsubscribed</h2>
            <p style="color:#5A7A5A;line-height:1.6;">We're sorry to see you go. You won't receive any more emails from us.</p>
            <p style="color:#7A9E7A;font-size:14px;margin-top:16px;">You can always resubscribe on our website.</p>
          </div>
        </body>
        </html>
      `);
    }

    res.json({ message: "Unsubscribed successfully" });
  } catch (err) {
    next(err);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, is_active } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    let idx = 1;

    if (is_active !== undefined) {
      where += ` AND is_active = $${idx++}`;
      params.push(is_active === "true");
    }

    const countRes = await query(
      `SELECT COUNT(*) FROM subscribers ${where}`,
      params
    );
    const pagination = paginate(parseInt(countRes.rows[0].count), page, limit);

    params.push(pagination.limit, pagination.offset);
    const result = await query(
      `SELECT * FROM subscribers ${where} ORDER BY subscribed_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    res.json({ data: result.rows, pagination });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const result = await query(
      "DELETE FROM subscribers WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Subscriber not found" });
    res.json({ message: "Subscriber deleted" });
  } catch (err) {
    next(err);
  }
};