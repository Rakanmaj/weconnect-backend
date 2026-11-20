import { Router } from 'express';
import multer from 'multer';
import { isDeepStrictEqual } from 'node:util';
import { authenticationRequired, roleRequired, userById } from './auth.js';
import { transaction } from './db.js';
import { fail, validId, validate } from './errors.js';
import { careerSchema, companySchema, developerSchema, reviewSchema } from './profile-validation.js';
import { profileOwnerId, requireCompanyPermission, resolveCompanyWorkspace } from './company-access.js';
import { overallLevel } from './growth-grading.js';

function profileAccess(req, res, next) {
  if (req.user.role === 'company') return requireCompanyPermission('company:manage')(req, res, next);
  next();
}
async function checkCompanyWrite(client, user) {
  if (user.role !== 'company') return;
  const context = await resolveCompanyWorkspace(client, user.id, user.companyAccess.companyId);
  if (!context?.companyAccess.permissions.includes('company:manage')) fail(403, 'Your company role does not allow profile or document changes.');
}

const FILE_SELECT = 'id, kind, original_name AS name, mime_type AS "mimeType", byte_size AS size, created_at AS "createdAt"';
export const statusLabels = { draft: 'Draft', pending: 'Pending Verification', verified: 'Verified', 'more-info': 'More Information Required', rejected: 'Rejected' };

