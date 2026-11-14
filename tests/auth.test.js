import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHash } from "node:crypto";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { COOKIE_NAME } from "../src/auth.js";
import { hashPassword, verifyPassword } from "../src/passwords.js";
import { testDatabase } from "./helpers/database.js";

const password = "Testing2026!";
const origin = "http://localhost:3000";
const config = { webOrigins: [origin], secureCookies: false, sessionDays: 7, authLimit: 1000, production: false };
const logger = { error() {} };
let fixture, app, developer, company, admin;
const developerData = (email, extra = {}) => ({ role: "developer", email, password, confirmPassword: password, firstName: "Rakan", lastName: "Test", preferredRole: "Full-Stack Developer", location: "Amman, Jordan", github: "https://github.com/test", ...extra });
const companyData = (email, extra = {}) => ({ role: "company", email, password, confirmPassword: password, companyName: "Test Company", website: "https://company.example.com", industry: "Technology", size: "11-50", location: "Amman", contactName: "Sara Test", contactTitle: "Engineering Lead", about: "Example company", ...extra });
const post = (url, data, agent = request(app)) => agent.post(url).set("Origin", origin).send(data);
const cookie = response => response.headers["set-cookie"]?.[0]?.split(";")[0];
function login(email, role, agent = request(app)) { return post("/api/auth/login", { email, password, role }, agent); }

before(async () => {
  fixture = await testDatabase();
  app = createApp({ pool: fixture.pool, config, logger });
  developer = (await post("/api/auth/register", developerData("rakan@example.com")).expect(201)).body.user;
  company = (await post("/api/auth/register", companyData("company@example.com")).expect(201)).body.user;
  const { rows } = await fixture.pool.query(`INSERT INTO public.users(role,email,password_hash,first_name,last_name)
    VALUES ('admin', $1, $2, 'Admin', 'Test') RETURNING id`, ["admin@example.com", await hashPassword(password)]);
  admin = { id: rows[0].id, role: "admin", email: "admin@example.com" };
});
after(async () => { await fixture?.pool.end(); });

test("developer signup persists profile, normalizes email and stores only a password hash", async () => {
  const response = await post("/api/auth/register", developerData("  NEW.User@Example.COM  ")).expect(201);
  assert.equal(response.body.user.email, "new.user@example.com");
  assert.equal(response.body.user.emailVerified, false);
  assert.equal(response.body.user.developer.github, "https://github.com/test");
  assert.equal(response.body.user.password_hash, undefined);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  assert.match(response.headers["set-cookie"][0], /SameSite=Lax/);
  const { rows } = await fixture.pool.query("SELECT password_hash FROM public.users WHERE id=$1", [response.body.user.id]);
  assert.notEqual(rows[0].password_hash, password);
  assert.ok(await verifyPassword(password, rows[0].password_hash));
});

test("company signup persists the complete registration form", async () => {
  const response = await post("/api/auth/register", companyData("company2@example.com")).expect(201);
  assert.equal(response.body.user.name, "Sara Test");
  assert.deepEqual(response.body.user.company, { name: "Test Company", website: "https://company.example.com", industry: "Technology", size: "11-50", location: "Amman", contactName: "Sara Test", contactTitle: "Engineering Lead", about: "Example company" });
});

test("case-insensitive duplicate registration returns 409 without creating another account", async () => {
  await post("/api/auth/register", developerData("RAKAN@EXAMPLE.COM")).expect(409);
  const { rows } = await fixture.pool.query("SELECT count(*)::int AS count FROM public.users WHERE email = $1", [developer.email]);
  assert.equal(rows[0].count, 1);
});

test("invalid passwords, confirmation, email, URLs and company size are rejected", async () => {
  for (const data of [
    developerData("short@example.com", { password: "short", confirmPassword: "short" }),
    developerData("long@example.com", { password: "a".repeat(129), confirmPassword: "a".repeat(129) }),
    developerData("mismatch@example.com", { confirmPassword: "different" }),
    developerData("not-an-email"), developerData("url@example.com", { github: "not-a-url" }),
    companyData("badsite@example.com", { website: "javascript:alert(1)" }),
    companyData("badsize@example.com", { size: "invalid" }),
  ]) await post("/api/auth/register", data).expect(400);
});

