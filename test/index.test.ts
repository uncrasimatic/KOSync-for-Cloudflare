import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { keyHash } from "../src/auth";

const BASE = "https://kosync.test";
const ACCEPT = "application/vnd.koreader.v1+json";

// md5 hex of the test passwords, as KOReader sends them.
const KEY_A = "5f4dcc3b5aa765d61d8327deb882cf99"; // md5("password")
const KEY_B = "6cb75f652a9b52798eb6cf2201057c73"; // md5("password2")

async function addUser(username: string, key: string, disabled = 0) {
  await env.DB.prepare("INSERT OR REPLACE INTO users (username, key_hash, disabled, created_at) VALUES (?1, ?2, ?3, 0)")
    .bind(username, await keyHash(env.AUTH_PEPPER, key), disabled)
    .run();
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM progress; DELETE FROM users;");
  await addUser("alice", KEY_A);
  await addUser("bob", KEY_B);
  await addUser("carol", KEY_A, 1);
});

type Opts = { user?: string | null; key?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> };

function call(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = { accept: ACCEPT, ...o.headers };
  const user = o.user === undefined ? "alice" : o.user;
  const key = o.key === undefined ? KEY_A : o.key;
  if (user !== null) headers["x-auth-user"] = user;
  if (key !== null) headers["x-auth-key"] = key;
  let body: string | undefined = o.raw;
  if (o.body !== undefined) body = JSON.stringify(o.body);
  if (body !== undefined) headers["content-type"] = "application/json";
  return exports.default.fetch(new Request(BASE + path, { method, headers, body }));
}

const put = (body: unknown, o: Opts = {}) => call("PUT", "/syncs/progress", { body, ...o });
const get = (doc: string, o: Opts = {}) => call("GET", `/syncs/progress/${encodeURIComponent(doc)}`, o);

async function expectJson(res: Response, status: number, body: unknown) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  expect(await res.json()).toEqual(body);
}

const disabled = { code: 2005, message: "User registration is disabled." };

/** POST /users/create against the worker with env overrides (REGISTRATION, ALLOWED_NEW_USERS, …). */
async function register(over: Record<string, unknown>, raw?: string) {
  const worker = (await import("../src/index")).default;
  const req = new Request(BASE + "/users/create", { method: "POST", body: raw, headers: { "content-type": "application/json" } });
  return worker.fetch(req as Parameters<typeof worker.fetch>[0], { ...env, ...over } as Env);
}
const regBody = (username: unknown, password: unknown = KEY_B) => JSON.stringify({ username, password });

const DOC = "0123456789abcdef0123456789abcdef";
const valid = { document: DOC, progress: "/body/DocFragment[10]/body/p[3]/text().42", percentage: 0.5, device: "Kobo" };

describe("public routes", () => {
  it("1. healthcheck", async () => {
    await expectJson(await call("GET", "/healthcheck", { user: null, key: null }), 200, { state: "OK" });
  });

  it("2. registration off (also unset or misspelled mode) → 402/2005 regardless of body", async () => {
    for (const REGISTRATION of ["off", undefined, "Open", "true", ""]) {
      for (const raw of [undefined, "{}", '{"username":"x","password":"y"}', "not json", "[1]"]) {
        await expectJson(await register({ REGISTRATION }, raw), 402, disabled);
      }
    }
  });

  it("12. unknown routes and methods → 404 JSON", async () => {
    const nf = { code: 404, message: "Not found" };
    for (const [m, p] of [
      ["GET", "/"], ["GET", "/nope"], ["POST", "/healthcheck"], ["GET", "/users/create"], ["POST", "/users/auth"],
      ["GET", "/syncs/progress"], ["POST", "/syncs/progress"], ["PUT", `/syncs/progress/${DOC}`],
      ["DELETE", "/users/me"], ["PUT", "/users/password"], ["GET", "/syncs/progress/a/b"], ["GET", "/healthcheck/"],
    ] as const) {
      await expectJson(await call(m, p), 404, nf);
    }
  });
});