export async function lockUser(client, id) {
  await client.query('SELECT id FROM public.users WHERE id=$1 FOR UPDATE', [id]);
}
async function verification(client, id) {
  const { rows } = await client.query('SELECT status, revision, submitted_at AS "submittedAt", reviewed_at AS "reviewedAt", feedback FROM public.account_verifications WHERE user_id=$1', [id]);
  return rows[0] || { status: 'draft', revision: 0, feedback: '', submittedAt: null, reviewedAt: null };
}
export async function invalidateVerification(client, id, actorId = id) {
  const current = await verification(client, id);
  if (current.status !== 'draft') {
    await client.query(`UPDATE public.account_verifications SET status='draft', revision=revision+1, reviewed_at=NULL,
      reviewed_by=NULL, feedback='', snapshot='{}', updated_at=NOW() WHERE user_id=$1`, [id]);
    await client.query(`INSERT INTO public.verification_events(user_id,actor_id,status,feedback) VALUES($1,$2,'draft','Profile or documents changed; a new review is required.')`, [id, actorId]);
  }
}
export async function readProfile(client, user) {
  const ownerId = profileOwnerId(user);
  let profile;
  if (user.role === 'developer') {
    const { rows } = await client.query(`SELECT preferred_position AS "preferredPosition", location, github_url AS github, bio, phone,
      education, skills, years_experience AS "yearsExperience", career_goals AS "careerGoals", linkedin_url AS linkedin,
      portfolio_url AS portfolio, weekly_hours AS "weeklyHours", project_types AS "projectTypes",
      available_from::text AS "availableFrom", career_path AS "careerPath", onboarding_step AS "onboardingStep",
      onboarding_completed_at AS "onboardingCompletedAt" FROM public.developer_profiles WHERE user_id=$1`, [user.id]);
    profile = { ...rows[0], firstName: user.firstName, lastName: user.lastName, availableFrom: rows[0]?.availableFrom || '' };
  } else {
    const { rows } = await client.query(`SELECT company_name AS name, website, industry, company_size AS size, location,
      contact_name AS "contactName", contact_title AS "contactTitle", about, registration_number AS "registrationNumber",
      registration_country AS "registrationCountry" FROM public.company_profiles WHERE user_id=$1`, [ownerId]);
    profile = rows[0];
  }
  const files = (await client.query(`SELECT ${FILE_SELECT} FROM public.profile_files WHERE user_id=$1 ORDER BY created_at`, [ownerId])).rows;
  const history = (await client.query(`SELECT status, feedback, created_at AS "createdAt" FROM public.verification_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [ownerId])).rows;
  return { user, profile, files, verification: await verification(client, ownerId), history, ...(user.role === 'company' ? { ownerEmail: user.companyAccess.ownerEmail } : {}) };
}

export function createProfileRouter(pool) {
  const router = Router();
  router.use(authenticationRequired(pool));
  router.use(profileAccess);
  router.use((req, _res, next) => { if (!['developer', 'company'].includes(req.user.role)) fail(403, 'Use the account review area.'); next(); });
  router.get('/', async (req, res) => res.json(await readProfile(pool, req.user)));
  router.put('/', async (req, res) => {
    const data = validate(req.user.role === 'developer' ? developerSchema : companySchema, req.body);
    const result = await transaction(pool, async client => {
      const ownerId = profileOwnerId(req.user);
      await lockUser(client, ownerId);
      await checkCompanyWrite(client, req.user);
      const previous = await readProfile(client, await userById(client, req.user.id, ownerId));
      // Navigating onboarding steps alone does not revoke an approved profile.
      const changed = Object.entries(data).some(([key, value]) => key !== 'onboardingStep' && !isDeepStrictEqual(value, previous.profile[key]));
      if (req.user.role === 'developer') {
        await client.query('UPDATE public.users SET first_name=$2,last_name=$3,updated_at=NOW() WHERE id=$1', [req.user.id, data.firstName, data.lastName]);
        await client.query(`UPDATE public.developer_profiles SET preferred_position=$2,location=$3,github_url=$4,bio=$5,phone=$6,
          education=$7::jsonb,skills=$8,years_experience=$9,career_goals=$10,linkedin_url=$11,portfolio_url=$12,weekly_hours=$13,
          project_types=$14,available_from=$15,onboarding_step=$16,updated_at=NOW() WHERE user_id=$1`,
        [req.user.id, data.preferredPosition, data.location, data.github, data.bio, data.phone, JSON.stringify(data.education), data.skills,
          data.yearsExperience, data.careerGoals, data.linkedin, data.portfolio, data.weeklyHours, data.projectTypes, data.availableFrom || null, data.onboardingStep]);
      } else {
        const [first, ...last] = data.contactName.split(/\s+/);
        await client.query('UPDATE public.users SET first_name=$2,last_name=$3,updated_at=NOW() WHERE id=$1', [ownerId, first, last.join(' ')]);
        await client.query(`UPDATE public.company_profiles SET company_name=$2,website=$3,industry=$4,company_size=$5,location=$6,
          contact_name=$7,contact_title=$8,about=$9,registration_number=$10,registration_country=$11,updated_at=NOW() WHERE user_id=$1`,
        [ownerId, data.name, data.website, data.industry, data.size, data.location, data.contactName, data.contactTitle, data.about, data.registrationNumber, data.registrationCountry]);
      }
      if (changed) await invalidateVerification(client, ownerId, req.user.id);
      return readProfile(client, await userById(client, req.user.id, ownerId));
    });
    res.json(result);
  });
  router.put('/career-path', roleRequired('developer'), async (req, res) => {
    const { careerPath } = validate(careerSchema, req.body);
    await transaction(pool, async client => {
      await lockUser(client, req.user.id);
      if ((await verification(client, req.user.id)).status !== 'verified') fail(403, 'Your account must be approved before you choose an assessment career path.');
      await client.query('UPDATE public.developer_profiles SET career_path=$2,updated_at=NOW() WHERE user_id=$1', [req.user.id, careerPath]);
    });
    res.json({ careerPath });
  });
  router.post('/submit', async (req, res) => {
    const result = await transaction(pool, async client => {
      const ownerId = profileOwnerId(req.user);
      await lockUser(client, ownerId);
      await checkCompanyWrite(client, req.user);
      const freshUser = await userById(client, ownerId);
      const data = await readProfile(client, freshUser);
      if (!freshUser.emailVerified) fail(400, 'Verify your email address before submitting for account review.');
      if (data.verification.status === 'pending') fail(409, 'Your profile is already awaiting review.');
      if (data.verification.status === 'verified') fail(409, 'Your account is already approved.');
      if (req.user.role === 'developer') {
        if (!data.profile.preferredPosition || !data.profile.location || !data.profile.skills.length) fail(400, 'Complete your preferred position, location, and skills first.');
        if (!data.files.some(file => file.kind === 'cv')) fail(400, 'Upload your CV before submitting.');
        await client.query('UPDATE public.developer_profiles SET onboarding_step=9,onboarding_completed_at=NOW() WHERE user_id=$1', [req.user.id]);
      } else {
        if (!data.profile.registrationNumber || !data.profile.registrationCountry) fail(400, 'Enter your business registration number and country in Company Profile.');
        if (!data.files.some(file => file.kind === 'registration')) fail(400, 'Upload a business registration document first.');
      }
      await client.query(`INSERT INTO public.account_verifications(user_id,status,revision,submitted_at,snapshot)
        VALUES($1,'pending',1,NOW(),$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET status='pending',revision=account_verifications.revision+1,
        submitted_at=NOW(),reviewed_at=NULL,reviewed_by=NULL,feedback='',snapshot=$2::jsonb,updated_at=NOW()`,
      [ownerId, JSON.stringify({ profile: data.profile, files: data.files, email: freshUser.email })]);
      await client.query(`INSERT INTO public.verification_events(user_id,actor_id,status) VALUES($1,$2,'pending')`, [ownerId, req.user.id]);
      return readProfile(client, await userById(client, req.user.id, ownerId));
    });
    res.json(result);
  });
  return router;
}

function detectType(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-' && buffer.includes(Buffer.from('%%EOF'))) return 'application/pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.includes(Buffer.from('IEND'))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 && buffer[buffer.length - 2] === 255 && buffer[buffer.length - 1] === 217) return 'image/jpeg';
  return null;
}
export function createFileRouter(pool) {
  const router = Router();
  router.use(authenticationRequired(pool));
  router.use(profileAccess);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 } });
  router.post('/:kind', (req, _res, next) => {
    const allowed = req.user.role === 'developer' ? ['cv','certificate','identity','avatar'] : req.user.role === 'company' ? ['registration','avatar'] : [];
    if (!allowed.includes(req.params.kind)) fail(400, 'This document type is not allowed for your account.');
    next();
  }, upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file?.size) fail(400, 'Choose a file to upload.');
    const mime = detectType(file.buffer);
    if (!mime || mime !== file.mimetype) fail(400, 'Upload a valid PDF, PNG, or JPEG file.');
    if (req.params.kind === 'cv' && (mime !== 'application/pdf' || file.size > 5 * 1024 * 1024)) fail(400, 'CVs must be PDFs no larger than 5 MB.');
    if (req.params.kind === 'avatar' && (mime === 'application/pdf' || file.size > 2 * 1024 * 1024)) fail(400, 'Profile photos must be PNG or JPEG no larger than 2 MB.');
    const extension = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg';
    const name = file.originalname.replace(/\\/g, '/').split('/').pop().replace(/[^\p{L}\p{N}_. -]/gu, '_').slice(0, 170).replace(/\.[^.]*$/, '') + extension;
    const saved = await transaction(pool, async client => {
      const ownerId = profileOwnerId(req.user);
      await lockUser(client, ownerId);
      await checkCompanyWrite(client, req.user);
      const { rows } = await client.query('SELECT count(*)::int AS count,coalesce(sum(byte_size),0)::int AS bytes FROM public.profile_files WHERE user_id=$1', [ownerId]);
      if (rows[0].count >= 10 || rows[0].bytes + file.size > 50 * 1024 * 1024) fail(400, 'You can store up to 10 files and 50 MB. Remove an old file first.');
      if (['cv','avatar'].includes(req.params.kind)) await client.query('DELETE FROM public.profile_files WHERE user_id=$1 AND kind=$2', [ownerId, req.params.kind]);
      const inserted = await client.query(`INSERT INTO public.profile_files(user_id,kind,original_name,mime_type,byte_size,content)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING ${FILE_SELECT}`, [ownerId, req.params.kind, name, mime, file.size, file.buffer]);
      if (req.params.kind !== 'avatar') await invalidateVerification(client, ownerId, req.user.id);
      return inserted.rows[0];
    });
    res.status(201).json({ file: saved });
  });
  async function access(req) {
    if (!validId(req.params.id)) fail(404, 'File not found.');
    const { rows } = await pool.query('SELECT * FROM public.profile_files WHERE id=$1 AND (user_id=$2 OR $3::boolean)', [req.params.id, profileOwnerId(req.user), req.user.role === 'admin']);
    if (!rows[0]) fail(404, 'File not found.');
    return rows[0];
  }
  router.get('/:id', async (req, res) => {
    const file = await access(req);
    res.type(file.mime_type).attachment(file.original_name);
    if (file.kind === 'avatar' && req.query.view === 'photo') res.set('Content-Disposition', 'inline');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(Buffer.from(file.content));
  });
  router.delete('/:id', async (req, res) => {
    await transaction(pool, async client => {
      const ownerId = profileOwnerId(req.user);
      await lockUser(client, ownerId);
      await checkCompanyWrite(client, req.user);
      const file = await client.query('DELETE FROM public.profile_files WHERE id=$1 AND user_id=$2 RETURNING kind', [validId(req.params.id) ? req.params.id : null, ownerId]);
      if (!file.rows[0]) fail(404, 'File not found.');
      if (file.rows[0].kind !== 'avatar') await invalidateVerification(client, ownerId, req.user.id);
    });
    res.status(204).end();
  });
  return router;
}

export function createReviewRouter(pool) {
  const router = Router();
  router.use(authenticationRequired(pool), roleRequired('admin'));
  router.get('/', async (req, res) => {
    const role = req.query.role === 'company' ? 'company' : 'developer';
    const { rows } = await pool.query(`SELECT u.id,u.role,u.email,u.first_name AS "firstName",u.last_name AS "lastName",
      coalesce(c.company_name,concat(u.first_name,' ',u.last_name)) AS name,
      coalesce(c.location,d.location) AS location,coalesce(c.industry,d.preferred_position) AS description,
      v.status,v.revision,v.submitted_at AS "submittedAt",
      (SELECT count(*)::int FROM public.profile_files f WHERE f.user_id=u.id) AS documents
      FROM public.account_verifications v JOIN public.users u ON u.id=v.user_id
      LEFT JOIN public.company_profiles c ON c.user_id=u.id LEFT JOIN public.developer_profiles d ON d.user_id=u.id
      WHERE u.role=$1 AND v.status<>'draft' ORDER BY v.submitted_at DESC LIMIT 500`, [role]);
    res.json({ items: rows });
  });
  router.get('/:id', async (req, res) => {
    if (!validId(req.params.id)) fail(404, 'Account not found.');
    const account = await pool.query("SELECT id FROM public.users WHERE id=$1 AND role IN ('developer','company')", [req.params.id]);
    if (!account.rows[0]) fail(404, 'Account not found.');
    res.json(await readProfile(pool, await userById(pool, req.params.id)));
  });
  router.post('/:id', async (req, res) => {
    if (!validId(req.params.id)) fail(404, 'Account not found.');
    const data = validate(reviewSchema, req.body);
    const result = await transaction(pool, async client => {
      await lockUser(client, req.params.id);
      const current = await verification(client, req.params.id);
      if (current.status !== 'pending' || current.revision !== data.revision) fail(409, 'This submission changed or was already reviewed. Refresh before reviewing again.');
      await client.query(`UPDATE public.account_verifications SET status=$2,feedback=$3,revision=revision+1,reviewed_by=$4,
        reviewed_at=NOW(),updated_at=NOW() WHERE user_id=$1`, [req.params.id, data.status, data.feedback, req.user.id]);
      await client.query('INSERT INTO public.verification_events(user_id,actor_id,status,feedback) VALUES($1,$2,$3,$4)', [req.params.id, req.user.id, data.status, data.feedback]);
      return verification(client, req.params.id);
    });
    res.json({ verification: result });
  });
  return router;
}

export function createAdminDevelopersRouter(pool) {
  const router = Router();
  router.use(authenticationRequired(pool), roleRequired('admin'));
  router.get('/', async (_req, res) => {
    const { rows } = await pool.query(`SELECT u.id, u.email,
      trim(concat(u.first_name, ' ', u.last_name)) AS name,
      coalesce(nullif(trim(d.preferred_position), ''), nullif(trim(d.career_path), ''), 'Not set') AS role,
      coalesce(nullif(trim(d.location), ''), '—') AS location,
      coalesce(v.status, 'draft') AS status,
      u.email_verified_at IS NOT NULL AS "emailVerified",
      (SELECT count(*)::int FROM growth_completions gc JOIN growth_activities ga ON ga.id = gc.activity_id
        WHERE gc.user_id = u.id AND ga.kind = 'challenge') AS "challengesPassed",
      (SELECT max(t.score) FROM growth_attempts t JOIN growth_activities a ON a.id = t.activity_id
        WHERE t.user_id = u.id AND a.kind = 'assessment' AND t.status = 'passed') AS "bestAssessmentScore"
      FROM public.users u
      LEFT JOIN public.developer_profiles d ON d.user_id = u.id
      LEFT JOIN public.account_verifications v ON v.user_id = u.id
      WHERE u.role = 'developer' AND u.account_status = 'active'
      ORDER BY u.created_at DESC LIMIT 1000`);
    res.json({
      items: rows.map(row => ({
        ...row,
        overallLevel: row.bestAssessmentScore == null ? null : overallLevel(Number(row.bestAssessmentScore)),
      })),
      total: rows.length,
    });
  });
  return router;
}
