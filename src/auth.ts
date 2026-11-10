const enc = new TextEncoder();

/** hex(HMAC-SHA256(key = utf8(pepper), msg = utf8(authKey))) — SPEC.md §2. */
export async function keyHash(pepper: string, authKey: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(authKey)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex digests. */
export function hashEquals(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

/** The pepper, or a ConfigError. Misconfiguration must stay a 500 (clients retry), never a 401 (clients drop the login). */
export function pepper(env: Env): string {
  if (env.AUTH_PEPPER) return env.AUTH_PEPPER;
  const e = new Error("AUTH_PEPPER secret is not set");
  e.name = "ConfigError";
  throw e;
}

/**
 * Returns the username when the headers authenticate, else null.
 * Exactly one HMAC and at most one D1 query, by primary key. The HMAC runs even for unknown users.
 */
export async function authenticate(req: Request, env: Env): Promise<string | null> {
  const user = req.headers.get("x-auth-user") ?? "";
  const key = req.headers.get("x-auth-key") ?? "";
  if (!user || !key || user.includes(":")) return null;
  const expected = await keyHash(pepper(env), key);
  const row = await env.DB.prepare("SELECT key_hash, disabled FROM users WHERE username = ?1")
    .bind(user)
    .first<{ key_hash: string; disabled: number }>();
  if (!row || row.disabled !== 0 || !hashEquals(expected, row.key_hash)) return null;
  return user;
}