describe("registration", () => {
  const open = { REGISTRATION: "open" };
  const taken = { code: 2002, message: "Username is already registered." };
  const bad = { code: 2003, message: "Invalid request" };

  it("open: 201 {username}, then the registered key authenticates (K-REG-1/2)", async () => {
    await expectJson(await register(open, regBody("dave")), 201, { username: "dave" });
    await expectJson(await call("GET", "/users/auth", { user: "dave", key: KEY_B }), 200, { authorized: "OK" });
    await expectJson(await call("GET", "/users/auth", { user: "dave", key: KEY_A }), 401, { code: 2001, message: "Unauthorized" });
  });

  it("open: existing username → 402/2002 and the old key keeps working (K-REG-3)", async () => {
    await expectJson(await register(open, regBody("alice", KEY_B)), 402, taken);
    await expectJson(await call("GET", "/users/auth"), 200, { authorized: "OK" });
    await expectJson(await register(open, regBody("carol")), 402, taken); // disabled accounts can't be re-claimed
  });

  it("open: invalid fields → 403/2003; bad JSON → 400 (K-REG-4)", async () => {
    for (const b of [
      regBody(""), regBody("has:colon"), regBody("sp ace"), regBody("x".repeat(65)), regBody(7),
      regBody("eve", ""), regBody("eve", 5), regBody("eve", "x".repeat(257)), "{}",
    ]) {
      await expectJson(await register(open, b), 403, bad);
    }
    expect((await register(open, "{nope")).status).toBe(400);
    expect((await register(open, "[1]")).status).toBe(400);
    expect((await register(open, regBody("eve", "x".repeat(17 * 1024)))).status).toBe(403);
    expect(await env.DB.prepare("SELECT username FROM users WHERE username = 'eve'").first()).toBeNull();
  });

  it("allowlist: only listed names register; everything else looks like 'off'", async () => {
    const list = { REGISTRATION: "allowlist", ALLOWED_NEW_USERS: "dave, erin\nfrank" };
    await expectJson(await register(list, regBody("dave")), 201, { username: "dave" });
    await expectJson(await register(list, regBody("frank")), 201, { username: "frank" });
    await expectJson(await register(list, regBody("dave")), 402, taken);
    for (const name of ["mallory", "Dave", "dav"]) {
      await expectJson(await register(list, regBody(name)), 402, disabled);
    }
    for (const ALLOWED_NEW_USERS of [undefined, "", " , "]) {
      await expectJson(await register({ REGISTRATION: "allowlist", ALLOWED_NEW_USERS }, regBody("dave2")), 402, disabled);
    }
    await expectJson(await register(list, regBody("")), 403, bad);
    await expectJson(await register(list, regBody("erin,mallory")), 403, bad);
  });

  it("registration with a missing pepper → 500, nothing stored", async () => {
    await expectJson(await register({ ...open, AUTH_PEPPER: "" }, regBody("gina")), 500, { code: 2000, message: "Unknown server error." });
    expect(await env.DB.prepare("SELECT username FROM users WHERE username = 'gina'").first()).toBeNull();
  });
});

describe("auth", () => {
  const unauth = { code: 2001, message: "Unauthorized" };

  it("3. correct credentials → 200", async () => {
    await expectJson(await call("GET", "/users/auth"), 200, { authorized: "OK" });
  });

  it("3. wrong key, unknown user, disabled user, missing/empty headers → identical 401", async () => {
    const cases: Opts[] = [
      { key: KEY_B },
      { key: KEY_A.toUpperCase() },
      { user: "mallory" },
      { user: "carol" },
      { user: null },
      { key: null },
      { user: "" },
      { key: "" },
      { user: "alice:x" },
    ];
    for (const o of cases) await expectJson(await call("GET", "/users/auth", o), 401, unauth);
  });

  it("4. HMAC test vector (SPEC.md §2)", async () => {
    expect(env.AUTH_PEPPER).toBe("test-pepper");
    expect(await keyHash("test-pepper", KEY_A)).toBe("6961dfaecb86ee50a6d25059ced391c9ecb5d1cb4973b4e3c842dbcfef2a53b3");
  });

  it("missing AUTH_PEPPER → 500/2000, not 401", async () => {
    const worker = (await import("../src/index")).default;
    const req = new Request(BASE + "/users/auth", { headers: { "x-auth-user": "alice", "x-auth-key": KEY_A } });
    const res = await worker.fetch(req as Parameters<typeof worker.fetch>[0], { ...env, AUTH_PEPPER: "" } as Env);
    await expectJson(res, 500, { code: 2000, message: "Unknown server error." });
  });

  it("13. auth is checked before validation", async () => {
    await expectJson(await put({}, { key: KEY_B }), 401, unauth);
    await expectJson(await call("PUT", "/syncs/progress", { user: null, raw: "not json" }), 401, unauth);
    await expectJson(await get(DOC, { user: "mallory" }), 401, unauth);
  });
});

