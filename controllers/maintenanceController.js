// controllers/maintenanceController.js
// Admin-only maintenance category inspection and resumable asynchronous purges.
'use strict'

const { query } = require('../config/db')
const logger = require('../utils/logger')
const { destroyCloudinaryUrls } = require('../utils/cloudinaryCleanup')

const CATEGORY_TABLES = {
  destinations: [
    'destination_tips', 'destination_practical_info', 'destination_tags',
    'destination_reviews', 'destination_itineraries', 'destination_faqs',
    'destination_images', 'destination_comments', 'destination_exclusions',
    'destination_inclusions', 'destination_likes', 'destination_pricing',
    'destination_ratings', 'destination_seasons', 'destinations',
  ],
  countries: [
    'country_comments', 'country_images', 'country_likes', 'country_ratings',
    'country_historical_events', 'country_unesco_sites',
    'destination_tips', 'destination_practical_info', 'destination_tags',
    'destination_reviews', 'destination_itineraries', 'destination_faqs',
    'destination_images', 'destination_comments', 'destination_exclusions',
    'destination_inclusions', 'destination_likes', 'destination_pricing',
    'destination_ratings', 'destination_seasons', 'destinations', 'countries',
  ],
  bookings: ['package_bookings', 'admin_info_requests', 'bookings'],
  packages: ['package_chat_preferences', 'package_messages', 'package_bookings', 'admin_info_requests', 'packages'],
  messaging: [
    'typing_indicators', 'message_receipts', 'message_group_members',
    'messages', 'message_groups', 'message_preferences', 'conversations',
    'chat_messages', 'chat_sessions',
  ],
  comments: ['destination_comments', 'country_comments', 'post_comments'],
  posts: ['post_comments', 'posts'],
  contact: ['contact_replies', 'contact_messages'],
  users: ['user_sessions', 'message_group_members', 'message_preferences', 'notification_preferences', 'users'],
  reviews: ['destination_reviews', 'reviews'],
  gallery: ['gallery'],
  team: ['team_members', 'team'],
  testimonials: ['testimonials'],
  faqs: ['destination_faqs', 'faqs'],
  services: ['services'],
  tips: ['destination_tips', 'tips'],
  pages: ['pages'],
  subscribers: ['subscribers'],
  notifications: ['push_subscriptions', 'notification_preferences', 'notifications'],
  system_logs: ['activity_log', 'email_log'],
  media: ['hero_slides', 'virtual_tours'],
}

const ALL_CATEGORIES = Object.keys(CATEGORY_TABLES)
const BATCH_SIZE = 100

const extractCloudinaryUrls = (value, urls = []) => {
  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/res\.cloudinary\.com\/[^\s"'<>]+/gi) || []
    for (const match of matches) {
      const url = match.replace(/[),.;]+$/, '')
      if (url) urls.push(url)
    }
  } else if (Array.isArray(value)) {
    value.forEach(item => extractCloudinaryUrls(item, urls))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => extractCloudinaryUrls(item, urls))
  }
  return urls
}
let schemaPromise

const ensureJobsSchema = async () => {
  if (!schemaPromise) {
    schemaPromise = query(`
      CREATE TABLE IF NOT EXISTS maintenance_purge_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        tables JSONB NOT NULL DEFAULT '[]'::jsonb,
        total_records BIGINT NOT NULL DEFAULT 0,
        deleted_records BIGINT NOT NULL DEFAULT 0,
        current_table TEXT,
        table_results JSONB NOT NULL DEFAULT '{}'::jsonb,
        error TEXT,
        requested_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => query(`
      CREATE INDEX IF NOT EXISTS idx_maintenance_purge_jobs_created
      ON maintenance_purge_jobs(created_at DESC)
    `)).then(() => query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_purge_one_active_category
      ON maintenance_purge_jobs(category) WHERE status IN ('queued', 'running')
    `)).catch((err) => {
      schemaPromise = null
      throw err
    })
  }
  return schemaPromise
}

const uniqueTables = (category) => [...new Set(CATEGORY_TABLES[category] || [])]

const existingTables = async (tables) => {
  if (!tables.length) return []
  const { rows } = await query(
    'SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[])',
    ['public', tables],
  )
  const found = new Set(rows.map(row => row.tablename))
  return tables.filter(table => found.has(table))
}

// Fast estimate from PostgreSQL statistics: avoids scanning every row just to
// render the dashboard or start a purge. Actual deletions are counted per batch.
const estimateTable = async (table) => {
  const { rows } = await query(
    `SELECT GREATEST(c.reltuples, 0)::bigint AS count
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('r', 'p')`,
    [table],
  )
  if (!rows.length) throw new Error(`Table public."${table}" is missing or is not a table`)
  return Number(rows[0].count || 0)
}

