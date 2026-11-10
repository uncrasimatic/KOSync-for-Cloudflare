#!/usr/bin/env node
// Create, rotate, disable, enable or delete a KOSync account in D1.
//
//   npm run user:add -- <username> --local|--remote [--password <pw>] [--rotate|--disable|--enable|--delete]
//
// AUTH_PEPPER: taken from the environment; with --local it falls back to .dev.vars.
// For --remote, load it without echoing:  read -rs AUTH_PEPPER && export AUTH_PEPPER
// --password is for local test accounts only; real accounts get a generated password,
// printed once after the database write succeeds. Store it in your password manager.

import { createHash, createHmac, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DB = process.env.KOSYNC_DB || "kosync";
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const username = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--password");
const target = flag("--remote") ? "--remote" : flag("--local") ? "--local" : null;
const actions = ["--rotate", "--disable", "--enable", "--delete"].filter(flag);

function die(msg) { console.error(`error: ${msg}`); process.exit(1); }

if (!username || !target || actions.length > 1) {
  die("usage: provision-user.mjs <username> --local|--remote [--password <pw>] [--rotate|--disable|--enable|--delete]");
}
// Strict charset: also makes the SQL literals below injection-safe.
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(username)) die("username must match [A-Za-z0-9_.-]{1,64}");
if (opt("--password") && target === "--remote") die("--password is for local test accounts only");

const sqlUser = `'${username}'`;
const action = actions[0] || "--create";
let sql;
let password;

if (action === "--create" || action === "--rotate") {
  let pepper = process.env.AUTH_PEPPER;
  if (!pepper && target === "--local") {
    try {
      const m = readFileSync(".dev.vars", "utf8").match(/^AUTH_PEPPER\s*=\s*"?([^"\r\n]+)"?\s*$/m);
      pepper = m?.[1];
    } catch { /* no .dev.vars */ }
  }
  if (!pepper || pepper.length < 32) die("AUTH_PEPPER missing or shorter than 32 chars");

  password = opt("--password") || generatePassword();
  const key = createHash("md5").update(password).digest("hex"); // what KOReader sends as x-auth-key
  const keyHash = createHmac("sha256", pepper).update(key).digest("hex");

  sql = action === "--create"
    ? `INSERT INTO users (username, key_hash, created_at) VALUES (${sqlUser}, '${keyHash}', CAST(strftime('%s','now') AS INTEGER));`
    : `UPDATE users SET key_hash = '${keyHash}' WHERE username = ${sqlUser};`;
} else if (action === "--disable" || action === "--enable") {
  sql = `UPDATE users SET disabled = ${action === "--disable" ? 1 : 0} WHERE username = ${sqlUser};`;
} else {
  sql = `DELETE FROM progress WHERE username = ${sqlUser}; DELETE FROM users WHERE username = ${sqlUser};`;
}

// Run the project-local wrangler via node directly: no shell, so quoting is safe on Linux, macOS and Windows.
// (Run from the project root, as npm run does.)
const wranglerBin = resolve("node_modules/wrangler/bin/wrangler.js");
if (!existsSync(wranglerBin)) die("wrangler not installed; run npm install from the project root");
const res = spawnSync(process.execPath, [wranglerBin, "d1", "execute", DB, target, "--command", sql], { stdio: "inherit" });
if (res.status !== 0) die("wrangler d1 execute failed; nothing changed");

if (password) {
  console.log(`\nUser: ${username}\nPassword: ${password}\n(Shown once. KOReader: Progress sync → Custom sync server → Login.)`);
} else {
  console.log(`\nDone: ${action.slice(2)} ${username}. Check the output above for rows affected.`);
}

// 20 chars from a 31-symbol alphabet (no 0/o/1/l/i) ≈ 99 bits, grouped for typing on an e-reader.
function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += alphabet[randomInt(alphabet.length)];
  return s.match(/.{5}/g).join("-");
}
