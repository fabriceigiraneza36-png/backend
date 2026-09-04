"use strict";

const { query } = require("../config/db");
const { ensureDestinationSchema } = require("../controllers/destinationsController");

const images = [
  "https://images.unsplash.com/photo-1549366021-9f761d450615?auto=format&fit=crop&w=1600&q=85",
  "https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&w=1600&q=85",
  "https://images.unsplash.com/photo-1535338454770-8be927b5a00b?auto=format&fit=crop&w=1600&q=85",
];

const attractions = [
  { slug: "chimpanzee-tracking", name: "Chimpanzee Tracking", description: "Follow expert guides through Kibale's forest to observe habituated chimpanzees in their natural habitat.", imageUrl: images[0] },
  { slug: "bigodi-wetland-sanctuary", name: "Bigodi Wetland Sanctuary", description: "Walk the community-run wetland trail for birdwatching, primate encounters, and rich local ecology.", imageUrl: images[1] },
  { slug: "forest-canopy-walk", name: "Forest Canopy Walk", description: "See the forest from above on a guided canopy experience surrounded by Uganda's remarkable biodiversity.", imageUrl: images[2] },
];

(async () => {
  await ensureDestinationSchema();
  const country = await query("SELECT id FROM countries WHERE slug = $1", ["uganda"]);
  if (!country.rows[0]) throw new Error("Uganda country record was not found");

  const result = await query(
    `INSERT INTO destinations (
      country_id, name, slug, tagline, short_description, description, overview,
      category, destination_type, difficulty, highlights, activities, attractions,
      image_url, image_urls, hero_image, cover_image_url, status, is_active, is_featured,
      latitude, longitude, duration_days, duration_nights, duration_display
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13::jsonb,
      $14, $15, $16, $17, 'published', true, true,
      $18, $19, $20, $21, $22
    )
    ON CONFLICT (slug) DO UPDATE SET
      country_id = EXCLUDED.country_id,
      tagline = EXCLUDED.tagline,
      short_description = EXCLUDED.short_description,
      description = EXCLUDED.description,
      overview = EXCLUDED.overview,
      category = EXCLUDED.category,
      destination_type = EXCLUDED.destination_type,
      difficulty = EXCLUDED.difficulty,
      highlights = EXCLUDED.highlights,
      activities = EXCLUDED.activities,
      attractions = EXCLUDED.attractions,
      image_url = EXCLUDED.image_url,
      image_urls = EXCLUDED.image_urls,
      hero_image = EXCLUDED.hero_image,
      cover_image_url = EXCLUDED.cover_image_url,
      status = EXCLUDED.status,
      is_active = EXCLUDED.is_active,
      is_featured = EXCLUDED.is_featured,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      duration_days = EXCLUDED.duration_days,
      duration_nights = EXCLUDED.duration_nights,
      duration_display = EXCLUDED.duration_display,
      updated_at = NOW()
    RETURNING id, name, slug, country_id, attractions`,
    [
      country.rows[0].id,
      "Kibale National Park",
      "kibale-forest-national-park",
      "Where the forest comes alive",
      "A primate-rich rainforest destination in western Uganda.",
      "Kibale National Park protects one of Africa's most beautiful tropical forests and is renowned for intimate chimpanzee encounters, diverse primates, and community-led nature experiences.",
      "Explore ancient rainforest, meet expert trackers, and discover the landscapes around Kibale.",
      "wildlife",
      "Rainforest & Primates",
      "moderate",
      ["Chimpanzee tracking", "Primate diversity", "Rainforest trails"],
      ["Chimpanzee tracking", "Birdwatching", "Nature walks"],
      JSON.stringify(attractions),
      images[0],
      images,
      images[0],
      images[1],
      0.4536,
      30.3903,
      3,
      2,
      "3 days / 2 nights",
    ],
  );

  console.log(JSON.stringify(result.rows[0], null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
