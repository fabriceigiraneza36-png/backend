'use strict'

const { pool, query } = require('../config/db')
const { destroyCloudinaryUrls } = require('./cloudinaryCleanup')

const BATCH_SIZE = 100
const MEDIA_BATCH_SIZE = 20
const CHILD_TABLES = {
  destinations: [
    'destination_comments', 'destination_exclusions', 'destination_inclusions',
    'destination_likes', 'destination_practical_info', 'destination_pricing',
    'destination_ratings', 'destination_seasons', 'destination_tips',
  ],
  countries: [
    'country_comments', 'country_images', 'country_likes', 'country_ratings',
    'country_historical_events', 'country_unesco_sites',
  ],
}

let schemaReady
const ensureSchema = () => {
  if (!schemaReady) schemaReady = query(`
    CREATE TABLE IF NOT EXISTS admin_purge_jobs (
      id UUID PRIMARY KEY,
      resource VARCHAR(30) NOT NULL CHECK (resource IN ('destinations', 'countries')),
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      total_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      requested_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() => query(`
    CREATE INDEX IF NOT EXISTS idx_admin_purge_jobs_created_at
    ON admin_purge_jobs(created_at DESC)
  `)).then(() => query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_purge_jobs_one_active_per_resource
    ON admin_purge_jobs(resource) WHERE status IN ('queued', 'running')
  `)).catch((err) => { schemaReady = null; throw err })
  return schemaReady
}

const tableExists = async (client, table) => {
  const { rows } = await client.query(
    'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS present',
    ['public', table],
  )
  return rows[0]?.present === true
}

const deleteChildren = async (client, tableNames, foreignKey, ids) => {
  for (const table of tableNames) {
    if (!await tableExists(client, table)) continue
    await client.query(`DELETE FROM "${table}" WHERE "${foreignKey}" = ANY($1::integer[])`, [ids])
  }
}

const mediaUrlsForDestinations = async (client, ids) => {
  const urls = []
  const { rows } = await client.query(
    `SELECT image_url, image_urls, hero_image, cover_image_url, thumbnail_url, attractions
     FROM destinations WHERE id = ANY($1::integer[])`, [ids],
  )
  for (const row of rows) {
    urls.push(row.image_url, row.hero_image, row.cover_image_url, row.thumbnail_url)
    if (Array.isArray(row.image_urls)) urls.push(...row.image_urls)
    try {
      const attractions = Array.isArray(row.attractions) ? row.attractions : JSON.parse(row.attractions || '[]')
      if (Array.isArray(attractions)) urls.push(...attractions.map(x => x?.imageUrl || x?.image_url || x?.image))
    } catch {}
  }
  if (await tableExists(client, 'destination_images')) {
    const images = await client.query(
      'SELECT image_url FROM destination_images WHERE destination_id = ANY($1::integer[])', [ids],
    )
    urls.push(...images.rows.map(x => x.image_url))
  }
  return urls.filter(Boolean)
}

const mediaUrlsForCountries = async (client, ids) => {
  const urls = []
  const { rows } = await client.query(
    `SELECT image_url, cover_image_url, hero_image, hero_images, images, flag_url
     FROM countries WHERE id = ANY($1::integer[])`, [ids],
  )
  for (const row of rows) {
    urls.push(row.image_url, row.cover_image_url, row.hero_image, row.flag_url)
    for (const value of [row.hero_images, row.images]) {
      try {
        const parsed = Array.isArray(value) ? value : (typeof value === 'string' ? JSON.parse(value) : [])
        if (Array.isArray(parsed)) urls.push(...parsed.map(x => typeof x === 'string' ? x : x?.url))
      } catch {}
    }
  }
  const dests = await client.query('SELECT id FROM destinations WHERE country_id = ANY($1::integer[])', [ids])
  if (dests.rows.length) {
    const destIds = dests.rows.map(x => x.id)
    urls.push(...await mediaUrlsForDestinations(client, destIds))
    await deleteChildren(client, CHILD_TABLES.destinations, 'destination_id', destIds)
  }
  return urls.filter(Boolean)
}