const mapLimit = async (items, limit, worker) => {
  const output = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      output[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return output
}

exports.listCategories = async (req, res) => {
  try {
    const configuredByCategory = await Promise.all(ALL_CATEGORIES.map(async category => {
      const configured = uniqueTables(category)
      const tablesPresent = await existingTables(configured)
      return {
        category,
        tablesPresent,
        missingTables: configured.filter(table => !tablesPresent.includes(table)),
      }
    }))
    const allPresent = [...new Set(configuredByCategory.flatMap(item => item.tablesPresent))]
    // One global concurrency limit avoids flooding Neon with parallel count queries.
    const estimates = await mapLimit(allPresent, 8, async table => [table, await estimateTable(table)])
    const estimateByTable = new Map(estimates)
    const data = configuredByCategory.map(item => {
      const tables = item.tablesPresent.map(table => ({
        table,
        count: estimateByTable.get(table),
        estimated: true,
      }))
      return {
        category: item.category,
        tables,
        missingTables: item.missingTables,
        totalRecords: tables.reduce((sum, table) => sum + table.count, 0),
        estimated: true,
      }
    })
    return res.json({ success: true, data, countMode: 'estimated' })
  } catch (err) {
    logger.error('[Maintenance] listCategories failed:', err.message)
    return res.status(500).json({
      success: false,
      message: 'Failed to inspect maintenance tables. No counts were substituted with zero.',
      error: err.message,
    })
  }
}

const updateJob = async (jobId, fields) => {
  const { status, currentTable, totalRecords, deletedRecords, tableResults, error } = fields
  await query(
    `UPDATE maintenance_purge_jobs SET
      status = COALESCE($2, status),
      current_table = $3,
      total_records = COALESCE($4, total_records),
      deleted_records = COALESCE($5, deleted_records),
      table_results = COALESCE($6::jsonb, table_results),
      error = $7,
      updated_at = NOW()
     WHERE id = $1`,
    [
      jobId, status ?? null, currentTable ?? null,
      totalRecords ?? null, deletedRecords ?? null,
      tableResults == null ? null : JSON.stringify(tableResults),
      error ?? null,
    ],
  )
}

const processPurgeJob = async (jobId) => {
  try {
    await ensureJobsSchema()
    // Atomic claim prevents two workers from processing the same queued job.
    const claimed = await query(
      `UPDATE maintenance_purge_jobs SET status = 'running', updated_at = NOW()
       WHERE id = $1 AND status = 'queued' RETURNING id`,
      [jobId],
    )
    if (!claimed.rows.length) return

    const { rows: jobs } = await query(
      'SELECT category, tables, total_records, deleted_records, table_results FROM maintenance_purge_jobs WHERE id = $1',
      [jobId],
    )
    const job = jobs[0]
    if (!job || !CATEGORY_TABLES[job.category]) throw new Error('Purge job has an invalid category')
    const tables = Array.isArray(job.tables) ? job.tables : JSON.parse(job.tables || '[]')
    let results = typeof job.table_results === 'object' && job.table_results
      ? job.table_results
      : JSON.parse(job.table_results || '{}')
    let totalRecords = Number(job.total_records || 0)
    let deletedRecords = Number(job.deleted_records || 0)

    // Record quick estimates up front; exact work happens in bounded delete batches.
    if (!totalRecords) {
      const estimates = await Promise.all(tables.map(async table => [table, await estimateTable(table)]))
      totalRecords = estimates.reduce((sum, [, count]) => sum + count, 0)
      await updateJob(jobId, { totalRecords, deletedRecords, tableResults: results, currentTable: null, error: null })
    }

    for (const table of tables) {
      if (results[table]?.status === 'completed') continue
      const estimatedBefore = results[table]?.estimatedBefore ?? await estimateTable(table)
      let deletedForTable = Number(results[table]?.deleted || 0)
      await updateJob(jobId, { currentTable: table, totalRecords, deletedRecords, tableResults: results, error: null })

      while (true) {
        // Each statement is deliberately small and commits independently, keeping
        // locks, transaction size, and statement duration bounded.
        const batch = await query(
          `WITH batch AS (
             SELECT ctid FROM "${table}" LIMIT $1
           ), deleted AS (
             DELETE FROM "${table}" WHERE ctid IN (SELECT ctid FROM batch) RETURNING *
           )
           SELECT to_jsonb(deleted) AS row_data FROM deleted`,
          [BATCH_SIZE],
        )
        const removed = Number(batch.rows.length || 0)
        if (!removed) break
        const mediaUrls = batch.rows.flatMap(row => extractCloudinaryUrls(row.row_data))
        deletedForTable += removed
        deletedRecords += removed
        results = {
          ...results,
          [table]: { estimatedBefore, deleted: deletedForTable, status: 'running' },
        }
        await updateJob(jobId, {
          currentTable: table, totalRecords, deletedRecords, tableResults: results, error: null,
        })
        // Run Cloudinary cleanup outside the SQL delete statement. Shared assets
        // are preserved by the reference scan; cleanup failures never undo DB purges.
        if (mediaUrls.length) {
          await destroyCloudinaryUrls(mediaUrls).catch(err =>
            logger.error(`[Maintenance] Cloudinary cleanup failed for ${table} batch: ${err.message}`))
        }
      }

      results = {
        ...results,
        [table]: { estimatedBefore, deleted: deletedForTable, after: 0, status: 'completed' },
      }
      await updateJob(jobId, {
        currentTable: null, totalRecords, deletedRecords, tableResults: results, error: null,
      })
    }

    await updateJob(jobId, {
      status: 'completed', currentTable: null, totalRecords, deletedRecords,
      tableResults: results, error: null,
    })
    logger.warn(
      `[Maintenance] PURGE COMPLETE category="${job.category}" job=${jobId} deleted=${deletedRecords}`,
    )
  } catch (err) {
    logger.error(`[Maintenance] purge job ${jobId} failed:`, err.message)
    await updateJob(jobId, {
      status: 'failed', currentTable: null, error: String(err.message || err).slice(0, 3000),
    }).catch(updateErr => logger.error('[Maintenance] could not save purge failure:', updateErr.message))
  }
}

exports.purgeCategory = async (req, res) => {
  try {
    const category = String(req.params?.category || '')
    const confirm = req.body?.confirm
    if (!CATEGORY_TABLES[category]) {
      return res.status(400).json({
        success: false,
        message: `Unknown category "${category}". Allowed: ${ALL_CATEGORIES.join(', ')}.`,
      })
    }
    if (confirm !== 'DELETE_ALL') {
      return res.status(400).json({
        success: false,
        message: 'Explicit confirmation required. Send { confirm: "DELETE_ALL" }.',
      })
    }

    await ensureJobsSchema()
    const tables = await existingTables(uniqueTables(category))
    if (!tables.length) {
      return res.status(400).json({ success: false, message: `No existing tables found for category "${category}".` })
    }
    const { rows } = await query(
      `INSERT INTO maintenance_purge_jobs (category, status, tables, requested_by)
       VALUES ($1, 'queued', $2::jsonb, $3) RETURNING id, category, status, total_records, deleted_records, current_table`,
      [category, JSON.stringify(tables), String(req.user?.email || req.user?.id || 'unknown').slice(0, 255)],
    ).catch(err => {
      if (err.code === '23505') {
        const conflict = new Error('A purge for this category is already queued or running')
        conflict.code = 'PURGE_ALREADY_RUNNING'
        throw conflict
      }
      throw err
    })
    const job = rows[0]
    setImmediate(() => { void processPurgeJob(job.id) })
    return res.status(202).json({
      success: true,
      message: `Purge queued for "${category}". Track progress until status is completed.`,
      jobId: job.id,
      category,
      status: job.status,
      data: job,
    })
  } catch (err) {
    if (err.code === 'PURGE_ALREADY_RUNNING') {
      return res.status(409).json({ success: false, message: err.message })
    }
    logger.error(`[Maintenance] purgeCategory "${req.params?.category}" failed:`, err.message)
    return res.status(500).json({
      success: false,
      message: 'Could not queue purge. No success response was issued.',
      error: err.message,
    })
  }
}

exports.getPurgeJob = async (req, res) => {
  try {
    await ensureJobsSchema()
    const { rows } = await query(
      `SELECT id, category, status, tables, total_records, deleted_records,
              current_table, table_results, error, created_at, updated_at
       FROM maintenance_purge_jobs WHERE id = $1`,
      [req.params.jobId],
    )
    if (!rows.length) return res.status(404).json({ success: false, message: 'Purge job not found' })
    let job = rows[0]
    // If a worker died while a job was running, requeue it after a quiet period.
    // The update is conditional so active workers keep ownership of fresh jobs.
    if (job.status === 'running' && Date.now() - new Date(job.updated_at).getTime() > 120_000) {
      const recovered = await query(
        `UPDATE maintenance_purge_jobs SET status = 'queued', updated_at = NOW()
         WHERE id = $1 AND status = 'running' AND updated_at < NOW() - INTERVAL '2 minutes'
         RETURNING status, updated_at`,
        [job.id],
      )
      if (recovered.rows.length) {
        job = { ...job, status: 'queued', updated_at: recovered.rows[0].updated_at }
        setImmediate(() => { void processPurgeJob(job.id) })
      }
    }
    // Convert snake_case DB columns to a stable API shape.
    return res.json({
      success: true,
      data: {
        id: job.id,
        category: job.category,
        status: job.status,
        tables: job.tables,
        totalRecords: Number(job.total_records || 0),
        deletedRecords: Number(job.deleted_records || 0),
        currentTable: job.current_table,
        tableResults: job.table_results || {},
        error: job.error,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
    })
  } catch (err) {
    logger.error('[Maintenance] getPurgeJob failed:', err.message)
    return res.status(500).json({ success: false, message: 'Could not read purge job status.', error: err.message })
  }
}

// Resume only queued jobs on process startup. Running jobs are deliberately not
// double-claimed; the admin can safely retry a failed job after inspecting it.
setImmediate(async () => {
  try {
    await ensureJobsSchema()
    const { rows } = await query("SELECT id FROM maintenance_purge_jobs WHERE status = 'queued' ORDER BY created_at")
    for (const row of rows) void processPurgeJob(row.id)
  } catch (err) {
    logger.warn('[Maintenance] queued purge recovery skipped:', err.message)
  }
})
