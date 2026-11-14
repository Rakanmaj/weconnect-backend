import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { authenticationRequired, createAuthRouter, roleRequired } from "./auth.js";
import { createFileRouter, createProfileRouter, createReviewRouter } from './profiles.js';
import { createRecoveryRouter } from './recovery.js';
import { createTeamRouter } from './team.js';
import { createMailer } from './mail.js';
import { rateLimit } from 'express-rate-limit';
import { requireCompanyPermission } from './company-access.js';
import { createGrowthRouter, createGrowthAdminRouter, createGrowthFileRouter } from './growth.js';

export function createApp({ pool, config, logger = console, sendMail = createMailer(config) }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: { directives: { "upgrade-insecure-requests": config.production ? [] : null } }, strictTransportSecurity: config.production }));
  const accountJson = express.json({ limit: '24kb' });
  const growthJson = express.json({ limit: '256kb' });
  app.use((req,res,next) => (/^\/api\/(?:growth(?:\/|$)|admin\/growth(?:\/|$))/.test(req.path) ? growthJson : accountJson)(req,res,next));
  app.use(cookieParser());

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if ((origin && !config.webOrigins.includes(origin)) || req.get("sec-fetch-site") === "cross-site") {
        return res.status(403).json({ error: "This request origin is not allowed." });
      }
      const fileUpload = req.method === 'POST' && (/^\/files\/(cv|certificate|identity|registration|avatar)$/.test(req.path) || /^\/growth-files\/[a-f0-9-]{36}$/.test(req.path)) && req.is('multipart/form-data');
      if (!req.is("application/json") && !fileUpload) return res.status(415).json({ error: "Send form data as JSON." });
    }
    next();
  });

  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  });
  app.use("/api/auth", createAuthRouter(pool, config));
  app.use('/api/auth', createRecoveryRouter(pool, config, sendMail, logger));
  app.use('/api/profile', createProfileRouter(pool));
  app.use('/api/files', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }), createFileRouter(pool));
  app.use('/api/admin/verifications', createReviewRouter(pool));
  app.use('/api/team', createTeamRouter(pool, config, sendMail));
  app.use('/api/growth', createGrowthRouter(pool, config));
  app.use('/api/admin/growth', createGrowthAdminRouter(pool));
  app.use('/api/growth-files', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }), createGrowthFileRouter(pool));

  // A server-side permission boundary for each portal; future APIs use these same middleware.
  for (const role of ["developer", "company", "admin"]) {
    app.get(`/api/portals/${role}`, authenticationRequired(pool), roleRequired(role), (req, res) => res.json({ portal: role, user: req.user }));
  }
  // Permission boundaries for the current company workspace. Future business APIs reuse these checks.
  const companyModules = { dashboard: 'overview:view', projects: 'projects:view', 'project-management': 'projects:manage',
    talent: 'talent:view', hiring: 'hiring:manage', interviews: 'hiring:manage', offers: 'hiring:manage',
    evaluations: 'evaluations:manage', profile: 'company:manage', verification: 'company:manage',
    team: 'team:view', 'team-management': 'team:manage', payments: 'finance:view', settings: 'settings:manage', notifications: 'notifications:view' };
  for (const [module, permission] of Object.entries(companyModules)) {
    app.get(`/api/company/access/${module}`, authenticationRequired(pool), requireCompanyPermission(permission), (req, res) =>
      res.json({ module, company: req.user.company, companyAccess: req.user.companyAccess }));
  }

  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
  app.use((error, _req, res, _next) => {
    if (error.name === 'MulterError') return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be no larger than 10 MB.' : 'Upload one file at a time using the file field.' });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON request." });
    if (error.type === "entity.too.large") return res.status(413).json({ error: "The submitted form is too large." });
    if ((error.status >= 400 && error.status < 500) || (error.status === 503 && error.expose === true)) return res.status(error.status).json({ error: error.message });
    logger.error("API error:", error.code || error.name);
    const databaseError = ["DATABASE_NOT_CONFIGURED", "ECONNREFUSED", "ENOTFOUND", "28P01", "3D000", "42P01", "57P01", "53300"].includes(error.code) || error.name === "AggregateError";
    res.status(databaseError ? 503 : 500).json({ error: databaseError ? "The service is temporarily unavailable. Please check the database connection and schema setup." : "Something went wrong. Please try again." });
  });
  return app;
}
