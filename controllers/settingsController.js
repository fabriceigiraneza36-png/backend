const { query } = require("../config/db");

exports.getAll = async (req, res, next) => {
  try {
    const result = await query("SELECT key, value FROM site_settings");
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const result = await query(
      "SELECT value FROM site_settings WHERE key = $1",
      [req.params.key]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Setting not found" });
    }
    res.json({ data: { [req.params.key]: result.rows[0].value } });
  } catch (err) {
    next(err);
  }
};

exports.updateOne = async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const result = await query(
      `INSERT INTO site_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [key, value]
    );

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateAll = async (req, res, next) => {
  try {
    const settings = req.body;
    
    for (const [key, value] of Object.entries(settings)) {
      await query(
        `INSERT INTO site_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      );
    }

    const result = await query("SELECT key, value FROM site_settings");
    const updated = {};
    result.rows.forEach(row => {
      updated[row.key] = row.value;
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
};