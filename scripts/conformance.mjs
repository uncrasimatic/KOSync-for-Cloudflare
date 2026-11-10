#!/usr/bin/env node
// Run the kosync-conformance verifier (BSD-3-Clause, cloned into .cache/, never vendored).
//
//   npm run conformance                                   # wrangler dev on :8787, REGISTRATION off/allowlist
//   npm run conformance -- --registration open            # server runs with REGISTRATION "open"
//   npm run conformance -- https://kosync.<sub>.workers.dev [--registration open]
//
// --registration off|allowlist (default): registration is checked as disabled (402/2005). With
// "allowlist" the verifier's random probe name isn't listed, so it gets 402/2005 too.
// --registration open: also registers a fresh account (reg-<time>) and checks 201, duplicate 402/2002
// and invalid 403/2003. That account stays in the database: delete it afterwards with
//   npm run user:add -- reg-<time> --local|--remote --delete
//
// Needs two existing accounts. Defaults match the local test users in CLAUDE.md.
// For remote runs, provision throwaway accounts, set KOSYNC_TEST_* env vars, then delete the accounts:
// the verifier writes progress under synthetic document ids.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const modeAt = args.indexOf("--registration");
const mode = modeAt >= 0 ? args[modeAt + 1] : "off";
if (!["off", "allowlist", "open"].includes(mode)) {
  console.error("error: --registration must be off, allowlist or open");
  process.exit(1);
}
const base = args.find((a, i) => !a.startsWith("--") && i !== modeAt + 1) || "http://localhost:8787";
const dir = ".cache/kosync-conformance";
const env = process.env;
const run = (cmd, a) => spawnSync(cmd, a, { stdio: "inherit" }).status ?? 1;

if (!existsSync(`${dir}/verify.mjs`)) {
  if (run("git", ["clone", "--depth", "1", "https://github.com/pid1/kosync-conformance", dir]) !== 0) process.exit(1);
}

const user = mode === "open"
  ? ["--user", `reg-${Date.now()}`, "--password", "conformance-pass-reg", "--register"]
  : ["--user", env.KOSYNC_TEST_USER || "conformance", "--password", env.KOSYNC_TEST_PASSWORD || "conformance-pass-1"];
if (mode === "open") console.log(`Registering ${user[1]} — delete it afterwards (see the header of this script).`);

process.exit(run(process.execPath, [
  `${dir}/verify.mjs`,
  "--base-url", base,
  ...user,
  "--second-user", env.KOSYNC_TEST_USER2 || "conformance2",
  "--second-password", env.KOSYNC_TEST_PASSWORD2 || "conformance-pass-2",
  ...(mode === "open" ? [] : ["--registration-off"]),
]));
