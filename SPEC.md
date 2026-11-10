# Protocol and implementation spec

Derived from the kosync-conformance `SPEC.md` (CC0, https://github.com/pid1/kosync-conformance, checked 2026-11-08), which treats the reference server (koreader/koreader-sync-server) as authoritative. Requirement IDs (`K-…`) refer to that document. Where this file says **Ours**, it is a deliberate choice for this project.

## 1. General

- Paths are at the root of the base URL; no version prefix (K-URL-1). TLS is provided by `workers.dev`.
- Unlisted path/method → `404 {"code":404,"message":"Not found"}`. Not routed to any handler (K-URL-3).
- Clients send `Accept: application/vnd.koreader.v1+json`. **Ours:** do not enforce Accept or Content-Type (K-ACC-3, K-CT-2 allow this).
- All responses: JSON body, `Content-Type: application/json` (K-CT-3).
- Request bodies must be JSON objects. Unparseable → `400 {"code":103,...}`; non-object (array/scalar) → `400 {"code":104,...}`.
- **Ours:** reject bodies > 16 KiB with `403 {"code":2003,"message":"Invalid request"}` (read `content-length` and actual length).
- Error body shape: `{"code": <int>, "message": "<text>"}` (K-ERR-1).

## 2. Authentication

- Headers `x-auth-user`, `x-auth-key` on every authenticated route.
- `x-auth-key` is the client-computed lowercase-hex MD5 of the password. Treat as an opaque, case-sensitive, non-empty string; don't require 32 hex chars (K-AUTH-3, K-AUTH-5).
- Usernames: non-empty, no `:` (K-AUTH-4).
- Missing/empty header, unknown user, disabled user, or wrong key → `401 {"code":2001,"message":"Unauthorized"}` (K-AUTH-6). All the same response.
- **Ours — verification:**
  - `AUTH_PEPPER` is a Worker secret (string). `expected = hex(HMAC-SHA256(key = utf8(AUTH_PEPPER), msg = utf8(x-auth-key)))`.
  - Stored in `users.key_hash`. Compare with `crypto.subtle.timingSafeEqual` on equal-length byte arrays.
  - For unknown usernames, still compute the HMAC before returning 401.
  - Test vector: pepper `test-pepper`, password `password` → key `5f4dcc3b5aa765d61d8327deb882cf99` → hash `6961dfaecb86ee50a6d25059ced391c9ecb5d1cb4973b4e3c842dbcfef2a53b3`.
  - Rationale: accounts get random ≥ 100-bit passwords from `scripts/provision-user.mjs`, so key stretching adds nothing and would break the CPU budget.

## 3. Endpoints

### `GET /healthcheck` — no auth
`200 {"state":"OK"}` (K-HC-1). No D1 query.

### `POST /users/create` — no auth
**Ours:** behaviour depends on the `REGISTRATION` var in `wrangler.jsonc`:

| `REGISTRATION` | Behaviour |
|---|---|
| `"off"`, unset, or any other value | Always `402 {"code":2005,"message":"User registration is disabled."}` (K-REG-5). Body not parsed. |
| `"allowlist"` | As `"open"`, but a valid username **not** listed in the `ALLOWED_NEW_USERS` secret → 402/2005. Missing/empty secret → nobody. |
| `"open"` | Anyone may register. |

When registration is not off:

1. Body read as in §1 (400/103, 400/104, >16 KiB → 403/2003).
2. `username`: string matching `^[A-Za-z0-9_.-]{1,64}$` (same rule as the provisioning script); `password`: non-empty string ≤ 256 chars. Else `403 {"code":2003,"message":"Invalid request"}` (K-REG-4).
3. Allowlist check (allowlist mode only). `ALLOWED_NEW_USERS` is split on commas and whitespace; names are case-sensitive.
4. `password` is already `md5(plaintext)` — the same value later sent as `x-auth-key` (K-REG-1). Store `HMAC-SHA256(AUTH_PEPPER, password)` exactly as in §2. Never hash it again.
5. Insert with `ON CONFLICT DO NOTHING`; 0 rows changed → `402 {"code":2002,"message":"Username is already registered."}` (K-REG-3). This includes disabled accounts: a name can't be re-claimed.
6. Success: `201 {"username":"<username>"}` (K-REG-2). The client treats only 201 as success.

Cost: one HMAC, one primary-key write. Accounts can still be created, rotated, disabled and deleted with `scripts/provision-user.mjs` in every mode.

### `GET /users/auth` — auth
`200 {"authorized":"OK"}` (K-AUTH-7), or 401/2001.

### `PUT /syncs/progress` — auth

| Field | Type | Required | Validation (failure → response) |
|---|---|---|---|
| `document` | string | yes | non-empty, no `:` or `/`, ≤ 256 chars → else `403 {"code":2004,"message":"Field 'document' not provided."}` |
| `progress` | string | yes | string, ≤ 4096 chars → else 403/2003 |
| `percentage` | number | yes | finite number (not range-checked; `0` valid) → else 403/2003 |
| `device` | string | yes | string, ≤ 256 chars → else 403/2003 |
| `device_id` | string | no | if present: string ≤ 256 chars → else 403/2003 |
| `metadata` | any | no | accepted and **ignored, never stored** (K-FLD-10, K-FLD-11 trivially satisfied) |
| `timestamp` | any | no | ignored; server sets it |

Check auth first (401 before any 403). Then validate `document` (2004), then the other fields (2003).

- Write: last-write-wins upsert, no comparison with stored data (K-PUT-5). `timestamp = Math.floor(Date.now()/1000)` — integer **seconds**, never ms (K-PUT-4, K-FLD-12). If the client omits `device_id`, store NULL.
- Success: `200 {"document":"<document>","timestamp":<int>}` (K-PUT-3). Never emit 202.
- Note: the client retries any non-200 except 401, so don't invent other transient error codes.

### `GET /syncs/progress/:document` — auth
- `:document` is one path segment, URI-decoded. Accept anything PUT accepts, so every stored id can be read back (K-DOC-ID-1). If invalid → `200 {}` (it cannot exist).
- Found: `200 {"document","percentage","progress","device","timestamp"}` plus `device_id` only if stored non-null (K-GET-2). `timestamp` MUST be present (K-FLD-13) — without it the client falls back to percentage comparison and discards newer-but-earlier positions.
- Not found: `200 {}`, never 404, never a `percentage` field (K-GET-3, K-FLD-5).

### Not implemented in v1 (unrouted → 404)
`DELETE /users/me`, `PUT /users/password`. The KOReader client never calls them (server-only extensions; the verifier doesn't probe DELETE). Account removal and key rotation use the provisioning script.

## 4. Document ids (client-side, for testing and docs)

The client computes `document` as a 32-char lowercase-hex MD5: by default a partial MD5 of the file contents, optionally MD5 of the filename. The two are indistinguishable on the wire, so **all devices must use the same "document matching" setting**. The server treats the id as opaque.

## 5. Schema

See `migrations/0001_init.sql`. `users` and `progress` are `WITHOUT ROWID` tables keyed by primary key, so each upsert writes one row and each auth or progress lookup reads one row.

## 6. Queries (the only ones the Worker may run)

```sql
SELECT key_hash, disabled FROM users WHERE username = ?1;

INSERT INTO progress (username, document, progress, percentage, device, device_id, timestamp)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
ON CONFLICT (username, document) DO UPDATE SET
  progress = excluded.progress, percentage = excluded.percentage, device = excluded.device,
  device_id = excluded.device_id, timestamp = excluded.timestamp;

SELECT document, progress, percentage, device, device_id, timestamp
FROM progress WHERE username = ?1 AND document = ?2;

-- POST /users/create only, when REGISTRATION is "allowlist" or "open":
INSERT INTO users (username, key_hash, created_at) VALUES (?1, ?2, ?3)
ON CONFLICT (username) DO NOTHING;
```

## 7. Cost envelope

Per request: ≤ 1 row read for auth + 1 row read or written. Free plan: 100k requests/day, 5M rows read/day, 100k rows written/day, 10 ms CPU/request. Unauthenticated floods can only consume requests and reads (no writes). On the Free plan, hitting a limit makes requests fail until 00:00 UTC; nothing is billed.

## 8. Required tests

1. Healthcheck 200 `{"state":"OK"}`.
2. Register: `"off"` (and unset/unknown mode) → 402/2005 regardless of body. `"open"` → 201, then the registered key authenticates; existing name → 402/2002; invalid fields → 403/2003. `"allowlist"` → only listed names register, others 402/2005; missing/empty list → nobody. Missing pepper → 500, nothing stored.
3. Auth: correct → 200; wrong key, unknown user, disabled user, missing/empty header → 401/2001 (identical body).
4. HMAC test vector from §2.
5. PUT then GET round-trip; `timestamp` is an integer within ±5 s of now; `device_id` omitted when not sent.
6. GET unknown document → 200 `{}`.
7. Second PUT overwrites (last-write-wins), including with lower `percentage`.
8. Isolation: user B cannot read user A's document; B's PUT of the same id doesn't affect A's.
9. Validation: missing `document` → 403/2004; doc with `:` → 403/2004; missing `progress`/`device`, non-numeric `percentage` → 403/2003; bad JSON → 400/103; array body → 400/104; >16 KiB → 403/2003.
10. Ids with `-` and `.` round-trip (K-DOC-ID-1).
11. `metadata` present → accepted, not persisted (assert row columns).
12. Unknown route/method → 404 JSON.
13. Auth checked before validation (bad creds + bad body → 401).
