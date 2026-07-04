// utils/countryTransformer.js
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COUNTRY RESPONSE TRANSFORMER v5.0
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
 *
 * v5.0 additions:
 *   - hero_images   (JSONB string array)
 *   - activities    (JSONB array of { name, description?, image_url? })
 *   - short_notes   (TEXT — max 6 sentences shown on CountryPage)
 *   - faqs          (JSONB array of { question, answer })
 *   - extra_info    (JSONB object — health, safety, culture, transport, etc.)
 *   - transformCountryCard now includes hero_images + short_notes
 */

'use strict'

/* ═══════════════════════════════════════════════════════════════════════════
   NUMBER FORMATTERS
═══════════════════════════════════════════════════════════════════════════ */

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
 */
const formatPercent = (raw, decimals = 1) => {
  const n = parseFloat(raw)
  if (n === null || n === undefined || !Number.isFinite(n)) return null
  return `${parseFloat(n.toFixed(decimals))}%`
}

/**
 * Format a decimal rating — hide zeros.
 * "4.50" → 4.5 | "0.00" → null
 */
const formatRating = (raw) => {
  const n = parseFloat(raw)
  if (!n || !Number.isFinite(n) || n === 0) return null
  return parseFloat(n.toFixed(1))
}

/* ═══════════════════════════════════════════════════════════════════════════
   TYPE GUARDS
═══════════════════════════════════════════════════════════════════════════ */

/** Return array only if non-empty, else null */
const cleanArray = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null
  return arr
}

/** Return object only if it has keys, else null */
const cleanObject = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  if (Object.keys(obj).length === 0) return null
  return obj
}

/** Return trimmed string or null */
const cleanString = (str) => {
  if (!str || str === 'null' || str === 'undefined') return null
  const s = String(str).trim()
  return s.length > 0 ? s : null
}

/**
 * Parse a JSONB column that may arrive as:
 *   - already-parsed JS value (pg driver with json columns)
 *   - JSON string
 *   - null / undefined
 */
const parseJsonb = (val) => {
  if (val === null || val === undefined) return null
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return null }
  }
  return val // already object/array
}

/* ═══════════════════════════════════════════════════════════════════════════
   RECURSIVE NULL STRIPPER
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Recursively remove null/undefined values.
 * Keeps false and 0 — only removes truly absent values.
 */
const removeNulls = (obj) => {
  if (Array.isArray(obj)) {
    return obj
      .filter(v => v !== null && v !== undefined)
      .map(removeNulls)
  }
  if (obj && typeof obj === 'object') {
    const cleaned = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue
      if (
        typeof v === 'object' &&
        !Array.isArray(v) &&
        Object.keys(v).length === 0
      ) continue
      cleaned[k] = removeNulls(v)
    }
    return cleaned
  }
  return obj
}

/* ═══════════════════════════════════════════════════════════════════════════
   NEW v5.0 BUILDERS
   (hero_images, activities, short_notes, faqs, extra_info)
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build the hero images array.
 *
 * Priority order:
 *   1. hero_images JSONB column   (explicitly set per country)
 *   2. image_url                  (legacy single image)
 *   3. images JSONB array         (generic images column if present)
 *
 * Returns: string[] (deduplicated, max 8) | null
 */
const buildHeroImages = (raw) => {
  const seen = new Set()
  const add  = (v) => { if (v && typeof v === 'string' && v.trim()) seen.add(v.trim()) }

  // 1. Dedicated hero_images column
  const heroArr = parseJsonb(raw.hero_images)
  if (Array.isArray(heroArr)) heroArr.forEach(add)

  // 2. Legacy single image
  add(raw.image_url)
  add(raw.hero_image)

  // 3. Generic images array
  const imgArr = parseJsonb(raw.images)
  if (Array.isArray(imgArr)) imgArr.forEach(add)

  const result = [...seen].slice(0, 8)
  return result.length > 0 ? result : null
}

/**
 * Build activities array.
 *
 * DB column: activities JSONB
 * Supported shapes:
 *   - ["Gorilla trekking", "Safari", ...]           (string array)
 *   - [{ name, description, image_url }, ...]       (object array)
 *   - mixed
 *
 * Returns: Array<{ name: string, description?: string, image_url?: string }> | null
 */
const buildActivities = (raw) => {
  const parsed = parseJsonb(raw.activities)
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const result = parsed
    .map((act) => {
      if (!act) return null

      // String shorthand
      if (typeof act === 'string') {
        const name = act.trim()
        return name ? { name } : null
      }

      // Object
      if (typeof act === 'object') {
        const name = cleanString(act.name || act.title || act.activity)
        if (!name) return null
        return removeNulls({
          name,
          description: cleanString(act.description || act.desc),
          image_url:   cleanString(act.image_url || act.imageUrl || act.img),
          icon:        cleanString(act.icon),
        })
      }

      return null
    })
    .filter(Boolean)

  return result.length > 0 ? result : null
}