describe("progress", () => {
  it("5. PUT then GET round-trip; integer-second timestamp; no device_id when not sent", async () => {
    const res = await put(valid);
    expect(res.status).toBe(200);
    const putBody = (await res.json()) as { document: string; timestamp: number };
    expect(putBody.document).toBe(DOC);
    expect(Number.isInteger(putBody.timestamp)).toBe(true);
    expect(Math.abs(putBody.timestamp - Date.now() / 1000)).toBeLessThanOrEqual(5);

    const g = await get(DOC);
    expect(g.status).toBe(200);
    const body = (await g.json()) as Record<string, unknown>;
    expect(body).toEqual({ ...valid, timestamp: putBody.timestamp });
    expect("device_id" in body).toBe(false);

    await put({ ...valid, device_id: "dev-1" });
    expect(await (await get(DOC)).json()).toMatchObject({ device_id: "dev-1" });
  });

  it("5. client timestamp is ignored", async () => {
    const r = (await (await put({ ...valid, timestamp: 1 })).json()) as { timestamp: number };
    expect(r.timestamp).toBeGreaterThan(1_700_000_000);
  });

  it("6. unknown document → 200 {}", async () => {
    await expectJson(await get("ffffffffffffffffffffffffffffffff"), 200, {});
    await expectJson(await call("GET", "/syncs/progress/a%3Ab"), 200, {});
    await expectJson(await call("GET", "/syncs/progress/%E0%A4%A"), 200, {});
  });

  it("7. last write wins, including lower percentage", async () => {
    await put({ ...valid, percentage: 0.9, device: "A" });
    await put({ ...valid, percentage: 0.1, progress: "p2", device: "B" });
    expect(await (await get(DOC)).json()).toMatchObject({ percentage: 0.1, progress: "p2", device: "B" });
    await put({ ...valid, percentage: 0 });
    expect(await (await get(DOC)).json()).toMatchObject({ percentage: 0 });
  });

  it("8. users are isolated", async () => {
    await put({ ...valid, percentage: 0.7 });
    await expectJson(await get(DOC, { user: "bob", key: KEY_B }), 200, {});
    await put({ ...valid, percentage: 0.2, device: "Bob" }, { user: "bob", key: KEY_B });
    expect(await (await get(DOC)).json()).toMatchObject({ percentage: 0.7, device: "Kobo" });
    expect(await (await get(DOC, { user: "bob", key: KEY_B })).json()).toMatchObject({ percentage: 0.2, device: "Bob" });
  });

  it("9. validation errors", async () => {
    const noDoc = { code: 2004, message: "Field 'document' not provided." };
    const bad = { code: 2003, message: "Invalid request" };
    const { document: _d, ...noDocument } = valid;
    await expectJson(await put(noDocument), 403, noDoc);
    for (const document of ["", "a:b", "a/b", ".", "..", "x".repeat(257), 42, null]) {
      await expectJson(await put({ ...valid, document }), 403, noDoc);
    }
    const { progress: _p, ...noProgress } = valid;
    const { device: _v, ...noDevice } = valid;
    const { percentage: _c, ...noPercentage } = valid;
    for (const b of [
      noProgress, noDevice, noPercentage,
      { ...valid, percentage: "0.5" }, { ...valid, percentage: null },
      { ...valid, progress: 5 }, { ...valid, progress: "x".repeat(4097) },
      { ...valid, device: "x".repeat(257) }, { ...valid, device_id: 7 }, { ...valid, device_id: "x".repeat(257) },
    ]) {
      await expectJson(await put(b), 403, bad);
    }
    const badJson = await call("PUT", "/syncs/progress", { raw: "{bad" });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toMatchObject({ code: 103 });
    for (const raw of ["[]", "[1,2]", "42", '"s"', "null", "true"]) {
      const r = await call("PUT", "/syncs/progress", { raw });
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ code: 104 });
    }
    await expectJson(await put({ ...valid, progress: "x".repeat(17 * 1024) }), 403, bad);
    await expectJson(await get(DOC), 200, {});
  });

  it("10. ids with - and . round-trip", async () => {
    for (const document of ["my-book.epub", "a.b-c_d", "-", "...", ".x"]) {
      expect((await put({ ...valid, document })).status).toBe(200);
      expect(await (await get(document)).json()).toMatchObject({ document });
    }
  });

  it("11. metadata is accepted but not persisted", async () => {
    const res = await put({ ...valid, metadata: { title: "Secret Title", author: "A. Writer", filename: "x.epub" } });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT * FROM progress WHERE username = ?1 AND document = ?2").bind("alice", DOC).first();
    expect(Object.keys(row ?? {}).sort()).toEqual(["device", "device_id", "document", "percentage", "progress", "timestamp", "username"]);
    expect(JSON.stringify(row)).not.toMatch(/Secret|Writer|x\.epub/);
  });
});
