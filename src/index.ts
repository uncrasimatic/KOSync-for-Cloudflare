import { authenticate, keyHash, pepper } from "./auth";

const MAX_BODY = 16 * 1024;
const PROGRESS_PREFIX = "/syncs/progress/";

const UPSERT = `INSERT INTO progress (username, document, progress, percentage, device, device_id, timestamp)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
ON CONFLICT (username, document) DO UPDATE SET
  progress = excluded.progress, percentage = excluded.percentage, device = excluded.device,
  device_id = excluded.device_id, timestamp = excluded.timestamp`;

const SELECT = `SELECT document, progress, percentage, device, device_id, timestamp
FROM progress WHERE username = ?1 AND document = ?2`;

const CREATE_USER = `INSERT INTO users (username, key_hash, created_at) VALUES (?1, ?2, ?3)
ON CONFLICT (username) DO NOTHING`;

type Row = { document: string; progress: string; percentage: number; device: string; device_id: string | null; timestamp: number };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, code: number, message: string): Response => json(status, { code, message });

const notFound = () => err(404, 404, "Not found");
const unauthorized = () => err(401, 2001, "Unauthorized");
const invalid = () => err(403, 2003, "Invalid request");
const noDocument = () => err(403, 2004, "Field 'document' not provided.");

// "." and ".." are rejected because URL normalisation makes them unreadable via GET (K-DOC-ID-1).
const validDocument = (d: unknown): d is string =>
  typeof d === "string" && d.length > 0 && d.length <= 256 && !d.includes(":") && !d.includes("/") && d !== "." && d !== "..";
const shortString = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

const registrationDisabled = () => err(402, 2005, "User registration is disabled.");
// Same rule as scripts/provision-user.mjs.
const USERNAME = /^[A-Za-z0-9_.-]{1,64}$/;

type RegistrationMode = "off" | "allowlist" | "open";
/** REGISTRATION var from wrangler.jsonc. Missing or unrecognised → "off" (fail closed). */
function registrationMode(v: unknown): RegistrationMode {
  return v === "allowlist" || v === "open" ? v : "off";
}

/** ALLOWED_NEW_USERS secret: usernames separated by commas or whitespace. Missing → nobody. */
function allowed(env: Env, username: string): boolean {
  const list = (env as { ALLOWED_NEW_USERS?: unknown }).ALLOWED_NEW_USERS;
  return typeof list === "string" && list.split(/[\s,]+/).includes(username);
}

/** POST /users/create — SPEC.md §3. One HMAC, one primary-key insert. */
async function createUser(req: Request, env: Env): Promise<Response> {
  const mode = registrationMode(env.REGISTRATION as unknown);
  if (mode === "off") return registrationDisabled();
  const body = await readObject(req);
  if (body instanceof Response) return body;
  const { username, password } = body;
  // `password` is already md5(plaintext) — the same value as x-auth-key (K-REG-1).
  if (typeof username !== "string" || !USERNAME.test(username) || typeof password !== "string" || !password || password.length > 256) {
    return invalid();
  }
  if (mode === "allowlist" && !allowed(env, username)) return registrationDisabled();
  const hash = await keyHash(pepper(env), password);
  const res = await env.DB.prepare(CREATE_USER).bind(username, hash, Math.floor(Date.now() / 1000)).run();
  if (!res.meta.changes) return err(402, 2002, "Username is already registered.");
  return json(201, { username });
}

/** Reads a JSON object body, or returns the error response. */
async function readObject(req: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return invalid();
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY) return invalid();
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return err(400, 103, "Invalid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return err(400, 104, "Request body must be a JSON object");
  return body as Record<string, unknown>;
}

async function putProgress(req: Request, env: Env, user: string): Promise<Response> {
  const body = await readObject(req);
  if (body instanceof Response) return body;
  const { document, progress, percentage, device, device_id } = body;
  if (!validDocument(document)) return noDocument();
  if (
    !shortString(progress, 4096) ||
    typeof percentage !== "number" || !Number.isFinite(percentage) ||
    !shortString(device, 256) ||
    (device_id !== undefined && !shortString(device_id, 256))
  ) return invalid();
  // metadata and timestamp are deliberately ignored (SPEC.md §3).
  const timestamp = Math.floor(Date.now() / 1000);
  await env.DB.prepare(UPSERT)
    .bind(user, document, progress, percentage, device, device_id ?? null, timestamp)
    .run();
  return json(200, { document, timestamp });
}

async function getProgress(env: Env, user: string, segment: string): Promise<Response> {
  let document: string;
  try {
    document = decodeURIComponent(segment);
  } catch {
    return json(200, {});
  }
  if (!validDocument(document)) return json(200, {});
  const row = await env.DB.prepare(SELECT).bind(user, document).first<Row>();
  if (!row) return json(200, {});
  const out: Record<string, unknown> = {
    document: row.document,
    percentage: row.percentage,
    progress: row.progress,
    device: row.device,
    timestamp: row.timestamp,
  };
  if (row.device_id !== null) out.device_id = row.device_id;
  return json(200, out);
}

async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  const m = req.method;

  if (pathname === "/healthcheck" && m === "GET") return json(200, { state: "OK" });
  if (pathname === "/users/create" && m === "POST") return createUser(req, env);

  const isAuth = pathname === "/users/auth" && m === "GET";
  const isPut = pathname === "/syncs/progress" && m === "PUT";
  const segment = pathname.startsWith(PROGRESS_PREFIX) ? pathname.slice(PROGRESS_PREFIX.length) : "";
  const isGet = m === "GET" && segment.length > 0 && !segment.includes("/");
  if (!isAuth && !isPut && !isGet) return notFound();

  const user = await authenticate(req, env);
  if (!user) return unauthorized();
  if (isAuth) return json(200, { authorized: "OK" });
  if (isPut) return putProgress(req, env, user);
  return getProgress(env, user, segment);
}

export default {
  async fetch(req, env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      // Route label only — never the path (it may contain a document id), headers or body.
      console.error(`${req.method} route`, (e as Error)?.name);
      return err(500, 2000, "Unknown server error.");
    }
  },
} satisfies ExportedHandler<Env>;
