#!/usr/bin/env node
/**
 * Full rebuild:
 *   1. Delete node_modules + package-lock.json
 *   2. npm install
 *   3. npm run build
 *
 * Cross-platform (no rd/del — uses fs.rmSync).
 */

"use strict";

const { execSync } = require("child_process");
const fs   = require("fs");
const path = require("path");

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const CYAN  = "\x1b[36m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";

const ROOT = path.resolve(__dirname, "..");

const run = (cmd) => {
  console.log(`\n${CYAN}$ ${cmd}${RESET}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
};

const remove = (rel) => {
  const abs = path.resolve(ROOT, rel);
  if (fs.existsSync(abs)) {
    console.log(`  ${DIM}Removing ${rel}…${RESET}`);
    fs.rmSync(abs, { recursive: true, force: true });
    console.log(`  ${GREEN}✓ Removed ${rel}${RESET}`);
  }
};

console.log(`\n${CYAN}${BOLD}╔══════════════════════════════════════════╗`);
console.log(`║   ALTUVERA — Full Rebuild                ║`);
console.log(`╚══════════════════════════════════════════╝${RESET}\n`);

remove("node_modules");
remove("package-lock.json");

run("npm install");
run("npm run build");

console.log(`\n${GREEN}${BOLD}Rebuild complete ✓${RESET}\n`);