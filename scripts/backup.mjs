#!/usr/bin/env node
// Export the remote D1 database to backups/<db>-<UTC timestamp>.sql (gitignored).
// The file contains reading history and key hashes: store it encrypted, off-Cloudflare.
// D1 Time Travel (7 days on Free, always on) covers short-term mistakes; this covers the rest.

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DB = process.env.KOSYNC_DB || "kosync";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const out = `backups/${DB}-${stamp}.sql`;
const wranglerBin = resolve("node_modules/wrangler/bin/wrangler.js");
if (!existsSync(wranglerBin)) { console.error("wrangler not installed; run npm install"); process.exit(1); }

mkdirSync("backups", { recursive: true });
const res = spawnSync(process.execPath, [wranglerBin, "d1", "export", DB, "--remote", "--output", out], { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`Wrote ${out}`);
