import { Router } from 'express';
import { z } from 'zod';
import { authenticationRequired, roleRequired } from './auth.js';
import { requireCompanyPermission } from './company-access.js';
import { transaction } from './db.js';
import { fail, validate, validId } from './errors.js';
import { FIRST_SALARY_FEE, milestoneLines, normalizeProjectType, rankDevelopers } from './marketplace.js';
import { groqJson } from './ai/groq.js';

const createSchema = z.object({
  title: z.string().trim().min(3).max(180),
  projectType: z.string().trim().min(3).max(40),
  deliveryMode: z.enum(['solo', 'team']).default('solo'),
  careerPath: z.string().trim().max(120).default(''),
  skills: z.string().trim().max(500).default(''),
  description: z.string().trim().max(5000).default(''),
  functional: z.string().trim().max(5000).default(''),
  technologies: z.string().trim().max(500).default(''),
  difficulty: z.string().trim().max(40).default(''),
  budget: z.number().min(0).max(10000000).optional(),
});

function splitList(value) {
  return [...new Set(String(value || '').split(/[,/\n]/).map(item => item.trim()).filter(Boolean))].slice(0, 12);
}

async function polishBrief(brief) {
  if (!process.env.GROQ_API_KEY) return brief;
  try {
    const result = await groqJson({
      temperature: 0,
      messages: [
        { role: 'system', content: 'Turn a company project form into a short brief. Return JSON {"summary":"","skills":[""],"milestones":["","",""]}. Keep the company\'s meaning. Do not invent a budget.' },
        { role: 'user', content: brief.context_text },
      ],
    });
    return {
      ...brief,
      summary: String(result.summary || brief.summary).slice(0, 5000),
      skills: Array.isArray(result.skills) && result.skills.length ? result.skills.map(skill => String(skill).slice(0, 80)).slice(0, 12) : brief.skills,
      milestones: Array.isArray(result.milestones) && result.milestones.length ? result.milestones.map(item => String(item).slice(0, 180)).slice(0, 6) : brief.milestones,
    };
  } catch {
    return brief;
  }
}

async function loadProject(client, companyId, projectId) {
  if (!validId(projectId)) fail(404, 'Project not found.');
  const { rows } = await client.query('SELECT * FROM company_projects WHERE id=$1 AND company_user_id=$2', [projectId, companyId]);
  if (!rows[0]) fail(404, 'Project not found.');
  return rows[0];
}

async function projectView(client, project) {
  const brief = (await client.query('SELECT * FROM project_briefs WHERE project_id=$1', [project.id])).rows[0] || null;
  const milestones = (await client.query('SELECT * FROM project_milestones WHERE project_id=$1 ORDER BY position', [project.id])).rows;
  const matches = (await client.query(`SELECT m.*, u.first_name, u.last_name, d.career_path, d.skills
    FROM project_matches m JOIN users u ON u.id=m.developer_id JOIN developer_profiles d ON d.user_id=m.developer_id
    WHERE m.project_id=$1 ORDER BY m.rank`, [project.id])).rows;
  const submissions = (await client.query(`SELECT s.* FROM phase_submissions s JOIN project_matches m ON m.id=s.match_id WHERE m.project_id=$1`, [project.id])).rows;
  const hires = (await client.query('SELECT * FROM project_hires WHERE project_id=$1', [project.id])).rows;
  return { project, brief, milestones, matches, submissions, hires };
}

