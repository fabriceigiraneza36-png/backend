/**
 * config/db.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Always-Ready, High-Performance PostgreSQL Connection Manager
 * ═══════════════════════════════════════════════════════════════════════════
 * - Pool pre-warmed with minimum connections
 * - Auto-reconnect on connection drop
 * - Health-check heartbeat keeps connections alive
 * - Sequelize compatibility maintained
 */

require("dotenv").config({
  path: require("path").resolve(process.cwd(), ".env"),
});
const { Pool }      = require("pg");
const { Sequelize } = require("sequelize");
const logger        = require("../utils/logger");

// ── Connection Configuration ─────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL || null;

const dbConfig = connectionString
  ? { connectionString }
  : {
      host:     process.env.DB_HOST     || "localhost",
      port:     parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME     || "altuvera",
      user:     process.env.DB_USER     || "fabrice",
      password: process.env.DB_PASSWORD || "2004",
    };

// ── Pool Configuration ───────────────────────────────────────────────────────

const poolOptions = connectionString
  ? {
      connectionString,
      ssl:
        process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
      max:                    parseInt(process.env.DB_POOL_MAX,        10) || 30,
      idleTimeoutMillis:      parseInt(process.env.DB_IDLE_MS,         10) || 300_000,
      connectionTimeoutMillis:parseInt(process.env.DB_CONN_TIMEOUT_MS, 10) || 10_000,
      allowExitOnIdle: false,
    }
  : {
      ...dbConfig,
      max:                    parseInt(process.env.DB_POOL_MAX,         10) || 30,
      min:                    parseInt(process.env.DB_POOL_MIN,         10) || 5,
      idleTimeoutMillis:      parseInt(process.env.DB_IDLE_MS,          10) || 300_000,
      connectionTimeoutMillis:parseInt(process.env.DB_CONN_TIMEOUT_MS,  10) || 10_000,
      allowExitOnIdle: false,
      statement_timeout:      parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10) || 30_000,
    };

const pool = new Pool(poolOptions);

// ── Pool Event Handlers ──────────────────────────────────────────────────────

pool.on("connect", () => logger.info("[DB] New client connected to PostgreSQL"));
pool.on("error",   (err) => logger.error("[DB] Unexpected pool error:", { error: err.message }));
pool.on("remove",  () => logger.debug("[DB] Client removed from pool"));

// ── Heartbeat ────────────────────────────────────────────────────────────────

let heartbeatInterval = null;

const startHeartbeat = () => {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(async () => {
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      logger.warn("[DB] Heartbeat failed, pool will auto-reconnect:", err.message);
    }
  }, 60_000);
  if (heartbeatInterval.unref) heartbeatInterval.unref();
};

// ── Query Wrapper with Auto-Retry ────────────────────────────────────────────

const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const result   = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 200) {
      logger.warn(`[DB] Slow query (${duration}ms): ${text.substring(0, 80)}...`);
    }
    return result;
  } catch (err) {
    // Permission denied
    if (
      err.code === "42501" ||
      (typeof err.message === "string" &&
        err.message.toLowerCase().includes("permission denied"))
    ) {
      const tableMatch = typeof err.message === "string"
        ? err.message.match(
            /permission denied for (?:relation|table)\s+\"?([a-zA-Z0-9_]+)\"?/i,
          )
        : null;
      const table    = tableMatch?.[1] || null;
      const user     = dbConfig.user     || process.env.DB_USER || "unknown";
      const database = dbConfig.database || process.env.DB_NAME || "unknown";

      const permissionError = new Error(
        `Database permission denied${table ? ` for table "${table}"` : ""}. ` +
          `Connected as "${user}" to database "${database}". ` +
          `Fix by granting privileges to this role (or run migrations as the table owner).`,
      );
      permissionError.statusCode  = 403;
      permissionError.errorCode   = "DB_PERMISSION_DENIED";
      permissionError.originalError = err.message;
      throw permissionError;
    }

    // Retry once on transient connection errors
    if (
      err.code === "ECONNRESET" ||
      err.code === "57P01" ||
      err.code === "57P03" ||
      err.message?.includes("Connection terminated")
    ) {
      logger.warn("[DB] Connection dropped, retrying query...");
      return pool.query(text, params);
    }

    throw err;
  }
};

// ── Sequelize Instance ───────────────────────────────────────────────────────

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.user,
  dbConfig.password,
  {
    host:    dbConfig.host,
    port:    dbConfig.port,
    dialect: "postgres",
    logging: false,
    pool:    { max: 20, min: 3, acquire: 30_000, idle: 10_000 },
    define:  { timestamps: true, underscored: true, freezeTableName: true },
    retry:   { max: 3 },
  },
);

// ── Connection Test & Warm-Up ────────────────────────────────────────────────

