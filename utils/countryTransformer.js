/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COUNTRY RESPONSE TRANSFORMER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Transforms raw database rows into clean, tourism-focused API responses.
 *
 * Philosophy:
 *   - Tourists need inspiration, not encyclopedias
 *   - Never expose internal/technical fields
 *   - Format numbers for humans (14000000 → "14 Million")
 *   - Hide empty/null/zero fields gracefully
 *   - No head of state (changes frequently)
 *   - No ethnic groups (sensitive, unhelpful for tourism)
 *   - No population density, median age, GDP (irrelevant to visitors)
 *   - Ratings hidden until real reviews exist
 */

'use strict'

// ─── Number Formatters ────────────────────────────────────────────────────────

/**
 * Format large population numbers into human-readable strings.
 * 14000000  → "14 Million"
 * 850000    → "850 Thousand"
 * 1200000   → "1.2 Million"
 */
const formatPopulation = (raw) => {
  const n = parseFloat(raw)
  if (!n || !Number.isFinite(n)) return null

  if (n >= 1_000_000_000) {
    const val = n / 1_000_000_000
    return `${parseFloat(val.toFixed(1)).toString().replace(/\.0$/, '')} Billion`
  }
  if (n >= 1_000_000) {
    const val = n / 1_000_000
    return `${parseFloat(val.toFixed(1)).toString().replace(/\.0$/, '')} Million`
  }
  if (n >= 1_000) {
    const val = n / 1_000
    return `${parseFloat(val.toFixed(1)).toString().replace(/\.0$/, '')} Thousand`
  }
  return n.toLocaleString()
}

/**
 * Format area in square kilometers.
 * 26338.00 → "26,338 km²"
 */
const formatArea = (raw) => {
  const n = parseFloat(raw)
  if (!n || !Number.isFinite(n)) return null
  return `${Math.round(n).toLocaleString()} km²`
}

/**
 * Format a percentage value.
 * 17.50 → "17.5%"
 * 73.22 → "73.2%"
 */
const formatPercent = (raw, decimals = 1) => {
  const n = parseFloat(raw)
  if (n === null || n === undefined || !Number.isFinite(n)) return null
  return `${parseFloat(n.toFixed(decimals))}%`
}

/**
 * Format a decimal rating.
 * "4.50" → 4.5
 * "0.00" → null (hide it)
 */
const formatRating = (raw) => {
  const n = parseFloat(raw)
  if (!n || !Number.isFinite(n) || n === 0) return null
  return parseFloat(n.toFixed(1))
}

/**
 * Format independence date to readable year.
 * "1962-07-01T00:00:00.000Z" → "July 1, 1962"
 */
const formatDate = (raw) => {
  if (!raw) return null
  try {
    return new Date(raw).toLocaleDateString('en-US', {
      year:  'month',
      month: 'long',
      day:   'numeric',
    })
  } catch {
    return null
  }
}

// ─── Array/Object Guards ──────────────────────────────────────────────────────

/** Return array only if non-empty, else null */
const cleanArray = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null
  return arr
}

/** Return object only if it has keys and is non-empty, else null */
const cleanObject = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  if (Object.keys(obj).length === 0) return null
  return obj
}

/** Return value only if truthy and not 'null' string */
const cleanString = (str) => {
  if (!str || str === 'null' || str === 'undefined') return null
  const s = String(str).trim()
  return s.length > 0 ? s : null
}

// ─── Tourism Sections Builder ─────────────────────────────────────────────────

/**
 * Build the "practical info" section tourists actually need.
 */
const buildPracticalInfo = (raw) => {
  const info = {}

  // Visa
  if (raw.visa_info) {
    info.visa = cleanString(raw.visa_info)
  }

  // Health
  if (raw.health_info) {
    info.health = cleanString(raw.health_info)
  }

  // Currency
  if (raw.currency || raw.currency_symbol) {
    info.currency = {
      name:   cleanString(raw.currency),
      code:   cleanString(raw.currency_symbol),
      tips:   raw.currency === 'Rwandan Franc'
        ? 'Credit cards accepted at major hotels. ATMs available in Kigali. Mobile money (MTN, Airtel) widely used. USD cash useful for tips.'
        : null,
    }
    // Remove null tips
    if (!info.currency.tips) delete info.currency.tips
  }

  // Electricity
  if (raw.electrical_plug || raw.voltage) {
    info.electricity = {
      plug_type: cleanString(raw.electrical_plug),
      voltage:   cleanString(raw.voltage),
    }
  }

  // Water safety
  if (raw.water_safety) {
    info.water = cleanString(raw.water_safety)
  }

  // Internet & SIM
  if (raw.internet_tld) {
    info.connectivity = {
      internet_tld: cleanString(raw.internet_tld),
    }
  }

  // Calling code
  if (raw.calling_code) {
    info.calling_code = cleanString(raw.calling_code)
  }

  // Driving side
  if (raw.driving_side) {
    info.driving_side = cleanString(raw.driving_side)
  }

  return Object.keys(info).length > 0 ? info : null
}