/**
 * Build short notes.
 *
 * Returns a plain string (max 6 sentences, ~400 chars target).
 * Priority: short_notes → short_description → tagline
 */
const buildShortNotes = (raw) => {
  // Prefer the dedicated column
  const src = cleanString(raw.short_notes)
           || cleanString(raw.short_description)
           || cleanString(raw.tagline)

  if (!src) return null

  // Limit to 6 sentences
  const sentences = src
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 6)

  return sentences.join(' ')
}

/**
 * Build FAQs array.
 *
 * DB column: faqs JSONB
 * Each entry: { question: string, answer: string }
 *
 * Returns: Array<{ question, answer }> | null
 */
const buildFaqs = (raw) => {
  const parsed = parseJsonb(raw.faqs)
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const result = parsed
    .map((faq) => {
      if (!faq || typeof faq !== 'object') return null
      const question = cleanString(faq.question || faq.q)
      const answer   = cleanString(faq.answer   || faq.a)
      if (!question || !answer) return null
      return { question, answer }
    })
    .filter(Boolean)

  return result.length > 0 ? result : null
}

/**
 * Build extra tourism info.
 *
 * DB column: extra_info JSONB  +  individual scalar columns added in v5.0:
 *   population, area_sq_km, calling_code, driving_side,
 *   electricity, water_safety, health_info, safety_info,
 *   transport_info, food_info, culture_info, wildlife_info,
 *   geography_info
 *
 * Individual scalar columns take precedence over matching keys inside the
 * extra_info JSONB blob (so admins can override via structured fields).
 *
 * Returns: object | null
 */
const buildExtraInfo = (raw) => {
  // Start with whatever is already in the JSONB blob
  const blob = parseJsonb(raw.extra_info)
  const base = (blob && typeof blob === 'object' && !Array.isArray(blob))
    ? { ...blob }
    : {}

  // Overlay scalar columns (structured always wins over blob)
  const pop  = formatPopulation(raw.population)
  const area = raw.area_sq_km ? formatArea(raw.area_sq_km) : null

  const overlay = {
    population:    pop                              || base.population    || null,
    area:          area                             || base.area          || null,
    calling_code:  cleanString(raw.calling_code)   || base.calling_code  || null,
    driving_side:  cleanString(raw.driving_side)   || base.driving_side  || null,
    electricity:   cleanString(raw.electricity)    || base.electricity   || null,
    water_safety:  cleanString(raw.water_safety)   || base.water         || null,
    health:        cleanString(raw.health_info)    || base.health        || null,
    safety:        cleanString(raw.safety_info)    || base.safety        || null,
    transport:     cleanString(raw.transport_info) || base.transport     || null,
    food:          cleanString(raw.food_info)      || base.food          || null,
    culture:       cleanString(raw.culture_info)   || base.culture       || null,
    wildlife:      cleanString(raw.wildlife_info)  || base.wildlife      || null,
    geography:     cleanString(raw.geography_info) || base.geography     || null,
  }

  // Merge remaining blob keys that are not in overlay
  const merged = { ...base, ...overlay }

  // Strip nulls and return null if empty
  const cleaned = removeNulls(merged)
  return cleaned && Object.keys(cleaned).length > 0 ? cleaned : null
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXISTING SECTION BUILDERS (unchanged from v4.0)
═══════════════════════════════════════════════════════════════════════════ */

const buildPracticalInfo = (raw) => {
  const info = {}

  if (raw.visa_info)   info.visa   = cleanString(raw.visa_info)
  if (raw.health_info) info.health = cleanString(raw.health_info)

  if (raw.currency || raw.currency_symbol) {
    info.currency = removeNulls({
      name: cleanString(raw.currency),
      code: cleanString(raw.currency_symbol),
    })
  }

  if (raw.electrical_plug || raw.voltage) {
    info.electricity = removeNulls({
      plug_type: cleanString(raw.electrical_plug),
      voltage:   cleanString(raw.voltage),
    })
  }

  if (raw.water_safety)  info.water         = cleanString(raw.water_safety)
  if (raw.internet_tld)  info.connectivity  = { internet_tld: cleanString(raw.internet_tld) }
  if (raw.calling_code)  info.calling_code  = cleanString(raw.calling_code)
  if (raw.driving_side)  info.driving_side  = cleanString(raw.driving_side)

  return Object.keys(info).length > 0 ? info : null
}

const buildGovernment = (raw) => {
  if (!raw.government_type) return null
  return { type: cleanString(raw.government_type) }
}

const buildGeography = (raw) => {
  const geo    = cleanObject(parseJsonb(raw.geography))
  const areaFmt = formatArea(raw.area)
  if (!geo && !areaFmt) return null

  const result = {}
  if (areaFmt)           result.area          = areaFmt
  if (geo?.terrain)      result.terrain       = geo.terrain
  if (geo?.highest_point) result.highest_point = geo.highest_point
  if (geo?.lakes?.length) result.lakes        = geo.lakes
  if (geo?.forests?.length) result.forests    = geo.forests
  if (geo?.volcanoes?.length) result.volcanoes = geo.volcanoes

  return Object.keys(result).length > 0 ? result : null
}

const buildClimate = (raw) => {
  const result = {}

  if (raw.climate)            result.overview  = cleanString(raw.climate)
  if (raw.best_time_to_visit) result.best_time = cleanString(raw.best_time_to_visit)

  const seasons = cleanObject(parseJsonb(raw.seasons))
  if (seasons) {
    const cleaned = {}
    for (const [key, val] of Object.entries(seasons)) {
      if (val && typeof val === 'object' && val.months) {
        const label = key
          .replace(/_\d+$/, '')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase())
        cleaned[label] = removeNulls({ months: val.months, note: val.note })
      }
    }
    if (Object.keys(cleaned).length > 0) result.seasons = cleaned
  }

  return Object.keys(result).length > 0 ? result : null
}

