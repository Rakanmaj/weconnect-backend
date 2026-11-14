import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export function createMailer(config) {
  let transport;
  return async ({ to, subject, text }) => {
    if (config.mailMode === 'smtp') {
      if (!config.smtpHost || !config.mailFrom) throw new Error('SMTP_NOT_CONFIGURED');
      transport ||= nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure,
        ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPassword } } : {}),
        connectionTimeout: 10000, socketTimeout: 15000 });
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
      return;
    }
    if (config.production || config.mailMode !== 'outbox') throw new Error('MAIL_NOT_CONFIGURED');
    // Development only: private local files, never a public API or a browser route.
    const directory = resolve(config.mailOutbox || '.local/mail');
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${Date.now()}-${randomUUID()}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}\n`, { flag: 'wx', mode: 0o600 });
  };
}
