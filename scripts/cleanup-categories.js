require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env") });
const { query, closeConnections } = require("../config/db");

async function cleanup() {
  try {
    console.log("🧹 Category Cleanup Started\n");

    // 1. Show current state
    console.log("📊 Current categories:");
    const before = await query(
      `SELECT category, COUNT(*) as count FROM destinations WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY category`
    );
    before.rows.forEach((r) => console.log(`   • ${r.category}: ${r.count}`));

    // 2. Normalize all categories to Title Case
    console.log("\n🔧 Normalizing to Title Case...");
    const allCats = await query(
      `SELECT DISTINCT category FROM destinations WHERE category IS NOT NULL AND category != ''`
    );

    let normalizedCount = 0;
    for (const row of allCats.rows) {
      const raw = row.category;
      const normalized = raw
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

      if (raw !== normalized) {
        await query(`UPDATE destinations SET category = $1 WHERE category = $2`, [
          normalized,
          raw,
        ]);
        console.log(`   '${raw}' → '${normalized}'`);
        normalizedCount++;
      }
    }
    if (normalizedCount === 0) console.log("   All categories already normalized.");

    // 3. Show final state
    console.log("\n📊 Final categories (after normalization):");
    const after = await query(
      `SELECT category, COUNT(*) as count FROM destinations WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY category`
    );
    after.rows.forEach((r) => console.log(`   • ${r.category}: ${r.count}`));

    // 4. Handle categories with 0 results
    // Since categories are stored as strings directly on destinations,
    // a category "with 0 results" means no destination row has that value.
    // We cannot "delete" a string value that doesn't exist on any row.
    // Instead, we ensure no orphaned/empty categories exist.
    console.log("\n🗑️  Checking for empty/orphaned categories...");
    const orphaned = await query(
      `UPDATE destinations SET category = 'Uncategorized' WHERE category IS NULL OR category = ''`
    );
    if (orphaned.rowCount > 0) {
      console.log(`   Set ${orphaned.rowCount} empty categories to 'Uncategorized'`);
    } else {
      console.log("   No empty/orphaned categories found.");
    }

    // 5. Summary
    const totalDests = await query(`SELECT COUNT(*) FROM destinations`);
    const totalCats = after.rows.length;

    console.log("\n══════════════════════════════════════════════════");
    console.log("✅ Category Cleanup Complete!");
    console.log(`   Total destinations: ${totalDests.rows[0].count}`);
    console.log(`   Active categories: ${totalCats}`);
    console.log("══════════════════════════════════════════════════");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    await closeConnections();
  }
}

cleanup();