const buildRatings = (raw) => {
  const rating = formatRating(raw.average_rating)
  const total  = parseInt(raw.total_reviews, 10) || 0
  if (!rating && total === 0) return null
  return {
    average: rating,
    total,
    label: total === 1 ? '1 Review' : `${total} Reviews`,
  }
}

const buildLanguages = (raw) => {
  const official = cleanArray(parseJsonb(raw.official_languages) || raw.official_languages)
  const all      = cleanArray(parseJsonb(raw.languages)          || raw.languages)

  if (!official && !all) return null

  return removeNulls({
    official,
    other: all && official
      ? cleanArray(all.filter(l => !official.includes(l)))
      : all,
  })
}

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

const buildWildlife = (raw) => {
  const w = cleanObject(parseJsonb(raw.wildlife))
  if (!w) return null

  const result = {}
  if (w.primates?.length) result.primates = w.primates
  if (w.big_five?.length) result.big_five = w.big_five
  if (w.birds?.length)    result.birds    = w.birds

  return Object.keys(result).length > 0 ? result : null
}

const buildCuisine = (raw) => {
  const c = cleanObject(parseJsonb(raw.cuisine))
  if (!c) return null

  const result = {}
  if (c.famous_dishes?.length) result.famous_dishes = c.famous_dishes
  if (c.staples?.length)       result.staples        = c.staples
  if (c.beverages?.length)     result.beverages      = c.beverages

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Build media block.
 *
 * v5.0: hero_images array takes priority over legacy single fields.
 */
const buildMedia = (raw) => {
  const heroImages = buildHeroImages(raw)
  const hero = heroImages?.[0] ?? cleanString(raw.image_url) ?? null

  return removeNulls({
    hero,
    hero_images: heroImages,
    gallery:     heroImages, // alias — frontend uses both names
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN TRANSFORMER  —  getOne (detail page)
═══════════════════════════════════════════════════════════════════════════ */

/**
 * transformCountry(raw)
 *
 * Input:  raw database row (from countries + LEFT JOIN destinations COUNT)
 * Output: clean, tourism-focused response object
 *
 * The CountryPage consumes these top-level keys directly:
 *   name, slug, continent, flag_url, flag, tagline,
 *   hero_images, short_notes, description,
 *   capital, currency, language, timezone, climate,
 *   best_time_to_visit, visa_info,
 *   activities, faqs, extra_info,
 *   destination_count, is_featured,
 *   destinations (appended by controller after transform)
 */
const transformCountry = (raw) => {
  if (!raw) return null

  const transformed = {
    /* ── Identity ─────────────────────────────────────────────────────── */
    id:            raw.id,
    slug:          raw.slug,
    name:          raw.name,
    official_name: cleanString(raw.official_name) || raw.name,

    /* ── Flag ─────────────────────────────────────────────────────────── */
    flag:     cleanString(raw.flag),      // emoji "🇷🇼"
    flag_url: cleanString(raw.flag_url),  // URL  "https://..."

    /* ── Location ─────────────────────────────────────────────────────── */
    continent: cleanString(raw.continent),
    region:    cleanString(raw.region),
    capital:   cleanString(raw.capital),

    /* ── Branding ─────────────────────────────────────────────────────── */
    tagline: cleanString(raw.tagline),
    motto:   cleanString(raw.motto),

    /* ── v5.0 — CountryPage essentials ───────────────────────────────── */

    // Full-screen hero slideshow images
    hero_images: buildHeroImages(raw),

    // Short paragraph (max 6 sentences) shown below hero
    short_notes: buildShortNotes(raw),

    // Destination cards section
    // (destinations[] appended by controller — not built here)
    destination_count: raw.destination_count != null
      ? parseInt(raw.destination_count, 10)
      : null,

    // Activity cards section
    activities: buildActivities(raw),

    // FAQs accordion
    faqs: buildFaqs(raw),

    // Extra tourism info (health, safety, culture, transport …)
    extra_info: buildExtraInfo(raw),

    /* ── Descriptions ─────────────────────────────────────────────────── */
    description:      cleanString(raw.description),
    full_description: cleanString(raw.full_description),

    /* ── Core facts (flat — frontend reads these directly) ───────────── */
    currency:           cleanString(raw.currency),
    language:           cleanString(raw.language),
    timezone:           cleanString(raw.timezone),
    climate:            cleanString(raw.climate),
    best_time_to_visit: cleanString(raw.best_time_to_visit),
    visa_info:          cleanString(raw.visa_info),

    /* ── Key facts (human-readable) ───────────────────────────────────── */
    key_facts: buildKeyFacts(raw),

    /* ── Structured sections (existing tourism content) ──────────────── */
    government:         buildGovernment(raw),
    languages:          buildLanguages(raw),
    climate_detail:     buildClimate(raw),   // renamed to avoid clash with flat `climate`
    geography:          buildGeography(raw),
    practical_info:     buildPracticalInfo(raw),
    wildlife:           buildWildlife(raw),
    cuisine:            buildCuisine(raw),
    ratings:            buildRatings(raw),

    /* ── Tourism lists ────────────────────────────────────────────────── */
    highlights:            cleanArray(parseJsonb(raw.highlights) || raw.highlights),
    experiences:           cleanArray(parseJsonb(raw.experiences) || raw.experiences),
    travel_tips:           cleanArray(parseJsonb(raw.travel_tips) || raw.travel_tips),
    neighboring_countries: cleanArray(
      parseJsonb(raw.neighboring_countries) || raw.neighboring_countries
    ),

    /* ── Media ────────────────────────────────────────────────────────── */
    media: buildMedia(raw),

    /* ── Misc ─────────────────────────────────────────────────────────── */
    demonym:    cleanString(raw.demonym),
    is_featured: raw.is_featured || false,
  }

  return removeNulls(transformed)
}

/* ═══════════════════════════════════════════════════════════════════════════
   CARD TRANSFORMER  —  getAll / getFeatured / similar_countries
═══════════════════════════════════════════════════════════════════════════ */

/**
 * transformCountryCard(raw)
 *
 * Lighter version for listing pages.
 * v5.0: now includes hero_images and short_notes so cards can show
 *       slideshow thumbnails and preview text.
 */
const transformCountryCard = (raw) => {
  if (!raw) return null

  return removeNulls({
    /* ── Identity ─────────────────────────────────────────────────────── */
    id:   raw.id,
    slug: raw.slug,
    name: raw.name,

    /* ── Branding ─────────────────────────────────────────────────────── */
    tagline: cleanString(raw.tagline),

    /* ── Flag ─────────────────────────────────────────────────────────── */
    flag:     cleanString(raw.flag),
    flag_url: cleanString(raw.flag_url),

    /* ── Location ─────────────────────────────────────────────────────── */
    continent: cleanString(raw.continent),
    region:    cleanString(raw.region),
    capital:   cleanString(raw.capital),

    /* ── Preview text ─────────────────────────────────────────────────── */
    short_notes:  buildShortNotes(raw),
    description:  cleanString(raw.description),

    /* ── Images ───────────────────────────────────────────────────────── */
    image_url:   cleanString(raw.image_url),
    hero_images: buildHeroImages(raw),

    /* ── Climate hint ─────────────────────────────────────────────────── */
    best_time_to_visit: cleanString(raw.best_time_to_visit),

    /* ── Stats ────────────────────────────────────────────────────────── */
    destination_count: raw.destination_count != null
      ? parseInt(raw.destination_count, 10)
      : 0,
    is_featured: raw.is_featured || false,

    /* ── Ratings ──────────────────────────────────────────────────────── */
    ratings: buildRatings(raw),
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTS
═══════════════════════════════════════════════════════════════════════════ */

module.exports = {
  transformCountry,
  transformCountryCard,

  // Exposed for reuse in other transformers / tests
  formatPopulation,
  formatArea,
  formatPercent,
  formatRating,
  removeNulls,
  cleanString,
  cleanArray,
  cleanObject,
  parseJsonb,

  // v5.0 builders exposed for unit testing
  buildHeroImages,
  buildActivities,
  buildShortNotes,
  buildFaqs,
  buildExtraInfo,
}