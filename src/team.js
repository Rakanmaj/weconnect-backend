import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticationRequired, roleRequired, userById } from './auth.js';
import { COMPANY_COOKIE, resolveCompanyWorkspace, teamWorkspace } from './company-access.js';
import { transaction } from './db.js';
import { fail, validate, validId } from './errors.js';
import { teamSchema, tokenSchema } from './profile-validation.js';
import { digestToken } from './recovery.js';
import { hashPassword } from './passwords.js';
import { lockUser } from './profiles.js';

export function createTeamRouter(pool, config, sendMail) {
  const router = Router();
  router.use(authenticationRequired(pool), roleRequired('company'));
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  router.get('/workspaces', async (req, res) => {
    const { rows } = await pool.query(`SELECT c.user_id AS id,c.company_name AS name FROM public.company_profiles c
      JOIN public.users owner ON owner.id=c.user_id AND owner.account_status='active'
      WHERE c.user_id=$1 OR EXISTS (SELECT 1 FROM public.company_team_members m WHERE m.company_id=c.user_id
        AND m.member_user_id=$1 AND m.status='active') ORDER BY c.company_name`, [req.user.id]);
    res.json({ workspaces: rows });
  });
  router.post('/switch', async (req, res) => {
    const id = req.body?.companyId;
    if (!validId(id) || !await resolveCompanyWorkspace(pool, req.user.id, id)) fail(403, 'You do not have access to that workspace.');
    res.cookie(COMPANY_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: config.sessionDays * 86400000 });
    res.json({ user: await userById(pool, req.user.id, id) });
  });
  router.get('/', async (req, res) => {
    const ws = await teamWorkspace(pool, req);
    const { rows } = await pool.query(`SELECT id,name,email,team_role AS role,status,member_user_id IS NOT NULL AS "hasAccount",
      joined_at AS "joinedAt",expires_at AS "expiresAt" FROM public.company_team_members WHERE company_id=$1 ORDER BY created_at`, [ws.companyId]);
    const owner = (await pool.query(`SELECT u.id,concat(u.first_name,' ',u.last_name) AS name,u.email FROM public.users u WHERE id=$1`, [ws.companyId])).rows[0];
    res.json({ companyId: ws.companyId, companyName: ws.name, workspaceRole: ws.role, canManage: ws.permissions.includes('team:manage'), members: [{ ...owner, role: 'Owner', status: 'active', hasAccount: true }, ...rows] });
  });
  router.post('/invite', limit, async (req, res) => {
    const data = validate(teamSchema, req.body);
    await teamWorkspace(pool, req, 'team:manage');
    const passwordHash = await hashPassword(data.password);
    let result;
    try {
      result = await transaction(pool, async client => {
        const ws = await teamWorkspace(client, req, 'team:manage');
        await lockUser(client, ws.companyId);
        await teamWorkspace(client, req, 'team:manage');
        const existing = await client.query('SELECT id FROM public.users WHERE email=$1', [data.email]);
        if (existing.rows[0]) fail(409, 'This email already has an account. Use an unused email for new team access. Existing passwords are never overwritten.');
        const [firstName, ...lastName] = data.name.split(/\s+/);
        const account = await client.query(`INSERT INTO public.users(role,email,password_hash,first_name,last_name)
          VALUES('company',$1,$2,$3,$4) RETURNING id`, [data.email, passwordHash, firstName, lastName.join(' ')]);
        // Staff are individual logins linked to the inviter's company. No company profile is created for them.
        const member = await client.query(`INSERT INTO public.company_team_members
          (company_id,member_user_id,name,email,team_role,status,token_hash,expires_at,invited_by,joined_at)
          VALUES($1,$2,$3,$4,$5,'active',NULL,NULL,$6,NOW())
          ON CONFLICT(company_id,email) DO UPDATE SET member_user_id=$2,name=$3,team_role=$5,status='active',
          token_hash=NULL,expires_at=NULL,invited_by=$6,joined_at=NOW(),updated_at=NOW()
          RETURNING id,name,email,team_role AS role,status`,
        [ws.companyId, account.rows[0].id, data.name, data.email, data.role, req.user.id]);
        const loginUrl = `${config.appUrl || 'http://localhost:3000'}/login?next=%2Fcompany%2Fdashboard&email=${encodeURIComponent(data.email)}`;
        try {
          await sendMail({ to: data.email, subject: `Your ${ws.name} team sign-in details`,
            text: `You have been given ${data.role} access to ${ws.name} on WeConnect.\n\nSign in: ${loginUrl}\nEmail: ${data.email}\nPassword: ${data.password}\nRole: ${data.role}\n\nYour company administrator set this password. Sign in directly; do not create a separate company account or accept an invitation token. You can use Forgot password to choose a different password.\n\nYour access is limited to your company role.` });
        } catch { fail(503, 'Could not prepare the member email. No account was created. Check email delivery settings and try again.'); }
        return { member: member.rows[0] };
      });
    } catch (error) {
      if (error.code === '23505') fail(409, 'This email already has an account. Use an unused email for new team access.');
      throw error;
    }
    res.status(201).json(result);
  });
  // Keep old invitation links usable for accounts created before the new sign-in flow.
  router.post('/accept', async (req, res) => {
    const { token } = validate(tokenSchema, req.body);
    let companyId;
    await transaction(pool, async client => {
      const lookup = (await client.query('SELECT company_id FROM public.company_team_members WHERE token_hash=$1', [digestToken(token)])).rows[0];
      if (!lookup) fail(400, 'This invitation is invalid or expired. Ask your company administrator for sign-in details.');
      companyId = lookup.company_id;
      await lockUser(client, companyId);
      const member = (await client.query("SELECT id,email FROM public.company_team_members WHERE token_hash=$1 AND status='invited' AND expires_at>NOW()", [digestToken(token)])).rows[0];
      if (!member) fail(400, 'This invitation is invalid or expired.');
      if (member.email !== req.user.email) fail(403, 'Sign in with the email address that received this invitation.');
      if (!req.user.emailVerified) fail(403, 'Verify your email address before accepting this older invitation.');
      await client.query("UPDATE public.company_team_members SET member_user_id=$2,status='active',token_hash=NULL,joined_at=NOW(),updated_at=NOW() WHERE id=$1", [member.id, req.user.id]);
    });
    res.cookie(COMPANY_COOKIE, companyId, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: config.sessionDays * 86400000 });
    res.json({ message: 'Invitation accepted. You now have access to the invited company workspace.' });
  });
  router.patch('/:id', async (req, res) => {
    const role = ['Admin', 'Evaluator', 'Recruiter'].includes(req.body?.role) ? req.body.role : null;
    const restore = req.body?.restore === true;
    if ((!role && !restore) || !validId(req.params.id)) fail(400, 'Choose a valid team member and role.');
    await transaction(pool, async client => {
      const ws = await teamWorkspace(client, req, 'team:manage');
      await lockUser(client, ws.companyId);
      await teamWorkspace(client, req, 'team:manage');
      const updated = await client.query(`UPDATE public.company_team_members SET team_role=coalesce($3,team_role),
        status=CASE WHEN $4::boolean AND member_user_id IS NOT NULL THEN 'active' ELSE status END,updated_at=NOW()
        WHERE id=$1 AND company_id=$2 AND (status<>'revoked' OR $4::boolean) RETURNING id`, [req.params.id, ws.companyId, role, restore]);
      if (!updated.rows[0]) fail(404, 'Team member not found.');
    });
    res.status(204).end();
  });
  router.delete('/:id', async (req, res) => {
    if (!validId(req.params.id)) fail(404, 'Team member not found.');
    await transaction(pool, async client => {
      const ws = await teamWorkspace(client, req, 'team:manage');
      await lockUser(client, ws.companyId);
      await teamWorkspace(client, req, 'team:manage');
      const result = await client.query("UPDATE public.company_team_members SET status='revoked',token_hash=NULL,updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING member_user_id", [req.params.id, ws.companyId]);
      if (!result.rows[0]) fail(404, 'Team member not found.');
      const id = result.rows[0].member_user_id;
      if (id && !await resolveCompanyWorkspace(client, id)) await client.query('DELETE FROM public.user_sessions WHERE user_id=$1', [id]);
    });
    res.status(204).end();
  });
  return router;
}
