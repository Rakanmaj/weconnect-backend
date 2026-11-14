import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { authenticationRequired } from './auth.js';
import { transaction } from './db.js';
import { fail, validate } from './errors.js';
import { emailSchema, resetSchema, tokenSchema } from './profile-validation.js';
import { hashPassword } from './passwords.js';
import { lockUser } from './profiles.js';

export const digestToken = value => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
export const appLink = (config, path, token) => `${config.appUrl || 'http://localhost:3000'}${path}#token=${token}`;

export function createRecoveryRouter(pool, config, sendMail, logger) {
  const router = Router();
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.recoveryLimit || 10, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Try again in 15 minutes.' }) });
  router.use(limit);
  async function issue(user, purpose) {
    const token = newToken();
    await transaction(pool, async client => {
      await lockUser(client, user.id);
      await client.query('DELETE FROM public.account_tokens WHERE user_id=$1 AND purpose=$2', [user.id, purpose]);
      await client.query(`INSERT INTO public.account_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4)`,
        [user.id, purpose, digestToken(token), new Date(Date.now() + (purpose === 'password-reset' ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000))]);
    });
    const reset = purpose === 'password-reset';
    await sendMail({ to: user.email, subject: reset ? 'Reset your WeConnect password' : 'Verify your WeConnect email',
      text: `${reset ? 'Reset your password (expires in 30 minutes)' : 'Verify your email (expires in 24 hours)'}:\n${appLink(config, reset ? '/login/reset-password' : '/register/verify-email', token)}\n\nIf you did not request this, ignore this message.` });
  }
  router.post('/forgot-password', async (req, res) => {
    const { email } = validate(emailSchema, req.body);
    const { rows } = await pool.query("SELECT id,email FROM public.users WHERE email=$1 AND account_status='active'", [email]);
    if (rows[0]) {
      try { await issue(rows[0], 'password-reset'); }
      catch (error) { logger.error('Password recovery delivery failed:', error.code || error.name); }
    }
    // Same response for known/unknown addresses, with no token or account details.
    res.status(202).json({ message: 'If an active account matches that email, a reset link will be delivered. Check your inbox or ask the local demo operator to check the development outbox.' });
  });
  router.post('/reset-password', async (req, res) => {
    const data = validate(resetSchema, req.body);
    const passwordHash = await hashPassword(data.password);
    await transaction(pool, async client => {
      // Lock the user first, matching issue() lock order and serializing concurrent resets.
      const lookup = await client.query("SELECT user_id FROM public.account_tokens WHERE token_hash=$1 AND purpose='password-reset'", [digestToken(data.token)]);
      if (!lookup.rows[0]) fail(400, 'This link is invalid or expired. Request a new reset link.');
      const id = lookup.rows[0].user_id;
      await lockUser(client, id);
      const { rows } = await client.query(`SELECT t.id FROM public.account_tokens t JOIN public.users u ON u.id=t.user_id
        WHERE t.token_hash=$1 AND t.purpose='password-reset' AND t.used_at IS NULL AND t.expires_at>NOW() AND u.account_status='active'`, [digestToken(data.token)]);
      if (!rows[0]) fail(400, 'This link is invalid or expired. Request a new reset link.');
      await client.query('UPDATE public.users SET password_hash=$2,updated_at=NOW() WHERE id=$1', [id, passwordHash]);
      await client.query("UPDATE public.account_tokens SET used_at=NOW() WHERE user_id=$1 AND purpose='password-reset'", [id]);
      await client.query('DELETE FROM public.user_sessions WHERE user_id=$1', [id]);
    });
    res.json({ message: 'Password updated. Sign in with your new password. All previous sessions have been signed out.' });
  });
  router.post('/send-verification', authenticationRequired(pool), async (req, res) => {
    if (req.user.emailVerified) return res.json({ message: 'Your email is already verified.' });
    try { await issue(req.user, 'email-verification'); }
    catch { fail(503, 'Cannot deliver the verification link. Check email delivery settings and try again.'); }
    res.json({ message: 'Verification link prepared. Check your inbox; local development emails are saved in .local/mail.' });
  });
  router.post('/verify-email', async (req, res) => {
    const { token } = validate(tokenSchema, req.body);
    await transaction(pool, async client => {
      const lookup = await client.query("SELECT user_id FROM public.account_tokens WHERE token_hash=$1 AND purpose='email-verification'", [digestToken(token)]);
      if (!lookup.rows[0]) fail(400, 'This link is invalid or expired. Request another verification email.');
      const id = lookup.rows[0].user_id;
      await lockUser(client, id);
      const { rows } = await client.query(`SELECT t.id FROM public.account_tokens t JOIN public.users u ON u.id=t.user_id
        WHERE t.token_hash=$1 AND t.purpose='email-verification' AND t.used_at IS NULL AND t.expires_at>NOW() AND u.account_status='active'`, [digestToken(token)]);
      if (!rows[0]) fail(400, 'This link is invalid or expired. Request another verification email.');
      await client.query('UPDATE public.users SET email_verified_at=NOW(),updated_at=NOW() WHERE id=$1', [id]);
      await client.query("UPDATE public.account_tokens SET used_at=NOW() WHERE user_id=$1 AND purpose='email-verification'", [id]);
    });
    res.json({ message: 'Email verified. You can now submit your profile for account review.' });
  });
  return router;
}
