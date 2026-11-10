# KOReader Cloud Sync

Self-hosted KOSync-compatible reading-progress server: one Cloudflare Worker + one D1 database on the **Workers Free plan**, sized for personal and household use. Statistics sync is out of scope.

## Source of truth

- `SPEC.md` — wire protocol and our implementation choices. Implement exactly this; don't re-derive the protocol or port other servers.
- `README.md` — user-facing setup and registration modes; keep it in step with behaviour changes.

## Stack

- TypeScript, a plain `export default { fetch }` handler. **No runtime dependencies** (no Hono, no ORM, no validation library).
- D1 via `env.DB.prepare(...).bind(...)`. Never build SQL strings from request data.
- Web Crypto only (`crypto.subtle`). Don't enable `nodejs_compat` unless genuinely required.
- Tests: Vitest + `@cloudflare/vitest-plugin` (renamed from `@cloudflare/vitest-pool-workers`) (runs in workerd with a local D1). Its config API has changed between versions — check current Cloudflare docs before writing `vitest.config.ts`. Apply `migrations/` in test setup.
- Generate binding types with `npm run types` (do not hand-write `Env`).

## Commands

| Purpose | Command |
|---|---|
| Local server (:8787) | `npm run dev` |
| Unit tests | `npm test` |
| Typecheck | `npm run typecheck` |
| Binding types | `npm run types` |
| Local schema | `npm run db:migrate:local` |
| Local test users | `npm run user:add -- conformance --local --password conformance-pass-1` and `... conformance2 --local --password conformance-pass-2` |
| Conformance (local) | `npm run conformance` (needs `npm run dev` running) |
| Conformance, open registration | `npm run dev -- --var REGISTRATION:open`, then `npm run conformance -- --registration open` (delete the `reg-<time>` user afterwards) |

Remote commands — **only when the user explicitly asks in this session**: `npm run deploy`, `npm run db:migrate:remote`, `npm run user:add -- <name> --remote`, `npm run backup`.

## Hard rules

1. **Free plan only.** Use only Workers, D1 and secrets. No KV, R2, Durable Objects, Queues, Workflows, cron triggers, Logpush, Rate Limiting bindings, or paid-only config keys (e.g. `limits.cpu_ms`). If something seems to need them, stop and ask.
2. **CPU:** one HMAC-SHA256 per authenticated request. No PBKDF2/bcrypt/scrypt/argon2 — every request authenticates and the free plan caps CPU at 10 ms.
3. **D1:** at most 2 queries per request, each by primary key. Upserts only — no read-before-write.
4. **Privacy:** never log headers, bodies, usernames, document ids, keys or progress. Errors: `console.error(route, err.name)` at most. Keep `observability.enabled: false`.
5. **Isolation:** every progress query includes `username = ?` bound to the authenticated user.
6. Never commit `.dev.vars`, `backups/`, `.cache/`. Never print or store real passwords or `AUTH_PEPPER`.
7. Small: aim for < 300 lines in `src/`. Prefer one `src/index.ts` plus `src/auth.ts` if it helps tests.

## Definition of done (v1)

- `npm run typecheck` clean; `npm test` green (cases in `SPEC.md` §8).
- `npm run conformance` exits 0 against `npm run dev` (a TLS-only MUST may fail on plain-http localhost — that one is acceptable locally only).

## Git

Before any commit, confirm no `.dev.vars`, `backups/` or `.cache/` files are tracked (`git status`, `git ls-files`).

Maintainers may keep private working notes in `CLAUDE.local.md` (gitignored).
