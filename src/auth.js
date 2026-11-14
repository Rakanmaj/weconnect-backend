import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { transaction } from "./db.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./passwords.js";
import { loginSchema, registrationSchema } from "./validation.js";
import { COMPANY_COOKIE, resolveCompanyWorkspace } from './company-access.js';
import { fail } from './errors.js';

export const COOKIE_NAME = "weconnect_session";
const tokenHash = token => createHash("sha256").update(token).digest("hex");
const cookieToken = req => /^[a-f0-9]{64}$/.test(req.cookies?.[COOKIE_NAME] || "") ? req.cookies[COOKIE_NAME] : null;

const USER_SELECT = `SELECT u.id, u.role, u.email, u.first_name, u.last_name,
  u.email_verified_at, u.created_at, v.status AS verification_status,
  d.user_id AS developer_id, d.preferred_position, d.location AS developer_location, d.github_url,
  c.user_id AS company_id, c.company_name, c.website, c.industry, c.company_size,
  c.location AS company_location, c.contact_name, c.contact_title, c.about
  FROM public.users u
  LEFT JOIN public.developer_profiles d ON d.user_id = u.id
  LEFT JOIN public.company_profiles c ON c.user_id = u.id
  LEFT JOIN public.account_verifications v ON v.user_id = u.id`;

function publicUser(row) {
  return {
    id: row.id, role: row.role, email: row.email,
    firstName: row.first_name, lastName: row.last_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    emailVerified: Boolean(row.email_verified_at), createdAt: row.created_at,
    verificationStatus: row.verification_status || 'draft',
    ...(row.developer_id ? { developer: { preferredPosition: row.preferred_position, location: row.developer_location, github: row.github_url } } : {}),
    ...(row.company_id ? { company: { name: row.company_name, website: row.website, industry: row.industry, size: row.company_size, location: row.company_location, contactName: row.contact_name, contactTitle: row.contact_title, about: row.about } } : {}),
  };
}

async function hydrateUser(client, row, companyId = null) {
  const user = publicUser(row);
  if (user.role === 'company') {
    const context = (companyId && await resolveCompanyWorkspace(client, user.id, companyId)) || await resolveCompanyWorkspace(client, user.id);
    if (!context) fail(403, 'Your company workspace access is unavailable or has been revoked. Contact your company administrator.');
    return { ...user, ...context };
  }
  return user;
}

export async function userById(client, id, companyId = null) {
  const { rows } = await client.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
  return hydrateUser(client, rows[0], companyId);
}

function cookieOptions(config) {
  return { httpOnly: true, sameSite: "lax", secure: config.secureCookies, path: "/" };
}

async function createSession(client, userId, oldToken, config) {
  if (oldToken) await client.query("DELETE FROM public.user_sessions WHERE token_hash = $1", [tokenHash(oldToken)]);
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  await client.query("INSERT INTO public.user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)", [userId, tokenHash(token), expires]);
  return { token, expires };
}

function setSessionCookie(res, session, config) {
  res.cookie(COOKIE_NAME, session.token, { ...cookieOptions(config), expires: session.expires });
  res.clearCookie(COMPANY_COOKIE, cookieOptions(config));
}

function parse(schema, body, res) {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  res.status(400).json({ error: result.error.issues[0]?.message || "Check the form fields.", fields: result.error.flatten().fieldErrors });
  return null;
}

export function createAuthRouter(pool, config) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => res.status(429).json({ error: "Too many attempts. Please try again in 15 minutes." }),
  });

  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  router.post("/register", limiter, async (req, res) => {
    const data = parse(registrationSchema, req.body, res);
    if (!data) return;
    const passwordHash = await hashPassword(data.password);
    const names = data.role === "developer" ? [data.firstName, data.lastName] : [data.contactName.split(/\s+/)[0], data.contactName.split(/\s+/).slice(1).join(" ")];
    try {
      const result = await transaction(pool, async client => {
        const { rows } = await client.query(
          `INSERT INTO public.users (role, email, password_hash, first_name, last_name)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [data.role, data.email, passwordHash, ...names],
        );
        const id = rows[0].id;
        if (data.role === "developer") {
          await client.query(
            `INSERT INTO public.developer_profiles (user_id, preferred_position, location, github_url)
             VALUES ($1, $2, $3, $4)`, [id, data.preferredRole, data.location, data.github],
          );
        } else {
          await client.query(
            `INSERT INTO public.company_profiles
             (user_id, company_name, website, industry, company_size, location, contact_name, contact_title, about)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, data.companyName, data.website, data.industry, data.size, data.location, data.contactName, data.contactTitle, data.about],
          );
        }
        const session = await createSession(client, id, cookieToken(req), config);
        return { user: await userById(client, id), session };
      });
      setSessionCookie(res, result.session, config);
      res.status(201).json({ user: result.user });
    } catch (error) {
      if (error.code === "23505" && error.constraint === "users_email_unique") {
        return res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
      }
      throw error;
    }
  });

  router.post("/login", limiter, async (req, res) => {
    const data = parse(loginSchema, req.body, res);
    if (!data) return;
    const { rows } = await pool.query("SELECT id, role, password_hash, account_status FROM public.users WHERE lower(email) = $1", [data.email]);
    const account = rows[0];
    const valid = await verifyPassword(data.password, account?.password_hash || DUMMY_HASH);
    if (!account || !valid) return res.status(401).json({ error: "Email or password is incorrect." });
    if (account.account_status !== "active") return res.status(403).json({ error: "This account is unavailable. Please contact support." });
    if (data.role && account.role !== data.role) return res.status(403).json({ error: `This is a ${account.role} account. Choose the matching sign-in page.` });
    const result = await transaction(pool, async client => {
      const session = await createSession(client, account.id, cookieToken(req), config);
      await client.query("UPDATE public.users SET last_login_at = NOW() WHERE id = $1", [account.id]);
      return { user: await userById(client, account.id), session };
    });
    setSessionCookie(res, result.session, config);
    res.json({ user: result.user });
  });

  const requireAuth = authenticationRequired(pool);
  router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

  router.post("/logout", async (req, res) => {
    const token = cookieToken(req);
    if (token) await pool.query("DELETE FROM public.user_sessions WHERE token_hash = $1", [tokenHash(token)]);
    res.clearCookie(COOKIE_NAME, cookieOptions(config));
    res.clearCookie(COMPANY_COOKIE, cookieOptions(config));
    res.status(204).end();
  });

  return router;
}

export function authenticationRequired(pool) {
  return async (req, res, next) => {
    const token = cookieToken(req);
    if (!token) return res.status(401).json({ error: "Please sign in to continue." });
    const { rows } = await pool.query(
      `${USER_SELECT} JOIN public.user_sessions s ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.account_status = 'active'`, [tokenHash(token)],
    );
    if (!rows[0]) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    req.user = await hydrateUser(pool, rows[0], req.cookies?.[COMPANY_COOKIE]);
    next();
  };
}

export function roleRequired(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: "You do not have access to this portal." });
    next();
  };
}
