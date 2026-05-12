#!/usr/bin/env node
/**
 * Quick health check — pings the running server's /health endpoint.
 * Usage:  npm run health
 *         npm run health -- --url https://backend-jd8f.onrender.com
 */

"use strict";

const https  = require("https");
const http   = require("http");
const url    = require("url");

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const CYAN  = "\x1b[36m";
const BOLD  = "\x1b[1m";

// Parse --url flag from argv
const args = process.argv.slice(2);
const urlFlagIdx = args.indexOf("--url");
const TARGET =
  (urlFlagIdx !== -1 && args[urlFlagIdx + 1])
    ? args[urlFlagIdx + 1]
    : process.env.BACKEND_URL
      ? `${process.env.BACKEND_URL}/health`
      : `http://localhost:${process.env.PORT || 3000}/health`;

console.log(`\n${CYAN}${BOLD}Health check → ${TARGET}${RESET}\n`);

const parsed  = url.parse(TARGET);
const client  = parsed.protocol === "https:" ? https : http;

const req = client.get(TARGET, { timeout: 10_000 }, (res) => {
  let body = "";
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    try {
      const data = JSON.parse(body);
      if (res.statusCode === 200 && data.success) {
        console.log(`${GREEN}${BOLD}✓ Server is healthy${RESET}`);
        console.log(`  Status  : ${data.status}`);
        console.log(`  Uptime  : ${data.uptime}s`);
        console.log(`  Version : ${data.version}`);
        console.log(`  Env     : ${data.environment}`);
        console.log(`  Memory  : ${data.memory?.used} / ${data.memory?.total}`);
        console.log();
        process.exit(0);
      } else {
        console.log(`${RED}${BOLD}✗ Server responded with status ${res.statusCode}${RESET}`);
        console.log(body);
        process.exit(1);
      }
    } catch {
      console.log(`${RED}✗ Could not parse response:${RESET}`, body.slice(0, 200));
      process.exit(1);
    }
  });
});

req.on("error", (err) => {
  console.log(`${RED}${BOLD}✗ Connection failed: ${err.message}${RESET}`);
  console.log(`  Is the server running at ${TARGET}?`);
  process.exit(1);
});

req.on("timeout", () => {
  console.log(`${RED}✗ Request timed out after 10s${RESET}`);
  req.destroy();
  process.exit(1);
});