/**
 * Build government info — type only, never head of state.
 */
const buildGovernment = (raw) => {
  if (!raw.government_type) return null
  return {
    type: cleanString(raw.government_type),
  }
}

/**
 * Build geography section.
 */
const buildGeography = (raw) => {
  const geo = cleanObject(raw.geography)
  if (!geo && !raw.area) return null

  const result = {}

  if (raw.area) result.area = formatArea(raw.area)
  if (geo) {
    if (geo.terrain)       result.terrain        = geo.terrain
    if (geo.highest_point) result.highest_point  = geo.highest_point
    if (geo.lakes?.length) result.lakes          = geo.lakes
    if (geo.forests?.length) result.forests      = geo.forests
    if (geo.volcanoes?.length) result.volcanoes  = geo.volcanoes
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Build a clean seasons/climate block.
 */
const buildClimate = (raw) => {
  const result = {}

  if (raw.climate)           result.overview        = cleanString(raw.climate)
  if (raw.best_time_to_visit) result.best_time      = cleanString(raw.best_time_to_visit)

  const seasons = cleanObject(raw.seasons)
  if (seasons) {
    const cleaned = {}
    for (const [key, val] of Object.entries(seasons)) {
      if (val && typeof val === 'object' && val.months) {
        // Humanize key: dry_season_1 → "Dry Season"
        const label = key
          .replace(/_\d+$/, '')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase())
        cleaned[label] = {
          months: val.months,
          note:   val.note || undefined,
        }
      }
    }
    if (Object.keys(cleaned).length > 0) result.seasons = cleaned
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Build ratings block — hide if no reviews yet.
 */
const buildRatings = (raw) => {
  const rating = formatRating(raw.average_rating)
  const total  = parseInt(raw.total_reviews, 10) || 0

  if (!rating && total === 0) return null

  return {
    average: rating,
    total:   total,
    label:   total === 1 ? '1 Review' : `${total} Reviews`,
  }
}

/**
 * Build the languages section cleanly.
 */
const buildLanguages = (raw) => {
  const official = cleanArray(raw.official_languages)
  const all      = cleanArray(raw.languages)

  if (!official && !all) return null

  return {
    official: official,
    other:    all && official
      ? all.filter(l => !official.includes(l)).filter(Boolean) || null
      : all,
  }
}

// ─── INTERNAL FIELDS TO ALWAYS STRIP ─────────────────────────────────────────

const STRIP_FIELDS = new Set([
  // Technical / internal
  'created_at',
  'updated_at',
  'display_order',
  'is_active',
  'is_featured',
  'is_popular',
  'cover_image',
  'bounding_box',
  'latitude',
  'longitude',
  // Presented differently
  'population',
  'area',
  'population_density',
  'urban_population',
  'median_age',
  'life_expectancy',
  'literacy_rate',
  'head_of_state',
  'government_type',
  'ethnic_groups',
  'religions',
  'average_rating',
  'total_reviews',
  'destination_count',
  'view_count',
  'flag_url',          // presented inside flag object
  'flag',              // presented inside flag object
  'official_languages',
  'national_languages',
  'languages',
  'electrical_plug',
  'voltage',
  'water_safety',
  'internet_tld',
  'calling_code',
  'driving_side',
  'currency',
  'currency_symbol',
  'visa_info',
  'health_info',
  'climate',
  'best_time_to_visit',
  'seasons',
  'geography',
  'economic_info',     // not for tourists
  'independence_date', // moved to heritage section if needed
  'sub_region',        // region is enough
  'additional_info',   // often null
])

// ─── Main Transformer ─────────────────────────────────────────────────────────

/**
 * transformCountry(raw)
 *
 * Input:  raw database row
 * Output: clean, tourism-focused response object
 */
const transformCountry = (raw) => {
  if (!raw) return null

  const transformed = {
    // ── Identity ──────────────────────────────────────────────────────────
    id:            raw.id,
    slug:          raw.slug,
    name:          raw.name,
    official_name: cleanString(raw.official_name) || raw.name,

    // ── Flag ─────────────────────────────────────────────────────────────
    flag: {
      emoji: cleanString(raw.flag),
      url:   cleanString(raw.flag_url),
    },

    // ── Location ──────────────────────────────────────────────────────────
    location: {
      continent: cleanString(raw.continent),
      region:    cleanString(raw.region),
      capital:   cleanString(raw.capital),
    },

    // ── Tagline / Branding ────────────────────────────────────────────────
    tagline: cleanString(raw.tagline),
    motto:   cleanString(raw.motto),

    // ── Descriptions ──────────────────────────────────────────────────────
    description:      cleanString(raw.description),
    full_description: cleanString(raw.full_description),

    // ── Key Facts (human-readable) ────────────────────────────────────────
    key_facts: buildKeyFacts(raw),

    // ── Government ───────────────────────────────────────────────────────
    government: buildGovernment(raw),

    // ── Languages ────────────────────────────────────────────────────────
    languages: buildLanguages(raw),

    // ── Climate & Best Time ───────────────────────────────────────────────
    climate: buildClimate(raw),

    // ── Geography ────────────────────────────────────────────────────────
    geography: buildGeography(raw),

    // ── Practical Info ────────────────────────────────────────────────────
    practical_info: buildPracticalInfo(raw),

    // ── Tourism Content ───────────────────────────────────────────────────
    highlights:         cleanArray(raw.highlights),
    experiences:        cleanArray(raw.experiences),
    travel_tips:        cleanArray(raw.travel_tips),
    neighboring_countries: cleanArray(raw.neighboring_countries),

    // ── Wildlife ─────────────────────────────────────────────────────────
    wildlife: buildWildlife(raw),

    // ── Cuisine ──────────────────────────────────────────────────────────
    cuisine: buildCuisine(raw),

    // ── Media ─────────────────────────────────────────────────────────────
    media: buildMedia(raw),

    // ── Ratings (hidden if no reviews) ───────────────────────────────────
    ratings: buildRatings(raw),

    // ── Demonym ──────────────────────────────────────────────────────────
    demonym: cleanString(raw.demonym),

    // ── Timezone ─────────────────────────────────────────────────────────
    timezone: cleanString(raw.timezone),
  }

  // Strip null/undefined top-level keys for a clean response
  return removeNulls(transformed)
}

/**
 * Build key facts block — human-readable, tourism-relevant only.
 */
const buildKeyFacts = (raw) => {
  const facts = {}

  const pop = formatPopulation(raw.population)
  if (pop) facts.population = pop

  const area = formatArea(raw.area)
  if (area) facts.area = area

  const urbanPop = formatPercent(raw.urban_population)
  if (urbanPop) facts.urban_population = urbanPop

  const literacy = formatPercent(raw.literacy_rate)
  if (literacy) facts.literacy_rate = literacy

  const lifeExp = parseFloat(raw.life_expectancy)
  if (lifeExp && Number.isFinite(lifeExp)) {
    facts.life_expectancy = `${Math.round(lifeExp)} years`
  }

  return Object.keys(facts).length > 0 ? facts : null
}

/**
 * Build wildlife section.
 */
const buildWildlife = (raw) => {
  const w = cleanObject(raw.wildlife)
  if (!w) return null

  const result = {}
  if (w.primates?.length) result.primates = w.primates
  if (w.big_five?.length) result.big_five = w.big_five
  if (w.birds?.length)    result.birds    = w.birds

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Build cuisine section.
 */
const buildCuisine = (raw) => {
  const c = cleanObject(raw.cuisine)
  if (!c) return null

  const result = {}
  if (c.famous_dishes?.length) result.famous_dishes = c.famous_dishes
  if (c.staples?.length)       result.staples        = c.staples
  if (c.beverages?.length)     result.beverages      = c.beverages

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Build media/images block — clean URLs only.
 */
const buildMedia = (raw) => {
  const images = []

  if (raw.hero_image)   images.push(raw.hero_image)
  if (raw.image_url)    images.push(raw.image_url)
  if (Array.isArray(raw.images)) {
    images.push(...raw.images)
  }

  // Deduplicate
  const unique = [...new Set(images.filter(Boolean))]

  return {
    hero:    cleanString(raw.hero_image) || cleanString(raw.image_url) || null,
    gallery: unique.length > 0 ? unique : null,
  }
}

/**
 * Recursively remove null/undefined values from an object.
 * Keeps false and 0.
 */
const removeNulls = (obj) => {
  if (Array.isArray(obj)) {
    return obj.filter(v => v !== null && v !== undefined).map(removeNulls)
  }
  if (obj && typeof obj === 'object') {
    const cleaned = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue
      if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
      cleaned[k] = removeNulls(v)
    }
    return cleaned
  }
  return obj
}

/**
 * Transform a list of countries for listing pages.
 * Lighter version — no full_description, no detailed sections.
 */
const transformCountryCard = (raw) => {
  if (!raw) return null

  const ratings = buildRatings(raw)

  return removeNulls({
    id:       raw.id,
    slug:     raw.slug,
    name:     raw.name,
    tagline:  cleanString(raw.tagline),

    flag: {
      emoji: cleanString(raw.flag),
      url:   cleanString(raw.flag_url),
    },

    location: {
      continent: cleanString(raw.continent),
      region:    cleanString(raw.region),
      capital:   cleanString(raw.capital),
    },

    description: cleanString(raw.description),
    highlights:  cleanArray(raw.highlights),

    climate: raw.best_time_to_visit
      ? { best_time: cleanString(raw.best_time_to_visit) }
      : null,

    media: buildMedia(raw),

    ratings,
  })
}

module.exports = {
  transformCountry,
  transformCountryCard,
  formatPopulation,
  formatArea,
  formatPercent,
  formatRating,
  removeNulls,
}