const testConnection = async () => {
  await pool.query("SELECT 1");
  await sequelize.authenticate();
  startHeartbeat();
  logger.info("[DB] ✅ Connected to PostgreSQL — pool warmed and heartbeat started");
  return true;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Shared utility: idempotently add columns ─────────────────────────────────

/**
 * addColumns(table, columns)
 * columns = [{ name, type }]  e.g. { name: 'user_id', type: 'INTEGER' }
 */
const addColumns = async (table, columns) => {
  for (const { name, type } of columns) {
    await pool
      .query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${type}`)
      .catch((err) => {
        if (!err.message?.includes("already exists")) {
          logger.warn(`[DB] addColumn ${table}.${name} warning: ${err.message}`);
        }
      });
  }
};

/**
 * createIndexes(sqls)
 * Each entry is a full CREATE INDEX IF NOT EXISTS … statement.
 */
const createIndexes = async (sqls) => {
  for (const sql of sqls) {
    await pool.query(sql).catch(() => {});
  }
};

/**
 * ensureUpdatedAtTrigger(table)
 * Attaches the shared update_updated_at_column() trigger to a table.
 */
const ensureUpdatedAtTrigger = async (table) => {
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;
  `).catch(() => {});

  await pool.query(
    `DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table};`,
  ).catch(() => {});

  await pool.query(`
    CREATE TRIGGER trg_${table}_updated_at
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `).catch(() => {});
};

// ════════════════════════════════════════════════════════════════════════════
// ensureSubscribersSchema
// ════════════════════════════════════════════════════════════════════════════

const ensureSubscribersSchema = async () => {
  try {
    // 1. Create table with every column the controller uses
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
        email           VARCHAR(255)  UNIQUE NOT NULL,
        name            VARCHAR(255),
        source          VARCHAR(100)  DEFAULT 'website',
        ip_address      VARCHAR(50),
        user_agent      TEXT,
        is_active       BOOLEAN       DEFAULT true,
        welcome_sent    BOOLEAN       DEFAULT false,
        welcome_sent_at TIMESTAMPTZ,
        welcome_error   TEXT,
        tags            TEXT[]        DEFAULT '{}'::TEXT[],
        subscribed_at   TIMESTAMPTZ   DEFAULT NOW(),
        unsubscribed_at TIMESTAMPTZ,
        resubscribed_at TIMESTAMPTZ,
        created_at      TIMESTAMPTZ   DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   DEFAULT NOW()
      )
    `);

    // 2. Idempotently add any columns that might be missing on older tables
    await addColumns("subscribers", [
      { name: "user_id",          type: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
      { name: "name",             type: "VARCHAR(255)" },
      { name: "source",           type: "VARCHAR(100) DEFAULT 'website'" },
      { name: "ip_address",       type: "VARCHAR(50)" },
      { name: "user_agent",       type: "TEXT" },
      { name: "is_active",        type: "BOOLEAN DEFAULT true" },
      { name: "welcome_sent",     type: "BOOLEAN DEFAULT false" },
      { name: "welcome_sent_at",  type: "TIMESTAMPTZ" },
      { name: "welcome_error",    type: "TEXT" },
      { name: "tags",             type: "TEXT[] DEFAULT '{}'::TEXT[]" },
      { name: "subscribed_at",    type: "TIMESTAMPTZ DEFAULT NOW()" },
      { name: "unsubscribed_at",  type: "TIMESTAMPTZ" },
      { name: "resubscribed_at",  type: "TIMESTAMPTZ" },
      { name: "updated_at",       type: "TIMESTAMPTZ DEFAULT NOW()" },
    ]);

    // 3. Indexes
    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_subscribers_email
         ON subscribers(email)`,
      `CREATE INDEX IF NOT EXISTS idx_subscribers_is_active
         ON subscribers(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_subscribers_user_id
         ON subscribers(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_subscribers_subbed_at
         ON subscribers(subscribed_at DESC)`,
      // Composite: most common admin inbox query
      `CREATE INDEX IF NOT EXISTS idx_subscribers_active_created
         ON subscribers(is_active, subscribed_at DESC)`,
    ]);

    // 4. Auto-update updated_at
    await ensureUpdatedAtTrigger("subscribers");

    logger.info("[DB] ✅ Subscribers schema verified & ensured");
  } catch (err) {
    logger.error("[DB] Subscribers schema ensure failed:", err.message);
    throw err; // re-throw so the route-level guard can return 503
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensurePostsSchema
// ════════════════════════════════════════════════════════════════════════════

const ensurePostsSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id            SERIAL PRIMARY KEY,
        title         VARCHAR(500) NOT NULL,
        slug          VARCHAR(500) UNIQUE,
        excerpt       TEXT,
        content       TEXT,
        featured_image VARCHAR(1000),
        category      VARCHAR(100),
        tags          TEXT[]       DEFAULT '{}'::TEXT[],
        status        VARCHAR(50)  DEFAULT 'draft',
        is_featured   BOOLEAN      DEFAULT false,
        is_active     BOOLEAN      DEFAULT true,
        author_id     INTEGER,
        author_name   VARCHAR(255),
        view_count    INTEGER      DEFAULT 0,
        like_count    INTEGER      DEFAULT 0,
        comment_count INTEGER      DEFAULT 0,
        read_time     INTEGER,
        meta_title    VARCHAR(500),
        meta_desc     TEXT,
        published_at  TIMESTAMP,
        created_at    TIMESTAMP    DEFAULT NOW(),
        updated_at    TIMESTAMP    DEFAULT NOW()
      )
    `);

    await addColumns("posts", [
      { name: "slug",          type: "VARCHAR(500)" },
      { name: "excerpt",       type: "TEXT" },
      { name: "is_featured",   type: "BOOLEAN DEFAULT false" },
      { name: "is_active",     type: "BOOLEAN DEFAULT true" },
      { name: "author_name",   type: "VARCHAR(255)" },
      { name: "view_count",    type: "INTEGER DEFAULT 0" },
      { name: "like_count",    type: "INTEGER DEFAULT 0" },
      { name: "comment_count", type: "INTEGER DEFAULT 0" },
      { name: "read_time",     type: "INTEGER" },
      { name: "meta_title",    type: "VARCHAR(500)" },
      { name: "meta_desc",     type: "TEXT" },
      { name: "published_at",  type: "TIMESTAMP" },
      { name: "updated_at",    type: "TIMESTAMP DEFAULT NOW()" },
    ]);

    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_posts_status     ON posts(status)`,
      `CREATE INDEX IF NOT EXISTS idx_posts_slug       ON posts(slug)`,
      `CREATE INDEX IF NOT EXISTS idx_posts_is_active  ON posts(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_posts_category   ON posts(category)`,
      `CREATE INDEX IF NOT EXISTS idx_posts_author_id  ON posts(author_id)`,
    ]);

    logger.info("[DB] ✅ Posts schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Posts schema ensure failed:", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensureBookingsSchema
// ════════════════════════════════════════════════════════════════════════════

const ensureBookingsSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id                   SERIAL PRIMARY KEY,
        booking_number       VARCHAR(50)  UNIQUE,
        user_id              INTEGER,
        destination_id       INTEGER,
        service_id           INTEGER,
        package_id           INTEGER,
        booking_type         VARCHAR(100) DEFAULT 'destination',

        -- Guest info
        full_name            VARCHAR(255) NOT NULL,
        email                VARCHAR(255) NOT NULL,
        phone                VARCHAR(50),
        whatsapp             VARCHAR(50),
        nationality          VARCHAR(100),
        country              VARCHAR(100),

        -- Travel
        travel_date          DATE,
        return_date          DATE,
        flexible_dates       BOOLEAN      DEFAULT false,
        number_of_travelers  INTEGER      DEFAULT 1,
        number_of_adults     INTEGER      DEFAULT 1,
        number_of_children   INTEGER      DEFAULT 0,
        children_ages        JSONB,

        -- Accommodation
        accommodation_type   VARCHAR(100),
        room_type            VARCHAR(100),

        -- Requirements
        dietary_requirements TEXT,
        special_requests     TEXT,
        accessibility_needs  TEXT,

        -- JSON blobs
        travelers_details    JSONB,
        emergency_contact    JSONB,

        -- Notes
        customer_notes       TEXT,
        admin_notes          TEXT,
        internal_notes       TEXT,

        -- Tracking
        source               VARCHAR(100) DEFAULT 'website',
        utm_source           VARCHAR(255),
        utm_medium           VARCHAR(255),
        utm_campaign         VARCHAR(255),
        referrer_url         TEXT,

        -- Status
        status               VARCHAR(50)  DEFAULT 'pending',
        payment_status       VARCHAR(50)  DEFAULT 'pending',

        -- Pricing
        package_title        VARCHAR(500),
        package_price        DECIMAL(12,2),
        total_price          DECIMAL(12,2),
        currency             VARCHAR(10)  DEFAULT 'USD',
        deposit_paid         DECIMAL(12,2) DEFAULT 0,

        -- Misc
        pickup_location      VARCHAR(500),
        priority             VARCHAR(20)  DEFAULT 'normal',
        booking_ref          VARCHAR(100),
        confirmation_code    VARCHAR(100),
        cancellation_reason  TEXT,

        -- Timestamps
        confirmed_at         TIMESTAMP,
        cancelled_at         TIMESTAMP,
        completed_at         TIMESTAMP,
        created_at           TIMESTAMP    DEFAULT NOW(),
        updated_at           TIMESTAMP    DEFAULT NOW()
      )
    `);

    await addColumns("bookings", [
      { name: "user_id",              type: "INTEGER" },
      { name: "booking_number",       type: "VARCHAR(50)" },
      { name: "booking_type",         type: "VARCHAR(100) DEFAULT 'destination'" },
      { name: "return_date",          type: "DATE" },
      { name: "flexible_dates",       type: "BOOLEAN DEFAULT false" },
      { name: "number_of_travelers",  type: "INTEGER DEFAULT 1" },
      { name: "number_of_adults",     type: "INTEGER DEFAULT 1" },
      { name: "number_of_children",   type: "INTEGER DEFAULT 0" },
      { name: "children_ages",        type: "JSONB" },
      { name: "accommodation_type",   type: "VARCHAR(100)" },
      { name: "room_type",            type: "VARCHAR(100)" },
      { name: "dietary_requirements", type: "TEXT" },
      { name: "accessibility_needs",  type: "TEXT" },
      { name: "travelers_details",    type: "JSONB" },
      { name: "emergency_contact",    type: "JSONB" },
      { name: "customer_notes",       type: "TEXT" },
      { name: "admin_notes",          type: "TEXT" },
      { name: "internal_notes",       type: "TEXT" },
      { name: "whatsapp",             type: "VARCHAR(50)" },
      { name: "nationality",          type: "VARCHAR(100)" },
      { name: "country",              type: "VARCHAR(100)" },
      { name: "utm_source",           type: "VARCHAR(255)" },
      { name: "utm_medium",           type: "VARCHAR(255)" },
      { name: "utm_campaign",         type: "VARCHAR(255)" },
      { name: "referrer_url",         type: "TEXT" },
      { name: "payment_status",       type: "VARCHAR(50) DEFAULT 'pending'" },
      { name: "confirmation_code",    type: "VARCHAR(100)" },
      { name: "cancellation_reason",  type: "TEXT" },
      { name: "confirmed_at",         type: "TIMESTAMP" },
      { name: "cancelled_at",         type: "TIMESTAMP" },
      { name: "completed_at",         type: "TIMESTAMP" },
      { name: "updated_at",           type: "TIMESTAMP DEFAULT NOW()" },
      { name: "package_id",           type: "INTEGER" },
      { name: "package_title",        type: "VARCHAR(500)" },
      { name: "package_price",        type: "DECIMAL(12,2)" },
      { name: "total_price",          type: "DECIMAL(12,2)" },
      { name: "currency",             type: "VARCHAR(10) DEFAULT 'USD'" },
      { name: "deposit_paid",         type: "DECIMAL(12,2) DEFAULT 0" },
      { name: "pickup_location",      type: "VARCHAR(500)" },
      { name: "priority",             type: "VARCHAR(20) DEFAULT 'normal'" },
      { name: "booking_ref",          type: "VARCHAR(100)" },
    ]);

    // One-time safe column migrations (old → new names)
    const migrations = [
      `UPDATE bookings SET booking_number = booking_ref
         WHERE booking_number IS NULL AND booking_ref IS NOT NULL`,
      `UPDATE bookings SET number_of_travelers = travelers
         WHERE number_of_travelers IS NULL AND travelers IS NOT NULL`,
      `UPDATE bookings SET number_of_adults = adults
         WHERE number_of_adults IS NULL AND adults IS NOT NULL`,
      `UPDATE bookings SET number_of_children = children
         WHERE number_of_children IS NULL AND children IS NOT NULL`,
      `UPDATE bookings SET return_date = end_date
         WHERE return_date IS NULL AND end_date IS NOT NULL`,
      `UPDATE bookings SET accommodation_type = accommodation
         WHERE accommodation_type IS NULL AND accommodation IS NOT NULL`,
      `UPDATE bookings
         SET booking_number = CONCAT('BK-',TO_CHAR(created_at,'YYYYMMDD'),'-',LPAD(id::TEXT,6,'0'))
         WHERE booking_number IS NULL`,
    ];
    for (const sql of migrations) {
      await pool.query(sql).catch(() => {});
    }

    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_bookings_status         ON bookings(status)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_email          ON bookings(email)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_user_id        ON bookings(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_created_at     ON bookings(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_travel_date    ON bookings(travel_date)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_booking_number ON bookings(booking_number)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status)`,
    ]);

    logger.info("[DB] ✅ Bookings schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Bookings schema ensure failed:", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensurePackagesSchema
// ════════════════════════════════════════════════════════════════════════════

const ensurePackagesSchema = async () => {
  try {
    // ── packages ──────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id                SERIAL PRIMARY KEY,
        title             VARCHAR(500)  NOT NULL,
        slug              VARCHAR(500)  UNIQUE,
        short_description TEXT,
        description       TEXT,
        content           TEXT,
        category          VARCHAR(100),
        destination       VARCHAR(255),
        country           VARCHAR(100),
        price             DECIMAL(12,2) DEFAULT 0,
        price_label       VARCHAR(100)  DEFAULT 'per person',
        currency          VARCHAR(10)   DEFAULT 'USD',
        pricing_tiers     JSONB         DEFAULT '[]'::JSONB,
        discount_percent  INTEGER       DEFAULT 0,
        is_price_visible  BOOLEAN       DEFAULT true,
        duration_days     INTEGER,
        duration_nights   INTEGER,
        max_travelers     INTEGER,
        min_travelers     INTEGER       DEFAULT 1,
        group_size_label  VARCHAR(100),
        images            JSONB         DEFAULT '[]'::JSONB,
        cover_image_url   VARCHAR(1000),
        thumbnail_url     VARCHAR(1000),
        video_url         VARCHAR(1000),
        gallery           JSONB         DEFAULT '[]'::JSONB,
        features          JSONB         DEFAULT '[]'::JSONB,
        inclusions        JSONB         DEFAULT '[]'::JSONB,
        exclusions        JSONB         DEFAULT '[]'::JSONB,
        highlights        JSONB         DEFAULT '[]'::JSONB,
        itinerary         JSONB         DEFAULT '[]'::JSONB,
        faqs              JSONB         DEFAULT '[]'::JSONB,
        tags              TEXT[]        DEFAULT '{}'::TEXT[],
        available_months  JSONB         DEFAULT '[]'::JSONB,
        departure_dates   JSONB         DEFAULT '[]'::JSONB,
        availability_note TEXT,
        is_published      BOOLEAN       DEFAULT false,
        is_featured       BOOLEAN       DEFAULT false,
        is_active         BOOLEAN       DEFAULT true,
        is_sold_out       BOOLEAN       DEFAULT false,
        badge_label       VARCHAR(100),
        badge_color       VARCHAR(50)   DEFAULT '#047857',
        meta_title        VARCHAR(500),
        meta_description  TEXT,
        view_count        INTEGER       DEFAULT 0,
        booking_count     INTEGER       DEFAULT 0,
        inquiry_count     INTEGER       DEFAULT 0,
        card_theme        VARCHAR(50)   DEFAULT 'default',
        accent_color      VARCHAR(20)   DEFAULT '#047857',
        card_bg_image     VARCHAR(1000),
        author_id         INTEGER,
        author_name       VARCHAR(255),
        sort_order        INTEGER       DEFAULT 0,
        published_at      TIMESTAMP,
        created_at        TIMESTAMP     DEFAULT NOW(),
        updated_at        TIMESTAMP     DEFAULT NOW()
      )
    `);

    // ── package_messages ──────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS package_messages (
        id              SERIAL PRIMARY KEY,
        package_id      INTEGER       NOT NULL
                        REFERENCES packages(id) ON DELETE CASCADE,
        conversation_id VARCHAR(255),
        thread_id       INTEGER,
        sender_type     VARCHAR(20)   NOT NULL
                        CHECK (sender_type IN ('user','admin','guest')),
        sender_id       INTEGER,
        sender_name     VARCHAR(255),
        sender_email    VARCHAR(255),
        sender_avatar   VARCHAR(1000),
        message_type    VARCHAR(50)   DEFAULT 'inquiry'
                        CHECK (message_type IN (
                          'inquiry','booking_request','question','wish',
                          'reply','info_request','info_response',
                          'booking_confirmed','booking_cancelled','system'
                        )),
        subject         VARCHAR(500),
        body            TEXT          NOT NULL,
        metadata        JSONB         DEFAULT '{}'::JSONB,
        attachments     JSONB         DEFAULT '[]'::JSONB,
        is_read         BOOLEAN       DEFAULT false,
        is_pinned       BOOLEAN       DEFAULT false,
        read_at         TIMESTAMP,
        parent_id       INTEGER,
        created_at      TIMESTAMP     DEFAULT NOW(),
        updated_at      TIMESTAMP     DEFAULT NOW()
      )
    `);

    // ── package_bookings ──────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS package_bookings (
        id               SERIAL PRIMARY KEY,
        booking_ref      VARCHAR(100)  UNIQUE,
        package_id       INTEGER
                         REFERENCES packages(id) ON DELETE SET NULL,
        package_title    VARCHAR(500),
        package_price    DECIMAL(12,2),
        user_id          INTEGER,
        guest_name       VARCHAR(255),
        guest_email      VARCHAR(255),
        guest_phone      VARCHAR(50),
        travelers_count  INTEGER       DEFAULT 1,
        adults           INTEGER       DEFAULT 1,
        children         INTEGER       DEFAULT 0,
        travel_date      DATE,
        end_date         DATE,
        special_requests TEXT,
        dietary_needs    TEXT,
        pickup_location  VARCHAR(500),
        total_price      DECIMAL(12,2),
        currency         VARCHAR(10)   DEFAULT 'USD',
        deposit_paid     DECIMAL(12,2) DEFAULT 0,
        payment_status   VARCHAR(50)   DEFAULT 'pending',
        status           VARCHAR(50)   DEFAULT 'pending'
                         CHECK (status IN (
                           'pending','needs_info','confirmed',
                           'cancelled','completed','no_show'
                         )),
        priority         VARCHAR(20)   DEFAULT 'normal',
        admin_notes      TEXT,
        source           VARCHAR(100)  DEFAULT 'package_page',
        confirmed_at     TIMESTAMP,
        cancelled_at     TIMESTAMP,
        completed_at     TIMESTAMP,
        created_at       TIMESTAMP     DEFAULT NOW(),
        updated_at       TIMESTAMP     DEFAULT NOW()
      )
    `);

    // ── admin_info_requests ───────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_info_requests (
        id           SERIAL PRIMARY KEY,
        package_id   INTEGER REFERENCES packages(id) ON DELETE CASCADE,
        booking_id   INTEGER REFERENCES package_bookings(id) ON DELETE SET NULL,
        message_id   INTEGER REFERENCES package_messages(id) ON DELETE SET NULL,
        user_id      INTEGER,
        target_email VARCHAR(255),
        target_name  VARCHAR(255),
        title        VARCHAR(500) NOT NULL,
        description  TEXT,
        fields       JSONB        DEFAULT '[]'::JSONB,
        theme        VARCHAR(50)  DEFAULT 'default',
        accent_color VARCHAR(20)  DEFAULT '#047857',
        header_image VARCHAR(1000),
        custom_css   TEXT,
        response     JSONB        DEFAULT '{}'::JSONB,
        responded_at TIMESTAMP,
        responded_by INTEGER,
        status       VARCHAR(50)  DEFAULT 'pending'
                     CHECK (status IN ('pending','responded','expired','cancelled')),
        expires_at   TIMESTAMP,
        created_by   INTEGER,
        created_at   TIMESTAMP    DEFAULT NOW(),
        updated_at   TIMESTAMP    DEFAULT NOW()
      )
    `);

    // ── package_chat_preferences ──────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS package_chat_preferences (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER      UNIQUE NOT NULL,
        theme        VARCHAR(50)  DEFAULT 'light',
        accent_color VARCHAR(20)  DEFAULT '#047857',
        bg_image     VARCHAR(1000),
        bg_preset    VARCHAR(100) DEFAULT 'none',
        font_size    VARCHAR(20)  DEFAULT 'medium',
        bubble_style VARCHAR(50)  DEFAULT 'rounded',
        created_at   TIMESTAMP    DEFAULT NOW(),
        updated_at   TIMESTAMP    DEFAULT NOW()
      )
    `);

    // ── Indexes ───────────────────────────────────────────────────────────
    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_packages_slug        ON packages(slug)`,
      `CREATE INDEX IF NOT EXISTS idx_packages_is_published ON packages(is_published)`,
      `CREATE INDEX IF NOT EXISTS idx_packages_is_featured  ON packages(is_featured)`,
      `CREATE INDEX IF NOT EXISTS idx_packages_category     ON packages(category)`,
      `CREATE INDEX IF NOT EXISTS idx_packages_is_active    ON packages(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_packages_created_at   ON packages(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_packages_sort_order   ON packages(sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_msgs_package_id   ON package_messages(package_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_msgs_sender_id    ON package_messages(sender_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_msgs_sender_email ON package_messages(sender_email)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_msgs_created_at   ON package_messages(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_msgs_msg_type     ON package_messages(message_type)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_msgs_is_read      ON package_messages(is_read)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_package_id   ON package_bookings(package_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_user_id      ON package_bookings(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_status       ON package_bookings(status)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_booking_ref  ON package_bookings(booking_ref)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_guest_email  ON package_bookings(guest_email)`,
      `CREATE INDEX IF NOT EXISTS idx_pkg_bkgs_travel_date  ON package_bookings(travel_date)`,
      `CREATE INDEX IF NOT EXISTS idx_info_reqs_package_id  ON admin_info_requests(package_id)`,
      `CREATE INDEX IF NOT EXISTS idx_info_reqs_user_id     ON admin_info_requests(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_info_reqs_target_email ON admin_info_requests(target_email)`,
      `CREATE INDEX IF NOT EXISTS idx_info_reqs_status      ON admin_info_requests(status)`,
      `CREATE INDEX IF NOT EXISTS idx_chat_prefs_user_id    ON package_chat_preferences(user_id)`,
    ]);

    // ── Auto booking_ref trigger ──────────────────────────────────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION gen_package_booking_ref()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.booking_ref IS NULL OR NEW.booking_ref = '' THEN
          NEW.booking_ref := CONCAT(
            'PKG-', TO_CHAR(NOW(),'YYYYMMDD'), '-', LPAD(NEW.id::TEXT, 5, '0')
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `).catch(() => {});

    await pool.query(
      `DROP TRIGGER IF EXISTS trg_package_booking_ref ON package_bookings;`,
    ).catch(() => {});

    await pool.query(`
      CREATE TRIGGER trg_package_booking_ref
        BEFORE INSERT ON package_bookings
        FOR EACH ROW EXECUTE FUNCTION gen_package_booking_ref();
    `).catch(() => {});

    // ── updated_at triggers for all package tables ────────────────────────
    for (const tbl of [
      "packages",
      "package_messages",
      "package_bookings",
      "admin_info_requests",
      "package_chat_preferences",
    ]) {
      await ensureUpdatedAtTrigger(tbl);
    }

    logger.info("[DB] ✅ Packages schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Packages schema ensure failed:", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensureUserSchema
// ════════════════════════════════════════════════════════════════════════════

const ensureUserSchema = async () => {
  try {
    await addColumns("users", [
      { name: "google_id",          type: "VARCHAR(255)" },
      { name: "github_id",          type: "VARCHAR(255)" },
      { name: "auth_provider",      type: "VARCHAR(50) DEFAULT 'email'" },
      { name: "is_active",          type: "BOOLEAN DEFAULT true" },
      { name: "is_verified",        type: "BOOLEAN DEFAULT false" },
      { name: "full_name",          type: "VARCHAR(255)" },
      { name: "phone",              type: "VARCHAR(50)" },
      { name: "bio",                type: "TEXT" },
      { name: "avatar_url",         type: "TEXT" },
      { name: "role",               type: "VARCHAR(50) DEFAULT 'user'" },
      { name: "last_login",         type: "TIMESTAMPTZ" },
      { name: "login_counter",      type: "INTEGER DEFAULT 0" },
      { name: "verification_code",  type: "VARCHAR(10)" },
      { name: "code_expiry",        type: "TIMESTAMPTZ" },
      { name: "code_attempts",      type: "INTEGER DEFAULT 0" },
      { name: "last_code_sent_at",  type: "TIMESTAMPTZ" },
      { name: "verification_token", type: "VARCHAR(255)" },
      { name: "reset_token",        type: "VARCHAR(255)" },
      { name: "reset_token_expires",type: "TIMESTAMPTZ" },
      { name: "preferences",        type: "JSONB" },
      { name: "password_hash",      type: "VARCHAR(255)" },
      { name: "subscribed",         type: "BOOLEAN DEFAULT false" },
    ]);

    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_users_email              ON users(email)`,
      `CREATE INDEX IF NOT EXISTS idx_users_google_id          ON users(google_id)`,
      `CREATE INDEX IF NOT EXISTS idx_users_github_id          ON users(github_id)`,
      `CREATE INDEX IF NOT EXISTS idx_users_reset_token        ON users(reset_token)`,
      `CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token)`,
      `CREATE INDEX IF NOT EXISTS idx_users_login_counter      ON users(login_counter)`,
    ]);

    logger.info("[DB] ✅ Users table schema verified & indexes ensured");
  } catch (err) {
    logger.warn("[DB] Schema check skipped (table may not exist yet):", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensureGallerySchema
// ════════════════════════════════════════════════════════════════════════════

const ensureGallerySchema = async () => {
  try {
    await addColumns("gallery", [
      { name: "updated_at", type: "TIMESTAMP DEFAULT NOW()" },
      { name: "tags",       type: "TEXT[] DEFAULT '{}'::TEXT[]" },
    ]);

    await pool.query(
      `UPDATE gallery SET updated_at = created_at WHERE updated_at IS NULL`,
    ).catch(() => {});

    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_gallery_is_active         ON gallery(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_gallery_is_featured       ON gallery(is_featured)`,
      `CREATE INDEX IF NOT EXISTS idx_gallery_category          ON gallery(category)`,
      `CREATE INDEX IF NOT EXISTS idx_gallery_country_id        ON gallery(country_id)`,
      `CREATE INDEX IF NOT EXISTS idx_gallery_created_at        ON gallery(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_gallery_sort_order        ON gallery(sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_gallery_active_featured
         ON gallery(is_active, is_featured, sort_order)`,
    ]);

    await pool.query(`
      CREATE OR REPLACE FUNCTION gallery_increment_views(gallery_id INTEGER)
      RETURNS void AS $$
        UPDATE gallery
          SET view_count = COALESCE(view_count, 0) + 1
        WHERE id = gallery_id;
      $$ LANGUAGE sql;
    `).catch(() => {});

    logger.info("[DB] ✅ Gallery schema verified & indexes ensured");
  } catch (err) {
    logger.warn("[DB] Gallery schema ensure failed:", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensureDestinationsSchema
// ════════════════════════════════════════════════════════════════════════════

const ensureDestinationsSchema = async () => {
  try {
    await pool.query(
      `ALTER TABLE destinations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
    );
    logger.info("[DB] ✅ Destinations table schema verified & updated");
  } catch (err) {
    logger.warn(
      "[DB] Destinations schema check skipped (table may not exist yet):",
      err.message,
    );
  }
};


// Add this to your ensureCountriesSchema in config/db.js
// Find the ensureCountriesSchema function and add these columns:

const ensureCountriesSchema = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS countries (
        id                SERIAL PRIMARY KEY,
        name              VARCHAR(255) NOT NULL,
        slug              VARCHAR(255) UNIQUE NOT NULL,
        continent         VARCHAR(100),
        description       TEXT,
        short_description TEXT,
        image_url         VARCHAR(500),
        flag_url          VARCHAR(500),
        capital           VARCHAR(255),
        currency          VARCHAR(100),
        language          VARCHAR(255),
        timezone          VARCHAR(100),
        visa_info         TEXT,
        best_time_to_visit TEXT,
        climate           TEXT,
        latitude          NUMERIC(10,6),
        longitude         NUMERIC(10,6),
        is_active         BOOLEAN   DEFAULT true,
        is_featured       BOOLEAN   DEFAULT false,
        view_count        INTEGER   DEFAULT 0,
        meta_title        VARCHAR(255),
        meta_description  TEXT,
        created_at        TIMESTAMP DEFAULT NOW(),
        updated_at        TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add new columns for hero images and activities
    await addColumns("countries", [
      { name: "hero_images",     type: "JSONB DEFAULT '[]'::JSONB" },
      { name: "activities",      type: "JSONB DEFAULT '[]'::JSONB" },
      { name: "short_notes",     type: "TEXT" },
      { name: "faqs",            type: "JSONB DEFAULT '[]'::JSONB" },
      { name: "extra_info",      type: "JSONB DEFAULT '{}'::JSONB" },
      { name: "flag",            type: "VARCHAR(10)" },
      { name: "tagline",         type: "VARCHAR(500)" },
      { name: "population",      type: "BIGINT" },
      { name: "area_sq_km",      type: "INTEGER" },
      { name: "calling_code",    type: "VARCHAR(10)" },
      { name: "driving_side",    type: "VARCHAR(10)" },
      { name: "electricity",     type: "VARCHAR(100)" },
      { name: "water_safety",    type: "TEXT" },
      { name: "health_info",     type: "TEXT" },
      { name: "safety_info",     type: "TEXT" },
      { name: "transport_info",  type: "TEXT" },
      { name: "food_info",       type: "TEXT" },
      { name: "culture_info",    type: "TEXT" },
      { name: "wildlife_info",   type: "TEXT" },
      { name: "geography_info",  type: "TEXT" },
    ]);

    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_countries_slug      ON countries(slug)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_active    ON countries(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_featured  ON countries(is_featured)`,
      `CREATE INDEX IF NOT EXISTS idx_countries_continent ON countries(continent)`,
    ];
    for (const idx of indexes) await query(idx).catch(() => {});

    logger.info("[DB] ✅ Countries schema verified & ensured");
  } catch (err) {
    logger.warn('[Countries] Schema ensure non-fatal:', err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensureNotificationsSchema
// ════════════════════════════════════════════════════════════════════════════

const ensureNotificationsSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id               SERIAL PRIMARY KEY,
        user_id          INTEGER,
        user_email       VARCHAR(255),
        sender_type      VARCHAR(20)  NOT NULL DEFAULT 'system',
        sender_id        INTEGER,
        sender_name      VARCHAR(255),
        type             VARCHAR(50)  NOT NULL DEFAULT 'general',
        title            VARCHAR(255) NOT NULL,
        message          TEXT         NOT NULL,
        action_url       VARCHAR(500),
        action_label     VARCHAR(100),
        image_url        VARCHAR(500),
        metadata         JSONB        DEFAULT '{}'::JSONB,
        target_scope     VARCHAR(30)  DEFAULT 'individual',
        target_role      VARCHAR(50),
        target_segment   VARCHAR(100),
        priority         VARCHAR(20)  DEFAULT 'normal',
        category         VARCHAR(50)  DEFAULT 'general',
        is_read          BOOLEAN      DEFAULT false,
        read_at          TIMESTAMP,
        reaction         VARCHAR(20),
        reacted_at       TIMESTAMP,
        reply_text       TEXT,
        replied_at       TIMESTAMP,
        admin_reply      TEXT,
        admin_replied_at TIMESTAMP,
        admin_replied_by INTEGER,
        email_sent       BOOLEAN      DEFAULT false,
        email_sent_at    TIMESTAMP,
        push_sent        BOOLEAN      DEFAULT false,
        deleted_at       TIMESTAMP,
        archived_at      TIMESTAMP,
        expires_at       TIMESTAMP,
        created_at       TIMESTAMP    DEFAULT NOW(),
        updated_at       TIMESTAMP    DEFAULT NOW()
      )
    `);

    await addColumns("notifications", [
      { name: "user_id",          type: "INTEGER" },
      { name: "user_email",       type: "VARCHAR(255)" },
      { name: "sender_type",      type: "VARCHAR(20) DEFAULT 'system'" },
      { name: "sender_id",        type: "INTEGER" },
      { name: "sender_name",      type: "VARCHAR(255)" },
      { name: "type",             type: "VARCHAR(50) DEFAULT 'general'" },
      { name: "title",            type: "VARCHAR(255)" },
      { name: "message",          type: "TEXT" },
      { name: "action_url",       type: "VARCHAR(500)" },
      { name: "action_label",     type: "VARCHAR(100)" },
      { name: "image_url",        type: "VARCHAR(500)" },
      { name: "metadata",         type: "JSONB DEFAULT '{}'::JSONB" },
      { name: "target_scope",     type: "VARCHAR(30) DEFAULT 'individual'" },
      { name: "target_role",      type: "VARCHAR(50)" },
      { name: "target_segment",   type: "VARCHAR(100)" },
      { name: "priority",         type: "VARCHAR(20) DEFAULT 'normal'" },
      { name: "category",         type: "VARCHAR(50) DEFAULT 'general'" },
      { name: "is_read",          type: "BOOLEAN DEFAULT false" },
      { name: "read_at",          type: "TIMESTAMP" },
      { name: "reaction",         type: "VARCHAR(20)" },
      { name: "reacted_at",       type: "TIMESTAMP" },
      { name: "reply_text",       type: "TEXT" },
      { name: "replied_at",       type: "TIMESTAMP" },
      { name: "admin_reply",      type: "TEXT" },
      { name: "admin_replied_at", type: "TIMESTAMP" },
      { name: "admin_replied_by", type: "INTEGER" },
      { name: "email_sent",       type: "BOOLEAN DEFAULT false" },
      { name: "email_sent_at",    type: "TIMESTAMP" },
      { name: "push_sent",        type: "BOOLEAN DEFAULT false" },
      { name: "deleted_at",       type: "TIMESTAMP" },
      { name: "archived_at",      type: "TIMESTAMP" },
      { name: "expires_at",       type: "TIMESTAMP" },
      { name: "updated_at",       type: "TIMESTAMP DEFAULT NOW()" },
    ]);

    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_notif_user_id
         ON notifications(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_user_email
         ON notifications(user_email)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_type
         ON notifications(type)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_is_read
         ON notifications(is_read)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_created_at
         ON notifications(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_target_scope
         ON notifications(target_scope)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_priority
         ON notifications(priority)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_deleted_at
         ON notifications(deleted_at) WHERE deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_notif_expires_at
         ON notifications(expires_at) WHERE expires_at IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_notif_user_unread
         ON notifications(user_id, is_read, created_at DESC)
         WHERE deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_notif_broadcast
         ON notifications(target_scope, created_at DESC)
         WHERE target_scope != 'individual' AND deleted_at IS NULL`,
    ]);

    await ensureUpdatedAtTrigger("notifications");

    logger.info("[DB] ✅ Notifications schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Notifications schema ensure failed:", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensureContactSchema
// ════════════════════════════════════════════════════════════════════════════

const ensureContactSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id                   SERIAL PRIMARY KEY,
        full_name            VARCHAR(255) NOT NULL,
        email                VARCHAR(255) NOT NULL,
        phone                VARCHAR(50),
        whatsapp             VARCHAR(50),
        subject              VARCHAR(255),
        message              TEXT         NOT NULL,
        trip_type            VARCHAR(100),
        travel_date          DATE,
        number_of_travelers  INTEGER,
        source               VARCHAR(100) DEFAULT 'website',
        ip_address           VARCHAR(50),
        user_agent           TEXT,
        referrer_url         TEXT,
        status               VARCHAR(20)  DEFAULT 'new',
        is_read              BOOLEAN      DEFAULT false,
        is_starred           BOOLEAN      DEFAULT false,
        priority             VARCHAR(20)  DEFAULT 'normal',
        assigned_to          INTEGER,
        assigned_at          TIMESTAMP,
        responded_at         TIMESTAMP,
        response_notes       TEXT,
        tags                 TEXT[]       DEFAULT '{}'::TEXT[],
        read_at              TIMESTAMP,
        archived_at          TIMESTAMP,
        created_at           TIMESTAMP    DEFAULT NOW(),
        updated_at           TIMESTAMP    DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_replies (
        id             SERIAL PRIMARY KEY,
        message_id     INTEGER      NOT NULL,
        subject        VARCHAR(255),
        body           TEXT         NOT NULL,
        sent_by        INTEGER,
        sent_by_name   VARCHAR(255),
        sent_by_email  VARCHAR(255),
        status         VARCHAR(50)  DEFAULT 'sent',
        sent_at        TIMESTAMP    DEFAULT NOW(),
        created_at     TIMESTAMP    DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE OR REPLACE VIEW v_contact_stats AS
      SELECT
        COUNT(*)                                                           AS total_messages,
        COUNT(*) FILTER (WHERE status = 'new')                            AS new_messages,
        COUNT(*) FILTER (WHERE is_read = false)                           AS unread_messages,
        COUNT(*) FILTER (WHERE status = 'replied')                        AS replied_messages,
        COUNT(*) FILTER (WHERE status = 'archived')                       AS archived_messages,
        COUNT(*) FILTER (WHERE status = 'spam')                           AS spam_messages,
        COUNT(*) FILTER (WHERE priority = 'urgent')                       AS urgent_messages,
        COUNT(*) FILTER (WHERE priority = 'high')                         AS high_priority_messages,
        COUNT(*) FILTER (WHERE is_starred = true)                         AS starred_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)                AS today_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')  AS week_messages,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') AS month_messages
      FROM contact_messages;
    `).catch(() => {});

    logger.info("[DB] ✅ Contact messaging schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Contact schema ensure failed:", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensureChatSchema
// ════════════════════════════════════════════════════════════════════════════

const ensureChatSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id          SERIAL PRIMARY KEY,
        session_id  VARCHAR(255) UNIQUE NOT NULL,
        user_id     INTEGER,
        email       VARCHAR(255),
        full_name   VARCHAR(255),
        source      VARCHAR(50)  DEFAULT 'frontend',
        status      VARCHAR(20)  DEFAULT 'active',
        last_active TIMESTAMPTZ  DEFAULT NOW(),
        created_at  TIMESTAMPTZ  DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id           SERIAL PRIMARY KEY,
        session_id   VARCHAR(255) NOT NULL,
        sender_type  VARCHAR(50)  NOT NULL,
        sender_id    INTEGER,
        sender_name  VARCHAR(255),
        sender_email VARCHAR(255),
        body         TEXT         NOT NULL,
        metadata     JSONB        DEFAULT '{}'::JSONB,
        is_read      BOOLEAN      DEFAULT false,
        created_at   TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_chat_sessions_session_id ON chat_sessions(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC)`,
    ]);

    logger.info("[DB] ✅ Chat schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Chat schema ensure failed:", err.message);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ensureTestimonialsSchema
// ════════════════════════════════════════════════════════════════════════════

const ensureTestimonialsSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS testimonials (
        id               SERIAL PRIMARY KEY,
        name             VARCHAR(255) NOT NULL,
        location         VARCHAR(255),
        avatar_url       TEXT,
        rating           INTEGER      NOT NULL DEFAULT 5
                         CHECK (rating >= 1 AND rating <= 5),
        trip             VARCHAR(255),
        date_text        VARCHAR(100),
        testimonial_text TEXT         NOT NULL,
        is_featured      BOOLEAN      DEFAULT false,
        is_active        BOOLEAN      DEFAULT false,
        sort_order       INTEGER      DEFAULT 0,
        user_id          INTEGER,
        created_at       TIMESTAMP    DEFAULT NOW(),
        updated_at       TIMESTAMP    DEFAULT NOW()
      )
    `);

    await addColumns("testimonials", [
      { name: "user_id",   type: "INTEGER" },
      { name: "is_active", type: "BOOLEAN DEFAULT false" },
    ]);

    await pool.query(
      `ALTER TABLE testimonials ALTER COLUMN is_active SET DEFAULT false`,
    ).catch(() => {});

    await createIndexes([
      `CREATE INDEX IF NOT EXISTS idx_testimonials_is_active
         ON testimonials(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_is_featured
         ON testimonials(is_featured)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_rating
         ON testimonials(rating)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_sort_order
         ON testimonials(sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_created_at
         ON testimonials(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_user_id
         ON testimonials(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_testimonials_active_featured
         ON testimonials(is_active, is_featured, sort_order)`,
    ]);

    await ensureUpdatedAtTrigger("testimonials");

    logger.info("[DB] ✅ Testimonials schema verified & ensured");
  } catch (err) {
    logger.warn("[DB] Testimonials schema ensure failed:", err.message);
  }
};

// ── Graceful Close ───────────────────────────────────────────────────────────

const closeConnections = async () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  await Promise.allSettled([pool.end(), sequelize.close()]);
  logger.info("[DB] All connections closed");
};

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  query,
  pool,
  sequelize,
  Sequelize,
  testConnection,
  closeConnections,
  ensureUserSchema,
  ensureDestinationsSchema,
  ensureNotificationsSchema,
  ensureContactSchema,
  ensureChatSchema,
  ensureGallerySchema,
  ensureSubscribersSchema,
  ensurePostsSchema,
  ensureBookingsSchema,
  ensurePackagesSchema,
  ensureTestimonialsSchema,
};