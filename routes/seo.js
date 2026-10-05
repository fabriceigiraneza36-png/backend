"use strict";

const express = require("express");
const { query } = require("../config/db");

const router = express.Router();

const xmlEscape = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const isoDate = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
};

/**
 * Dynamic destination sitemap.
 * New published destinations created from the admin panel are included
 * automatically, so the public site does not depend on a manually edited
 * static sitemap.
 */
router.get("/destinations-sitemap.xml", async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        d.id,
        d.slug,
        d.updated_at,
        d.created_at,
        COALESCE(
          d.image_url,
          d.thumbnail_url,
          (
            SELECT di.image_url
            FROM destination_images di
            WHERE di.destination_id = d.id
              AND COALESCE(di.is_active, true) = true
            ORDER BY di.is_primary DESC, di.sort_order ASC, di.id ASC
            LIMIT 1
          )
        ) AS image_url
      FROM destinations d
      WHERE COALESCE(d.is_active, true) = true
        AND COALESCE(LOWER(d.status), 'published') IN ('published', 'active', 'live')
        AND NULLIF(TRIM(d.slug), '') IS NOT NULL
      ORDER BY d.updated_at DESC NULLS LAST, d.id DESC
    `);

    const urls = rows.map((destination) => {
      const loc = `https://www.altuverasafaris.com/destinations/${encodeURIComponent(destination.slug)}`;
      const image = destination.image_url
        ? `
    <image:image>
      <image:loc>${xmlEscape(destination.image_url)}</image:loc>
      <image:title>${xmlEscape(destination.slug.replace(/[-_]+/g, " "))}</image:title>
    </image:image>`
        : "";

      return `  <url>
    <loc>${xmlEscape(loc)}</loc>
    <lastmod>${isoDate(destination.updated_at || destination.created_at)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>${image}
  </url>`;
    }).join("\n");

    res
      .status(200)
      .type("application/xml")
      .set("Cache-Control", "public, max-age=3600, s-maxage=3600")
      .send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`);
  } catch (error) {
    console.error("[SEO] destination sitemap failed:", error.message);
    res.status(500).type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
    );
  }
});

module.exports = router;