export function createCompanyProjectRouter(pool) {
  const router = Router();
  router.use(authenticationRequired(pool), roleRequired('company'));

  router.get('/', requireCompanyPermission('projects:view'), async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM company_projects WHERE company_user_id=$1 ORDER BY created_at DESC', [req.user.companyAccess.companyId]);
    res.json({ items: rows });
  });

  router.get('/hires', requireCompanyPermission('hiring:manage'), async (req, res) => {
    const { rows } = await pool.query(`SELECT h.*, p.title, u.first_name, u.last_name
      FROM project_hires h JOIN company_projects p ON p.id=h.project_id JOIN users u ON u.id=h.developer_id
      WHERE p.company_user_id=$1 ORDER BY h.created_at DESC`, [req.user.companyAccess.companyId]);
    res.json({ items: rows });
  });

  router.post('/', requireCompanyPermission('projects:manage'), async (req, res) => {
    const data = validate(createSchema, req.body);
    const skills = splitList(data.skills);
    const draft = await polishBrief({
      summary: data.description,
      skills,
      milestones: milestoneLines(data.functional),
      context_text: [data.title, data.description, data.functional, data.technologies].filter(Boolean).join('\n'),
    });
    const created = await transaction(pool, async client => {
      const { rows } = await client.query(`INSERT INTO company_projects(company_user_id,title,project_type,delivery_mode,status,created_by)
        VALUES($1,$2,$3,$4,'ready',$5) RETURNING *`, [req.user.companyAccess.companyId, data.title, normalizeProjectType(data.projectType), data.deliveryMode, req.user.id]);
      await client.query(`INSERT INTO project_briefs(project_id,summary,career_path,skills,stack,difficulty,budget,context_text)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [rows[0].id, draft.summary, data.careerPath, draft.skills, splitList(data.technologies), data.difficulty, data.budget ?? null, draft.context_text]);
      for (let index = 0; index < draft.milestones.length; index += 1) {
        await client.query('INSERT INTO project_milestones(project_id,position,title,description) VALUES($1,$2,$3,$4)', [rows[0].id, index + 1, draft.milestones[index], draft.milestones[index]]);
      }
      return projectView(client, rows[0]);
    });
    res.status(201).json(created);
  });

  router.get('/:id', requireCompanyPermission('projects:view'), async (req, res) => {
    const view = await transaction(pool, async client => projectView(client, await loadProject(client, req.user.companyAccess.companyId, req.params.id)));
    res.json(view);
  });

  router.post('/:id/match', requireCompanyPermission('talent:view'), async (req, res) => {
    const view = await transaction(pool, async client => {
      const project = await loadProject(client, req.user.companyAccess.companyId, req.params.id);
      const brief = (await client.query('SELECT * FROM project_briefs WHERE project_id=$1', [project.id])).rows[0];
      if (!brief) fail(400, 'Add a project brief before matching.');
      const developers = (await client.query(`SELECT u.id, u.first_name, u.last_name, d.career_path, d.skills,
        (SELECT count(*) FROM growth_completions c WHERE c.user_id=u.id) AS completions
        FROM users u JOIN developer_profiles d ON d.user_id=u.id
        JOIN account_verifications v ON v.user_id=u.id AND v.status='verified'
        WHERE u.role='developer' AND u.account_status='active'`)).rows;
      const top = rankDevelopers(brief, developers);
      if (!top.length) fail(409, 'No verified developers are available to match yet.');
      await client.query('DELETE FROM project_matches WHERE project_id=$1 AND status=$2', [project.id, 'proposed']);
      for (let index = 0; index < top.length; index += 1) {
        await client.query(`INSERT INTO project_matches(project_id,developer_id,rank,total_score,breakdown,reasons)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,developer_id) DO UPDATE
          SET rank=EXCLUDED.rank,total_score=EXCLUDED.total_score,breakdown=EXCLUDED.breakdown,reasons=EXCLUDED.reasons`,
        [project.id, top[index].id, index + 1, top[index].total, JSON.stringify(top[index].breakdown), top[index].reasons]);
      }
      await client.query("UPDATE company_projects SET status='matched' WHERE id=$1", [project.id]);
      return projectView(client, { ...project, status: 'matched' });
    });
    res.json(view);
  });

  router.post('/:id/invites', requireCompanyPermission('projects:manage'), async (req, res) => {
    const ids = validate(z.object({ assignmentIds: z.array(z.string().uuid()).max(3).default([]) }), req.body).assignmentIds;
    const view = await transaction(pool, async client => {
      const project = await loadProject(client, req.user.companyAccess.companyId, req.params.id);
      if (ids.length) await client.query("UPDATE project_matches SET status='invited' WHERE project_id=$1 AND status='proposed' AND id = ANY($2::uuid[])", [project.id, ids]);
      else await client.query("UPDATE project_matches SET status='invited' WHERE project_id=$1 AND status='proposed'", [project.id]);
      await client.query("UPDATE company_projects SET status='active' WHERE id=$1", [project.id]);
      return projectView(client, { ...project, status: 'active' });
    });
    res.json(view);
  });

  router.post('/:id/assignments/:assignmentId/eliminate', requireCompanyPermission('projects:manage'), async (req, res) => {
    const view = await transaction(pool, async client => {
      const project = await loadProject(client, req.user.companyAccess.companyId, req.params.id);
      if (project.delivery_mode !== 'solo') fail(400, 'A team project keeps the group together. Solo projects eliminate after a phase.');
      const { rowCount } = await client.query("UPDATE project_matches SET status='eliminated' WHERE id=$1 AND project_id=$2 AND status IN ('invited','accepted')", [req.params.assignmentId, project.id]);
      if (!rowCount) fail(404, 'Match not found.');
      return projectView(client, project);
    });
    res.json(view);
  });

  router.post('/:id/assignments/:assignmentId/feedback', requireCompanyPermission('evaluations:manage'), async (req, res) => {
    const data = validate(z.object({ milestoneId: z.string().uuid(), feedback: z.string().trim().min(2).max(5000), accept: z.boolean().default(false) }), req.body);
    if (!validId(req.params.assignmentId)) fail(404, 'Submission not found.');
    const view = await transaction(pool, async client => {
      const project = await loadProject(client, req.user.companyAccess.companyId, req.params.id);
      const { rowCount } = await client.query(`UPDATE phase_submissions s SET feedback=$3,status=$4,updated_at=NOW()
        FROM project_matches m, project_milestones phase
        WHERE s.match_id=m.id AND s.milestone_id=phase.id AND m.id=$1 AND phase.id=$2
          AND m.project_id=$5 AND phase.project_id=$5`,
      [req.params.assignmentId, data.milestoneId, data.feedback, data.accept ? 'accepted' : 'revision', project.id]);
      if (!rowCount) fail(404, 'Submission not found.');
      return projectView(client, project);
    });
    res.json(view);
  });

  router.post('/:id/hires', requireCompanyPermission('hiring:manage'), async (req, res) => {
    const data = validate(z.object({ developerId: z.string().uuid(), salary: z.number().min(0).max(10000000) }), req.body);
    const view = await transaction(pool, async client => {
      const project = await loadProject(client, req.user.companyAccess.companyId, req.params.id);
      const match = (await client.query("SELECT * FROM project_matches WHERE project_id=$1 AND developer_id=$2 AND status IN ('accepted','selected','invited')", [project.id, data.developerId])).rows[0];
      if (!match) fail(409, 'Hire someone who was matched to this project.');
      const fee = Math.round(data.salary * FIRST_SALARY_FEE) / 100;
      await client.query(`INSERT INTO project_hires(project_id,developer_id,salary,fee_percent,fee_amount) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(project_id,developer_id) DO UPDATE SET salary=EXCLUDED.salary,fee_amount=EXCLUDED.fee_amount`, [project.id, data.developerId, data.salary, FIRST_SALARY_FEE, fee]);
      await client.query("UPDATE project_matches SET status='hired' WHERE id=$1", [match.id]);
      await client.query("UPDATE company_projects SET status='closed' WHERE id=$1", [project.id]);
      return projectView(client, { ...project, status: 'closed' });
    });
    res.json(view);
  });

  return router;
}

export function createEngagementRouter(pool) {
  const router = Router();
  router.use(authenticationRequired(pool), roleRequired('developer'));

  router.get('/', async (req, res) => {
    const items = (await pool.query(`SELECT m.*, p.title, p.delivery_mode, p.project_type, c.company_name
      FROM project_matches m JOIN company_projects p ON p.id=m.project_id JOIN company_profiles c ON c.user_id=p.company_user_id
      WHERE m.developer_id=$1 AND m.status <> 'proposed' ORDER BY m.created_at DESC`, [req.user.id])).rows;
    const projectIds = [...new Set(items.map(item => item.project_id))];
    const milestones = projectIds.length ? (await pool.query('SELECT * FROM project_milestones WHERE project_id = ANY($1::uuid[]) ORDER BY position', [projectIds])).rows : [];
    const submissions = items.length ? (await pool.query('SELECT * FROM phase_submissions WHERE match_id = ANY($1::uuid[])', [items.map(item => item.id)])).rows : [];
    res.json({ items, milestones, submissions });
  });

  router.post('/:id/accept', async (req, res) => {
    const { rowCount } = await pool.query("UPDATE project_matches SET status='accepted' WHERE id=$1 AND developer_id=$2 AND status='invited'", [req.params.id, req.user.id]);
    if (!rowCount) fail(404, 'Invitation not found.');
    res.json({ ok: true });
  });

  router.post('/:id/phases/:milestoneId', async (req, res) => {
    const summary = validate(z.object({ summary: z.string().trim().min(5).max(10000) }), req.body).summary;
    const match = (await pool.query("SELECT * FROM project_matches WHERE id=$1 AND developer_id=$2 AND status IN ('accepted','selected')", [req.params.id, req.user.id])).rows[0];
    if (!match) fail(409, 'Accept the invitation before submitting a phase.');
    const milestone = (await pool.query('SELECT * FROM project_milestones WHERE id=$1 AND project_id=$2', [req.params.milestoneId, match.project_id])).rows[0];
    if (!milestone) fail(404, 'Phase not found.');
    await pool.query(`INSERT INTO phase_submissions(match_id,milestone_id,summary) VALUES($1,$2,$3)
      ON CONFLICT(match_id,milestone_id) DO UPDATE SET summary=EXCLUDED.summary,status='submitted',updated_at=NOW()`, [match.id, milestone.id, summary]);
    res.json({ ok: true });
  });

  return router;
}
