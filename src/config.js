import dotenv from "dotenv";
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: resolve(backendRoot, '.env'), quiet: true });

export function getConfig() {
  const production = process.env.NODE_ENV === "production";
  return {
    databaseUrl: process.env.DATABASE_URL,
    apiPort: Number(process.env.API_PORT || 4000),
    webOrigins: (process.env.WEB_ORIGIN || "http://localhost:3000").split(",").map(value => value.trim()),
    secureCookies: process.env.COOKIE_SECURE === undefined ? production : process.env.COOKIE_SECURE === "true",
    sessionDays: 7,
    authLimit: 20,
    production,
    appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    mailMode: process.env.MAIL_MODE || (production ? 'smtp' : 'outbox'),
    mailOutbox: resolve(backendRoot, process.env.MAIL_OUTBOX || '.local/mail'),
    mailFrom: process.env.MAIL_FROM,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
    runnerUrl: process.env.CODE_RUNNER_URL || '',
    runnerMode: process.env.CODE_RUNNER_MODE || 'local',
    runnerToken: process.env.CODE_RUNNER_TOKEN || '',
    runnerLanguageId: Number(process.env.CODE_RUNNER_LANGUAGE_ID || 63),
  };
}