const processJob = async (jobId, resource) => {
  try {
    await ensureSchema()
    await query("UPDATE admin_purge_jobs SET status = 'running', updated_at = NOW() WHERE id = $1", [jobId])
    const count = await query(`SELECT COUNT(*)::integer AS count FROM "${resource}"`)
    await query('UPDATE admin_purge_jobs SET total_count = $2, updated_at = NOW() WHERE id = $1', [jobId, count.rows[0].count])
    let processed = 0

    while (true) {
      const client = await pool.connect()
      let ids = []
      let urls = []
      try {
        await client.query('BEGIN')
        const selected = await client.query(`SELECT id FROM "${resource}" ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [BATCH_SIZE])
        ids = selected.rows.map(row => row.id)
        if (!ids.length) {
          await client.query('COMMIT')
          break
        }
        if (resource === 'destinations') {
          urls = await mediaUrlsForDestinations(client, ids)
          await deleteChildren(client, CHILD_TABLES.destinations, 'destination_id', ids)
          await client.query('DELETE FROM destinations WHERE id = ANY($1::integer[])', [ids])
        } else {
          urls = await mediaUrlsForCountries(client, ids)
          await deleteChildren(client, CHILD_TABLES.countries, 'country_id', ids)
          await client.query('DELETE FROM countries WHERE id = ANY($1::integer[])', [ids])
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
      processed += ids.length
      await query(
        "UPDATE admin_purge_jobs SET processed_count = $2, updated_at = NOW() WHERE id = $1",
        [jobId, processed],
      )
      // Cloud media cleanup is deliberately outside the database transaction and is
      // throttled to keep provider rate limits and API request timeouts out of the path.
      for (let i = 0; i < urls.length; i += MEDIA_BATCH_SIZE) {
        await destroyCloudinaryUrls(urls.slice(i, i + MEDIA_BATCH_SIZE)).catch(err =>
          console.error('[PurgeJobs] media cleanup batch failed:', err.message))
      }
    }

    // Clear legacy orphan rows that no longer have a parent record.
    for (const table of CHILD_TABLES[resource]) {
      const exists = await query(
        'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS present',
        ['public', table],
      )
      if (exists.rows[0]?.present) await query(`DELETE FROM "${table}"`)
    }
    if (resource === 'destinations') {
      await query('UPDATE countries SET destination_count = 0, updated_at = NOW()').catch(err =>
        console.warn('[PurgeJobs] Could not reset country destination counts:', err.message))
    }
    await query("UPDATE admin_purge_jobs SET status = 'completed', updated_at = NOW() WHERE id = $1", [jobId])
  } catch (err) {
    await query(
      "UPDATE admin_purge_jobs SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1",
      [jobId, String(err.message || err).slice(0, 2000)],
    ).catch(() => {})
    console.error('[PurgeJobs] purge job failed:', jobId, err)
  }
}

const startPurge = async ({ resource, requestedBy }) => {
  if (!['destinations', 'countries'].includes(resource)) throw new Error('Unsupported purge resource')
  await ensureSchema()
  const active = await query(
    "SELECT id FROM admin_purge_jobs WHERE resource = $1 AND status IN ('queued', 'running') LIMIT 1",
    [resource],
  )
  if (active.rows.length) {
    const err = new Error('A purge job for this table is already queued or running')
    err.code = 'PURGE_ALREADY_RUNNING'
    err.jobId = active.rows[0].id
    throw err
  }
  let rows
  try {
    const inserted = await query(
      `INSERT INTO admin_purge_jobs (id, resource, status, requested_by)
       VALUES (gen_random_uuid(), $1, 'queued', $2) RETURNING id`,
      [resource, requestedBy ? String(requestedBy).slice(0, 255) : null],
    )
    rows = inserted.rows
  } catch (insertErr) {
    if (insertErr.code === '23505') {
      const err = new Error('A purge job for this table is already queued or running')
      err.code = 'PURGE_ALREADY_RUNNING'
      throw err
    }
    throw insertErr
  }
  const jobId = rows[0].id
  setImmediate(() => { void processJob(jobId, resource) })
  return jobId
}

const getPurgeJob = async (jobId) => {
  await ensureSchema()
  const { rows } = await query(
    `SELECT id, resource, status, total_count, processed_count, error, created_at, updated_at
     FROM admin_purge_jobs WHERE id = $1`, [jobId],
  )
  return rows[0] || null
}

module.exports = { startPurge, getPurgeJob }
