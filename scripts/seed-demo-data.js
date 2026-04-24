/**
 * Seed Demo Data Script
 * Inserts: 1 Country, 1 Destination, 1 Gallery Image, 1 Virtual Tour
 */

require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env") });
const { query, pool, closeConnections } = require("../config/db");

const PLACEHOLDER_IMAGE = "https://via.placeholder.com/800x600?text=Altuvera+Placeholder";

async function seed() {
  try {
    console.log("🌱 Seeding demo data...\n");

    // ─── 1. Insert Country ───────────────────────────────────────────
    console.log("📍 Inserting country...");
    const countryResult = await query(
      `INSERT INTO countries (
        slug, name, official_name, capital, continent, region,
        description, tagline, currency, timezone, calling_code,
        image_url, cover_image_url, hero_image, images,
        is_featured, is_active, display_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING *`,
      [
        "demo-country",
        "Demo Country",
        "The Democratic Republic of Demo",
        "Demotown",
        "Africa",
        "East Africa",
        "A beautiful demo country for testing the Altuvera platform.",
        "True Adventures In High Places",
        "Demo Dollar",
        "UTC+2",
        "+250",
        PLACEHOLDER_IMAGE,
        PLACEHOLDER_IMAGE,
        PLACEHOLDER_IMAGE,
        [PLACEHOLDER_IMAGE],
        true,
        true,
        1,
      ]
    );
    const country = countryResult.rows[0];
    console.log(`✅ Country inserted — ID: ${country.id}, Name: ${country.name}\n`);

    // ─── 2. Insert Destination ──────────────────────────────────────
    console.log("🏔️ Inserting destination...");
    const destResult = await query(
      `INSERT INTO destinations (
        country_id, name, slug, tagline, short_description, description,
        category, difficulty, status, is_active, is_featured,
        image_url, image_urls, cover_image_url, hero_image, thumbnail_url,
        latitude, longitude, nearest_city, nearest_airport,
        duration_days, duration_nights, duration_display,
        min_group_size, max_group_size, rating, review_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING *`,
      [
        country.id,
        "Demo Safari Park",
        "demo-safari-park",
        "Experience the wild like never before",
        "A stunning demo destination for testing.",
        "This is a full description of the Demo Safari Park, showcasing the incredible wildlife and scenery.",
        "safari",
        "moderate",
        "published",
        true,
        true,
        PLACEHOLDER_IMAGE,
        [PLACEHOLDER_IMAGE],
        PLACEHOLDER_IMAGE,
        PLACEHOLDER_IMAGE,
        PLACEHOLDER_IMAGE,
        -1.94,
        30.06,
        "Demotown",
        "Demo International Airport",
        3,
        2,
        "3 Days / 2 Nights",
        2,
        12,
        4.8,
        42,
      ]
    );
    const destination = destResult.rows[0];
    console.log(`✅ Destination inserted — ID: ${destination.id}, Name: ${destination.name}\n`);

    // ─── 3. Insert Gallery Image ────────────────────────────────────
    console.log("🖼️ Inserting gallery image...");
    const galleryResult = await query(
      `INSERT INTO gallery (
        title, image_url, thumbnail_url, category, location,
        country_id, destination_id, sort_order, is_featured, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        "Demo Gallery Image",
        PLACEHOLDER_IMAGE,
        PLACEHOLDER_IMAGE,
        "demo",
        "Demo Safari Park",
        country.id,
        destination.id,
        1,
        true,
        true,
      ]
    );
    const gallery = galleryResult.rows[0];
    console.log(`✅ Gallery image inserted — ID: ${gallery.id}, Title: ${gallery.title}\n`);

    // ─── 4. Insert Virtual Tour ─────────────────────────────────────
    console.log("🎥 Inserting virtual tour...");
    const tourResult = await query(
      `INSERT INTO virtual_tours (
        title, slug, description, destination_id,
        video_url, thumbnail_url, panorama_url,
        duration, is_featured, is_active, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING *`,
      [
        "Demo Virtual Safari",
        "demo-virtual-safari",
        "Take a virtual walk through the Demo Safari Park.",
        destination.id,
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        PLACEHOLDER_IMAGE,
        null,
        "5 min",
        true,
        true,
        1,
      ]
    );
    const tour = tourResult.rows[0];
    console.log(`✅ Virtual tour inserted — ID: ${tour.id}, Title: ${tour.title}\n`);

    // ─── 5. Verification ────────────────────────────────────────────
    console.log("🔍 Verifying data integrity...\n");

    const countryCheck = await query(
      `SELECT id, name, slug, destination_count FROM countries WHERE id = $1`,
      [country.id]
    );

    const destCheck = await query(
      `SELECT id, name, slug, country_id FROM destinations WHERE id = $1`,
      [destination.id]
    );

    const galleryCheck = await query(
      `SELECT id, title, country_id, destination_id FROM gallery WHERE id = $1`,
      [gallery.id]
    );

    const tourCheck = await query(
      `SELECT id, title, destination_id FROM virtual_tours WHERE id = $1`,
      [tour.id]
    );

    console.log("📋 Verification Results:");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`Country      : ${JSON.stringify(countryCheck.rows[0])}`);
    console.log(`Destination  : ${JSON.stringify(destCheck.rows[0])}`);
    console.log(`Gallery      : ${JSON.stringify(galleryCheck.rows[0])}`);
    console.log(`Virtual Tour : ${JSON.stringify(tourCheck.rows[0])}`);
    console.log("═══════════════════════════════════════════════════════\n");

    // Relationship integrity check
    const relCheck = await query(
      `SELECT
        c.name AS country_name,
        d.name AS destination_name,
        g.title AS gallery_title,
        vt.title AS tour_title
      FROM countries c
      LEFT JOIN destinations d ON d.country_id = c.id
      LEFT JOIN gallery g ON g.country_id = c.id
      LEFT JOIN virtual_tours vt ON vt.destination_id = d.id
      WHERE c.id = $1`,
      [country.id]
    );

    console.log("🔗 Relationship Chain:");
    console.log(relCheck.rows[0]);
    console.log("\n✅ All demo data seeded and verified successfully!");

  } catch (err) {
    console.error("\n❌ Seeding failed:", err.message);
    if (err.detail) console.error("Detail:", err.detail);
    process.exit(1);
  } finally {
    await closeConnections();
  }
}

seed();
