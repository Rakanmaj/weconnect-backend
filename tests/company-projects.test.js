import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/passwords.js';
import { testDatabase } from './helpers/database.js';

const origin = 'http://localhost:3000';
const password = 'CompanyAccessTest2026!';
const config = { webOrigins: [origin], secureCookies: false, sessionDays: 7, authLimit: 1000, production: false };
let fixture, app, companyA, companyB, evaluator, recruiter, developer;
let projectA, projectB, secondProjectA, phaseA, phaseB, secondPhaseA, matchA, matchB;
const feedback = (agent, projectId, matchId, phaseId, accept = true) => agent.post(`/api/company/projects/${projectId}/assignments/${matchId}/feedback`)
  .set('Origin', origin).send({ milestoneId: phaseId, feedback: 'Reviewed this submission.', accept });
const submission = async (match, phase) => (await fixture.pool.query('SELECT feedback,status FROM phase_submissions WHERE match_id=$1 AND milestone_id=$2', [match, phase])).rows[0];

before(async () => {
  fixture = await testDatabase();
  await fixture.db.exec(await readFile(new URL('../database/003_developer_growth.sql', import.meta.url), 'utf8'));
  await fixture.db.exec(await readFile(new URL('../database/008_company_marketplace.sql', import.meta.url), 'utf8'));
  app = createApp({ pool: fixture.pool, config, sendMail: async () => {}, logger: { error() {} } });
  const passwordHash = await hashPassword(password);
  async function account(label, role, teamRole, owner) {
    const email = `${label}@company-access.example.test`;
    const userId = (await fixture.pool.query('INSERT INTO users(role,email,password_hash,first_name) VALUES($1,$2,$3,$4) RETURNING id', [role, email, passwordHash, label])).rows[0].id;
    if (role === 'developer') await fixture.pool.query('INSERT INTO developer_profiles(user_id) VALUES($1)', [userId]);
    else if (owner) await fixture.pool.query("INSERT INTO company_team_members(company_id,member_user_id,name,email,team_role,status,joined_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [owner, userId, label, email, teamRole]);
    else await fixture.pool.query("INSERT INTO company_profiles(user_id,company_name,website,industry,company_size,location,contact_name,contact_title) VALUES($1,$2,'https://example.test','Technology','1-10','Amman','Owner','Owner')", [userId, label]);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('Origin', origin).send({ email, password, role }).expect(200);
    return { id: userId, agent };
  }
  companyA = await account('owner-a', 'company');
  companyB = await account('owner-b', 'company');
  evaluator = await account('evaluator-a', 'company', 'Evaluator', companyA.id);
  recruiter = await account('recruiter-a', 'company', 'Recruiter', companyA.id);
  developer = await account('developer', 'developer');
  async function project(owner, title) {
    const id = (await fixture.pool.query("INSERT INTO company_projects(company_user_id,title,project_type,created_by) VALUES($1,$2,'training',$1) RETURNING id", [owner, title])).rows[0].id;
    const phase = (await fixture.pool.query("INSERT INTO project_milestones(project_id,position,title) VALUES($1,1,'Phase one') RETURNING id", [id])).rows[0].id;
    return { id, phase };
  }
  ({ id: projectA, phase: phaseA } = await project(companyA.id, 'A project'));
  ({ id: projectB, phase: phaseB } = await project(companyB.id, 'B project'));
  ({ id: secondProjectA, phase: secondPhaseA } = await project(companyA.id, 'Another A project'));
  async function match(projectId, phase) {
    const id = (await fixture.pool.query("INSERT INTO project_matches(project_id,developer_id,rank,total_score,status) VALUES($1,$2,1,90,'accepted') RETURNING id", [projectId, developer.id])).rows[0].id;
    await fixture.pool.query("INSERT INTO phase_submissions(match_id,milestone_id,summary) VALUES($1,$2,'Submitted evidence')", [id, phase]);
    return id;
  }
  matchA = await match(projectA, phaseA);
  matchB = await match(projectB, phaseB);
  // Legacy inconsistent rows are possible with the separate foreign keys.
  // The endpoint must refuse them rather than treating them as owned submissions.
  await fixture.pool.query("INSERT INTO phase_submissions(match_id,milestone_id,summary) VALUES($1,$2,'Mismatched project evidence'),($1,$3,'Mismatched phase evidence')", [matchA, phaseB, secondPhaseA]);
});

after(async () => { await fixture?.pool.end(); });

test('feedback requires authentication and a company evaluation role', async () => {
  await feedback(request(app), projectA, matchA, phaseA).expect(401);
  await feedback(developer.agent, projectA, matchA, phaseA).expect(403);
  await feedback(recruiter.agent, projectA, matchA, phaseA).expect(403);
  assert.deepEqual(await submission(matchA, phaseA), { feedback: '', status: 'submitted' });
});

test('an owned project URL cannot authorize writes to another company match and phase', async () => {
  const before = await submission(matchB, phaseB);
  await feedback(companyA.agent, projectA, matchB, phaseB).expect(404);
  assert.deepEqual(await submission(matchB, phaseB), before);
});

test('an owned match cannot authorize a phase from another company', async () => {
  const before = await submission(matchA, phaseB);
  await feedback(companyA.agent, projectA, matchA, phaseB).expect(404);
  assert.deepEqual(await submission(matchA, phaseB), before);
});

test('match and phase must belong to the exact URL project even within one company', async () => {
  const before = await submission(matchA, secondPhaseA);
  await feedback(companyA.agent, projectA, matchA, secondPhaseA).expect(404);
  await feedback(companyA.agent, secondProjectA, matchA, secondPhaseA).expect(404);
  assert.deepEqual(await submission(matchA, secondPhaseA), before);
});

test('foreign project URLs remain private and cannot modify submissions', async () => {
  const before = await submission(matchB, phaseB);
  await feedback(companyA.agent, projectB, matchB, phaseB).expect(404);
  await feedback(evaluator.agent, projectB, matchB, phaseB).expect(404);
  assert.deepEqual(await submission(matchB, phaseB), before);
});

test('owner and evaluator can review a submission in their actual workspace', async () => {
  const accepted = await feedback(companyA.agent, projectA, matchA, phaseA).expect(200);
  assert.equal(accepted.body.project.id, projectA);
  assert.deepEqual(await submission(matchA, phaseA), { feedback: 'Reviewed this submission.', status: 'accepted' });
  await feedback(evaluator.agent, projectA, matchA, phaseA, false).expect(200);
  assert.equal((await submission(matchA, phaseA)).status, 'revision');
  await feedback(companyB.agent, projectB, matchB, phaseB).expect(200);
});

test('invalid assignment IDs return a private not-found response', async () => {
  await feedback(companyA.agent, projectA, 'invalid-id', phaseA).expect(404);
});

test('revoked evaluators immediately lose submission review access', async () => {
  await fixture.pool.query("UPDATE company_team_members SET status='revoked' WHERE company_id=$1 AND member_user_id=$2", [companyA.id, evaluator.id]);
  const before = await submission(matchA, phaseA);
  await feedback(evaluator.agent, projectA, matchA, phaseA).expect(403);
  assert.deepEqual(await submission(matchA, phaseA), before);
});
