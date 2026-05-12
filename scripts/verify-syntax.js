#!/usr/bin/env node
/**
 * Syntax-checks every .js file in the project.
 * Runs: node --check <file> on each one.
 * Exits 1 on first failure, 0 on full success.
 */

"use strict";

const { execFileSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

// ── Directories to check ──────────────────────────────────────────────────────
const CHECK_DIRS = [
  "server.js",          // root entry point (single file)
  "routes",
  "controllers",
  "middleware",
  "config",
  "utils",
];

// ── Files / patterns to skip ─────────────────────────────────────────────────
const SKIP_PATTERNS = [
  /node_modules/,
  /\.test\.js$/,
  /\.spec\.js$/,
  /scripts[\\/]/, // skip scripts themselves (avoid circular)
];

// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");

/**
 * Collect all .js files under a directory (recursive).
 */
const collectFiles = (target) => {
  const abs = path.resolve(ROOT, target);

  // Single file
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];

  // Directory — recurse
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        results.push(full);
      }
    }
  };
  walk(abs);
  return results;
};

/**
 * Check a single file's syntax via `node --check`.
 * Returns { ok: bool, file: string, error?: string }
 */
const checkFile = (file) => {
  const rel = path.relative(ROOT, file);

  // Skip ignored patterns
  if (SKIP_PATTERNS.some((p) => p.test(file))) {
    return { ok: true, file: rel, skipped: true };
  }

  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return { ok: true, file: rel };
  } catch (err) {
    const raw = err.stderr?.toString?.() || err.stdout?.toString?.() || err.message;
    return { ok: false, file: rel, error: raw.trim() };
  }
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";

console.log(`\n${CYAN}${BOLD}╔══════════════════════════════════════════╗`);
console.log(`║   ALTUVERA — Syntax Verification         ║`);
console.log(`╚══════════════════════════════════════════╝${RESET}\n`);

let total   = 0;
let passed  = 0;
let failed  = 0;
let skipped = 0;
const errors = [];

for (const target of CHECK_DIRS) {
  const files = collectFiles(target);

  for (const file of files) {
    const result = checkFile(file);
    total++;

    if (result.skipped) {
      skipped++;
      console.log(`  ${YELLOW}SKIP${RESET}  ${result.file}`);
    } else if (result.ok) {
      passed++;
      console.log(`  ${GREEN}✓${RESET}     ${result.file}`);
    } else {
      failed++;
      errors.push(result);
      console.log(`  ${RED}✗${RESET}     ${result.file}`);
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}─────────────────────────────────────────────${RESET}`);
console.log(
  `${BOLD}Results:${RESET}  ` +
  `${GREEN}${passed} passed${RESET}  ` +
  `${RED}${failed} failed${RESET}  ` +
  `${YELLOW}${skipped} skipped${RESET}  ` +
  `(${total} total)`,
);

if (errors.length > 0) {
  console.log(`\n${RED}${BOLD}Syntax errors found:${RESET}\n`);
  for (const { file, error } of errors) {
    console.log(`${RED}── ${file}${RESET}`);
    console.log(`   ${error}\n`);
  }
  console.log(`${RED}${BOLD}Build FAILED — fix the errors above.${RESET}\n`);
  process.exit(1);
}

console.log(`\n${GREEN}${BOLD}All files passed syntax check ✓${RESET}\n`);
process.exit(0);