test("public registration cannot create admins or override account status and identity", async () => {
  await post("/api/auth/register", developerData("evil@example.com", { role: "admin" })).expect(400);
  const response = await post("/api/auth/register", developerData("fields@example.com", { id: admin.id, emailVerified: true, account_status: "suspended" })).expect(201);
  assert.notEqual(response.body.user.id, admin.id);
  assert.equal(response.body.user.role, "developer");
  assert.equal(response.body.user.emailVerified, false);
});

test("a returned cookie restores the same user after an API restart", async () => {
  const response = await login("RAKAN@EXAMPLE.COM", "developer").expect(200);
  const restarted = createApp({ pool: fixture.pool, config, logger });
  const me = await request(restarted).get("/api/auth/me").set("Cookie", cookie(response)).expect(200);
  assert.equal(me.body.user.id, developer.id);
  assert.equal(me.headers["cache-control"], "no-store");
});

test("session database stores a hash rather than the bearer cookie token", async () => {
  const response = await login(developer.email, "developer").expect(200);
  const token = cookie(response).split("=")[1];
  const digest = createHash("sha256").update(token).digest("hex");
  const { rows } = await fixture.pool.query("SELECT token_hash FROM public.user_sessions WHERE token_hash=$1", [digest]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
});

test("wrong and unknown credentials return the same 401 error without a cookie", async () => {
  const wrong = await post("/api/auth/login", { email: developer.email, password: "Wrong2026!" }).expect(401);
  const missing = await post("/api/auth/login", { email: "missing@example.com", password }).expect(401);
  assert.equal(wrong.body.error, missing.body.error);
  assert.equal(wrong.headers["set-cookie"], undefined);
});

test("a valid password cannot sign in as a different role", async () => {
  const response = await login(developer.email, "admin").expect(403);
  assert.equal(response.headers["set-cookie"], undefined);
});

test("backend permissions allow only the signed-in account's own portal", async () => {
  for (const account of [developer, company, admin]) {
    const response = await login(account.email, account.role).expect(200);
    for (const portal of ["developer", "company", "admin"]) {
      await request(app).get(`/api/portals/${portal}`).set("Cookie", cookie(response)).expect(portal === account.role ? 200 : 403);
    }
  }
  await request(app).get("/api/portals/admin").expect(401);
});

test("login rotates and invalidates the previous browser session", async () => {
  const first = await login(developer.email, "developer").expect(200);
  const second = await request(app).post("/api/auth/login").set("Origin", origin).set("Cookie", cookie(first)).send({ email: developer.email, password }).expect(200);
  assert.notEqual(cookie(first), cookie(second));
  await request(app).get("/api/auth/me").set("Cookie", cookie(first)).expect(401);
  await request(app).get("/api/auth/me").set("Cookie", cookie(second)).expect(200);
});

test("logout revokes stored sessions and old cookies cannot be replayed", async () => {
  const response = await login(developer.email, "developer").expect(200);
  const logout = await request(app).post("/api/auth/logout").set("Origin", origin).set("Cookie", cookie(response)).send({}).expect(204);
  assert.match(logout.headers["set-cookie"][0], /Expires=Thu, 01 Jan 1970/);
  await request(app).get("/api/auth/me").set("Cookie", cookie(response)).expect(401);
  await post("/api/auth/logout", {}).expect(204);
});

test("expired, fabricated and malformed sessions are refused", async () => {
  const response = await login(developer.email, "developer").expect(200);
  const token = cookie(response).split("=")[1];
  await fixture.pool.query("UPDATE public.user_sessions SET expires_at=NOW()-INTERVAL '1 day' WHERE token_hash=$1", [createHash("sha256").update(token).digest("hex")]);
  for (const value of [cookie(response), `${COOKIE_NAME}=${"f".repeat(64)}`, `${COOKIE_NAME}=invalid`]) {
    await request(app).get("/api/auth/me").set("Cookie", value).expect(401);
  }
});

test("suspending an account blocks existing sessions and new sign-ins", async () => {
  const response = await login(developer.email, "developer").expect(200);
  try {
    await fixture.pool.query("UPDATE public.users SET account_status='suspended' WHERE id=$1", [developer.id]);
    await request(app).get("/api/auth/me").set("Cookie", cookie(response)).expect(401);
    await login(developer.email, "developer").expect(403);
  } finally { await fixture.pool.query("UPDATE public.users SET account_status='active' WHERE id=$1", [developer.id]); }
});

test("SQL-like input is stored as text, not executed", async () => {
  const firstName = "Robert'); DROP TABLE users; --";
  const response = await post("/api/auth/register", developerData("injection@example.com", { firstName })).expect(201);
  assert.equal(response.body.user.firstName, firstName);
  await login(developer.email, "developer").expect(200);
});

test("foreign origins cannot register or log a user out", async () => {
  await request(app).post("/api/auth/register").set("Origin", "https://untrusted.example").send(developerData("csrf@example.com")).expect(403);
  const response = await login(developer.email, "developer").expect(200);
  await request(app).post("/api/auth/logout").set("Origin", "https://untrusted.example").set("Cookie", cookie(response)).send({}).expect(403);
  await request(app).get("/api/auth/me").set("Cookie", cookie(response)).expect(200);
});

test("malformed JSON, non-JSON and oversized bodies fail safely", async () => {
  await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"broken":').expect(400);
  await request(app).post("/api/auth/login").type("form").send({ email: developer.email, password }).expect(415);
  await post("/api/auth/register", { text: "x".repeat(25000) }).expect(413);
});

test("failed profile inserts roll back both account and session", async () => {
  await fixture.pool.query("ALTER TABLE public.developer_profiles ADD CONSTRAINT test_profile_failure CHECK (preferred_position <> 'Frontend Developer')");
  try {
    const response = await post("/api/auth/register", developerData("rollback@example.com", { preferredRole: "Frontend Developer" })).expect(500);
    assert.equal(response.headers["set-cookie"], undefined);
    const { rows } = await fixture.pool.query("SELECT count(*)::int AS count FROM public.users WHERE email='rollback@example.com'");
    assert.equal(rows[0].count, 0);
  } finally { await fixture.pool.query("ALTER TABLE public.developer_profiles DROP CONSTRAINT test_profile_failure"); }
});

test("simultaneous duplicate requests create exactly one account and profile", async () => {
  const responses = await Promise.all([post("/api/auth/register", developerData("race@example.com")), post("/api/auth/register", developerData("RACE@example.com"))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  const { rows } = await fixture.pool.query("SELECT count(*)::int AS count FROM public.users u JOIN public.developer_profiles d ON d.user_id=u.id WHERE email='race@example.com'");
  assert.equal(rows[0].count, 1);
});

test("re-running the SQL schema preserves registered accounts", async () => {
  await fixture.db.exec(fixture.schema);
  await login(developer.email, "developer").expect(200);
});

test("rate limiting returns 429 and HTTPS cookie configuration adds Secure", async () => {
  const limited = createApp({ pool: fixture.pool, config: { ...config, authLimit: 1 }, logger });
  await request(limited).post("/api/auth/login").send({ email: "bad" }).expect(400);
  await request(limited).post("/api/auth/login").send({ email: "bad" }).expect(429);
  const secure = createApp({ pool: fixture.pool, config: { ...config, secureCookies: true }, logger });
  const response = await request(secure).post("/api/auth/login").send({ email: developer.email, password }).expect(200);
  assert.match(response.headers["set-cookie"][0], /; Secure/);
});

test("missing PostgreSQL configuration fails clearly without any fallback database", async () => {
  const unavailable = createApp({ pool: createPool(undefined), config, logger });
  await request(unavailable).get("/api/health").expect(503);
  const response = await request(unavailable).post("/api/auth/login").send({ email: developer.email, password }).expect(503);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.ok(!JSON.stringify(response.body).includes("password_hash"));
});
