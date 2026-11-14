import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { authenticationRequired, roleRequired } from './auth.js';
import { transaction } from './db.js';
import { fail, validate, validId } from './errors.js';
import { checkJavaScript, runJavaScript, objectiveGrade, overallLevel } from './growth-grading.js';

const paths = ['Frontend Developer', 'Backend Developer', 'Full-Stack Developer'];
const question = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), type: z.enum(['mcq','code','written']),
  prompt: z.string().trim().min(5).max(5000), points: z.number().int().min(1).max(100),
  options: z.array(z.string().trim().min(1).max(500)).max(8).default([]), correctAnswer: z.string().max(500).default(''),
  starterCode: z.string().max(10000).default(''), rubric: z.string().max(3000).default(''),
  tests: z.array(z.object({ name: z.string().min(1).max(120), input: z.string().max(2000), output: z.string().max(2000) })).max(5).default([]) });
const contentSchema = z.object({ kind: z.enum(['assessment','challenge','project']), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  skillId: z.string().uuid().nullable().default(null), position: z.number().int().min(1).max(1000).default(1),
  title: z.string().trim().min(3).max(180), description: z.string().max(10000).default(''),
  careerPaths: z.array(z.enum(paths)).min(1).max(3), durationMinutes: z.number().int().min(5).max(240).default(60),
  passScore: z.number().int().min(1).max(100).default(70), requirements: z.string().max(15000).default(''),
  questions: z.array(question).max(40).default([]), baseVersion: z.number().int().positive().optional() });
const skillSchema = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), name: z.string().trim().min(2).max(120),
  description: z.string().max(3000).default(''), careerPaths: z.array(z.enum(paths)).min(1).max(3),
  status: z.enum(['draft','published','archived']).default('draft'), level2Threshold: z.number().int().min(1).max(30).default(3),
  masterThreshold: z.number().int().min(1).max(100).default(10) });
const url = z.union([z.literal(''), z.url().max(2048).refine(value => ['http:','https:'].includes(new URL(value).protocol), 'Use an HTTP or HTTPS URL.')]);
const answerSchema = z.object({ revision: z.number().int().nonnegative(), answers: z.array(z.object({ questionId: z.string().max(80), answer: z.string().max(30000), flagged: z.boolean().default(false) })).max(40).default([]),
  project: z.object({ repositoryUrl: url, demoUrl: url, summary: z.string().max(10000) }).optional() });
const selectContent = `SELECT a.*,v.title,v.description,v.career_paths,v.duration_minutes,v.pass_score,v.questions,v.requirements,v.status AS content_status,v.version AS content_version
  FROM growth_activities a JOIN growth_activity_versions v ON v.activity_id=a.id`;
const attemptSelect = `SELECT t.*,a.kind,a.skill_id,a.slug,a.position,(SELECT s.slug FROM growth_skills s WHERE s.id=a.skill_id) AS skill_slug,v.title,v.description,v.questions,v.requirements,v.career_paths,v.duration_minutes,v.pass_score
  FROM growth_attempts t JOIN growth_activities a ON a.id=t.activity_id
  JOIN growth_activity_versions v ON v.activity_id=t.activity_id AND v.version=t.version`;

function publicQuestions(questions) {
  return questions.map(({ correctAnswer: _answer, rubric: _rubric, ...q }) => q);
}
function displayContent(row, admin = false) {
  return { ...row, questionCount:row.questions.length, questions: admin ? row.questions : [], version: row.content_version };
}
async function profile(client, userId) {
  const { rows } = await client.query('SELECT d.career_path,v.status FROM developer_profiles d LEFT JOIN account_verifications v ON v.user_id=d.user_id WHERE d.user_id=$1', [userId]);
  return rows[0] || {};
}
async function ready(client, userId) {
  const p = await profile(client, userId);
  if (p.status !== 'verified') fail(403, 'Account approval is required. Open Verification to view your status.');
  if (!p.career_path) fail(403, 'Choose and confirm your career path first.');
  return p.career_path;
}
async function passedAssessment(client, userId, path) {
  const { rows } = await client.query(`${attemptSelect} WHERE t.user_id=$1 AND a.kind='assessment' AND t.status='passed' AND $2=ANY(v.career_paths)`, [userId,path]);
  return rows.length > 0;
}
async function content(client, key, admin = false) {
  const { rows } = await client.query(`${selectContent} WHERE (a.id::text=$1 OR a.slug=$1) AND v.version=${admin ? '(SELECT MAX(v2.version) FROM growth_activity_versions v2 WHERE v2.activity_id=a.id)' : 'a.published_version'}`, [key]);
  if (!rows[0]) fail(404, 'This activity is not available.');
  return rows[0];
}
async function eligible(client, userId, item) {
  const path = await ready(client,userId);
  if (!item.career_paths.includes(path)) fail(403, 'This activity belongs to another career path.');
  if (item.kind !== 'assessment' && !await passedAssessment(client,userId,path)) fail(403, 'Pass your career-path assessment before starting this activity.');
  if (item.kind === 'challenge') {
    const { rows } = await client.query('SELECT * FROM growth_skills WHERE id=$1 AND status=\'published\'', [item.skill_id]);
    if (!rows[0] || !rows[0].career_paths.includes(path)) fail(403, 'This skill is not available for your career path.');
    const previous = await client.query(`SELECT a.id FROM growth_activities a WHERE a.kind='challenge' AND a.skill_id=$1 AND a.position<$2 AND a.published_version IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM growth_completions c WHERE c.activity_id=a.id AND c.user_id=$3)`, [item.skill_id,item.position,userId]);
    if (previous.rows.length) fail(403, 'Complete the earlier challenges in this skill path first.');
  }
}
async function getAttempt(client, id, user, lock = false) {
  if (!validId(id)) fail(404, 'Attempt not found.');
  const { rows } = await client.query(`${attemptSelect} WHERE t.id=$1 ${user.role === 'admin' ? '' : 'AND t.user_id=$2'}${lock ? ' FOR UPDATE OF t' : ''}`, user.role === 'admin' ? [id] : [id,user.id]);
  if (!rows[0]) fail(404, 'Attempt not found.');
  return rows[0];
}
async function answersFor(client, id) {
  return (await client.query('SELECT question_id,answer,flagged FROM growth_answers WHERE attempt_id=$1 ORDER BY question_id',[id])).rows;
}
async function credit(client, attempt, score, feedback, actorId = null) {
  const status = score >= attempt.pass_score ? 'passed' : 'failed';
  await client.query('UPDATE growth_attempts SET status=$2,score=$3,feedback=$4,reviewed_by=$5,reviewed_at=NOW() WHERE id=$1', [attempt.id,status,score,feedback,actorId]);
  if (status === 'passed') await client.query('INSERT INTO growth_completions(user_id,activity_id,attempt_id) VALUES($1,$2,$3) ON CONFLICT(user_id,activity_id) DO NOTHING', [attempt.user_id,attempt.activity_id,attempt.id]);
  return { ...attempt,status,score,feedback,reviewed_by:actorId };
}
async function submit(client, attempt, forceReview = false) {
  if (attempt.status !== 'active') return attempt;
  const answers = await answersFor(client,attempt.id);
  const grade = objectiveGrade(attempt.questions,Object.fromEntries(answers.map(a=>[a.question_id,a.answer])));
  const expired = Boolean(attempt.deadline_at && new Date(attempt.deadline_at).getTime() <= Date.now());
  const pending = forceReview || attempt.kind === 'project' || grade.needsReview;
  await client.query('UPDATE growth_attempts SET status=$2,submitted_at=NOW(),expired=$3,objective_score=$4 WHERE id=$1', [attempt.id,pending?'pending-review':'failed',expired,grade.score]);
  await client.query("INSERT INTO growth_review_events(attempt_id,actor_id,action,details) VALUES($1,$2,'submitted',$3)",[attempt.id,attempt.user_id,JSON.stringify({expired,objectiveScore:grade.score})]);
  const updated = { ...attempt, expired, objective_score:grade.score, status:pending?'pending-review':'failed' };
  return pending ? updated : credit(client,updated,grade.score,'Automatically scored multiple-choice answers.');
}
async function stopExam(client,attempt,reason,actorId){
  if(attempt.status!=='active')return attempt;
  await client.query('UPDATE growth_attempts SET security_stopped_at=NOW(),security_stop_reason=$2 WHERE id=$1',[attempt.id,reason]);
  await client.query("INSERT INTO growth_review_events(attempt_id,actor_id,action,details) VALUES($1,$2,'security-stopped',$3)",[attempt.id,actorId,JSON.stringify({reason})]);
  // Even MCQ-only exams require a human decision after a security stop; no auto credit.
  return submit(client,attempt,true);
}
async function attemptResponse(client, attempt, admin = false) {
  if (attempt.status === 'active' && attempt.deadline_at && new Date(attempt.deadline_at).getTime() <= Date.now()) attempt = await submit(client,attempt);
  const answers = await answersFor(client,attempt.id);
  const files = (await client.query('SELECT id,original_name,byte_size,created_at FROM growth_artifacts WHERE attempt_id=$1 ORDER BY created_at',[attempt.id])).rows;
  const project = (await client.query('SELECT repository_url,demo_url,summary FROM growth_project_submissions WHERE attempt_id=$1',[attempt.id])).rows[0] || null;
  const review = (await client.query("SELECT details FROM growth_review_events WHERE attempt_id=$1 AND action='reviewed' ORDER BY created_at DESC LIMIT 1",[attempt.id])).rows[0]?.details || null;
  const codeChecks=(await client.query('SELECT question_id,source_hash,result,created_at FROM growth_code_checks WHERE attempt_id=$1 ORDER BY created_at DESC LIMIT 20',[attempt.id])).rows.map(c=>({...c,matchesSavedAnswer:c.source_hash===createHash('sha256').update(answers.find(a=>a.question_id===c.question_id)?.answer||'').digest('hex')}));
  const securityEvents=(await client.query('SELECT kind,counted,details,created_at FROM growth_security_events WHERE attempt_id=$1 ORDER BY created_at DESC LIMIT 100',[attempt.id])).rows;
  return { ...attempt, score:attempt.score===null?null:Number(attempt.score), objective_score:attempt.objective_score===null?null:Number(attempt.objective_score), questions:admin?attempt.questions:publicQuestions(attempt.questions), answers, files, project, review, codeChecks, securityEvents,
    serverNow:new Date().toISOString(), level:attempt.kind==='assessment' && attempt.score!==null ? overallLevel(Number(attempt.score)) : null };
}
function writable(attempt) {
  if (attempt.status!=='active') fail(409,'This submission is already locked.');
  if (attempt.deadline_at && new Date(attempt.deadline_at).getTime()<=Date.now()) fail(409,'Time has ended. Open the result to view your saved submission.');
}
function validateQuestions(data, publishing = false) {
  if (data.kind==='challenge' && !data.skillId) fail(400,'Choose a skill for this challenge.');
  if (data.kind==='project' && data.questions.length) fail(400,'Internal projects use requirements and submission evidence, not assessment questions.');
  if (publishing && data.kind!=='project' && !data.questions.length) fail(400,'Add at least one question before publishing.');
  if (publishing && data.kind==='project' && data.requirements.trim().length<10) fail(400,'Add the project requirements before publishing.');
  if (new Set(data.questions.map(q=>q.id)).size!==data.questions.length) fail(400,'Question IDs must be unique.');
  for (const q of data.questions) {
    if (q.type==='mcq' && (q.options.length<2 || new Set(q.options).size!==q.options.length || !q.options.includes(q.correctAnswer))) fail(400,'Each multiple-choice question needs distinct options and a correct option.');
    if (publishing && q.type!=='mcq' && !q.rubric.trim()) fail(400,'Add a grading rubric for each written or coding question.');
  }
}
async function writeVersion(client, id, version, data, actor) {
  await client.query(`INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,version,data.title,data.description,data.careerPaths,data.durationMinutes,data.passScore,JSON.stringify(data.questions),data.requirements,actor]);
}

export function createGrowthRouter(pool, config) {
  const router = Router();
  router.use(authenticationRequired(pool),roleRequired('developer'));
  router.get('/overview',async(req,res)=>{
    const result = await transaction(pool,async client=>{
      const active=(await client.query('SELECT id FROM growth_attempts WHERE user_id=$1 AND status=\'active\' AND deadline_at<=NOW()',[req.user.id])).rows;
      for(const row of active) await submit(client,await getAttempt(client,row.id,req.user,true));
      const p=await profile(client,req.user.id);
      const history=(await client.query(`${attemptSelect} WHERE t.user_id=$1 ORDER BY t.started_at DESC`,[req.user.id])).rows.map(({questions:_q,...row})=>row);
      const scored=history.filter(a=>a.kind==='assessment' && a.status==='passed' && a.career_paths.includes(p.career_path));
      const best=scored.length?Math.max(...scored.map(a=>Number(a.score))):null;
      const completions=(await client.query('SELECT a.kind,count(*)::int AS count FROM growth_completions c JOIN growth_activities a ON a.id=c.activity_id WHERE c.user_id=$1 GROUP BY a.kind',[req.user.id])).rows;
      return { careerPath:p.career_path||'', approved:p.status==='verified', assessmentPassed:best!==null, level:best===null?null:overallLevel(best), bestScore:best, history,completions,aiEnabled:false,runnerConfigured:config.runnerMode!=='disabled' };
    });res.json(result);
  });
  router.get('/catalog',async(req,res)=>{
    const kind=z.enum(['assessment','challenge','project']).safeParse(req.query.kind);
    if(!kind.success) fail(400,'Choose an activity type.');
    const p=await profile(pool,req.user.id);
    const {rows}=await pool.query(`${selectContent} WHERE a.kind=$1 AND v.version=a.published_version AND $2=ANY(v.career_paths) ORDER BY a.position,v.title`,[kind.data,p.career_path||'']);
    res.json({items:rows.map(row=>displayContent(row)),careerPath:p.career_path||''});
  });
  router.get('/skills',async(req,res)=>{
    const p=await profile(pool,req.user.id);
    const {rows}=await pool.query(`SELECT s.*, (SELECT count(*)::int FROM growth_completions c JOIN growth_activities a ON a.id=c.activity_id WHERE c.user_id=$1 AND a.skill_id=s.id AND a.kind='challenge') AS completed,
      (SELECT count(*)::int FROM growth_activities a WHERE a.skill_id=s.id AND a.kind='challenge' AND a.published_version IS NOT NULL) AS total
      FROM growth_skills s WHERE s.status='published' AND $2=ANY(s.career_paths) ORDER BY s.name`,[req.user.id,p.career_path||'']);
    res.json({items:rows.map(s=>({...s,level:s.completed>=s.master_threshold?'Master':s.completed>=s.level2_threshold?'Level 2':'Level 1'}))});
  });
  router.get('/activities/:id',async(req,res)=>res.json({item:displayContent(await content(pool,req.params.id))}));
  router.post('/activities/:id/start',async(req,res)=>{
    const result=await transaction(pool,async client=>{
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      const item=await content(client,req.params.id);
      await eligible(client,req.user.id,item);
      const existing=(await client.query('SELECT id FROM growth_attempts WHERE user_id=$1 AND activity_id=$2 AND status=\'active\'',[req.user.id,item.id])).rows[0];
      if(existing) return attemptResponse(client,await getAttempt(client,existing.id,req.user,true));
      const pending=(await client.query('SELECT id FROM growth_attempts WHERE user_id=$1 AND activity_id=$2 AND status=\'pending-review\'',[req.user.id,item.id])).rows[0];
      if(pending) return attemptResponse(client,await getAttempt(client,pending.id,req.user));
      if(item.kind==='assessment') {
        const recent=await client.query('SELECT id FROM growth_attempts WHERE user_id=$1 AND activity_id=$2 AND submitted_at>NOW()-INTERVAL \'24 hours\'',[req.user.id,item.id]);
        if(recent.rows.length) fail(409,'Assessment retakes are available 24 hours after your previous submission. Your history remains available.');
      }
      const deadline=item.kind==='project'?null:new Date(Date.now()+item.duration_minutes*60000);
      const {rows}=await client.query('INSERT INTO growth_attempts(user_id,activity_id,version,deadline_at) VALUES($1,$2,$3,$4) RETURNING id',[req.user.id,item.id,item.content_version,deadline]);
      return attemptResponse(client,await getAttempt(client,rows[0].id,req.user));
    });res.json({attempt:result});
  });
  router.get('/attempts/:id',async(req,res)=>res.json({attempt:await transaction(pool,async client=>attemptResponse(client,await getAttempt(client,req.params.id,req.user,true)))}));
  router.put('/attempts/:id/answers',async(req,res)=>{
    const data=validate(answerSchema,req.body);
    const attempt=await transaction(pool,async client=>{
      const a=await getAttempt(client,req.params.id,req.user,true);writable(a);
      if(a.answer_revision!==data.revision) fail(409,'A newer save exists. Reload this attempt before editing from this tab.');
      const ids=new Set(a.questions.map(q=>q.id));
      if(new Set(data.answers.map(q=>q.questionId)).size!==data.answers.length) fail(400,'Duplicate answer.');
      for(const answer of data.answers) {
        if(!ids.has(answer.questionId)) fail(400,'Question is not part of this attempt.');
        const q=a.questions.find(q=>q.id===answer.questionId);
        if(q.type==='mcq' && answer.answer!=='' && !q.options.includes(answer.answer)) fail(400,'Choose one of the listed options.');
        await client.query(`INSERT INTO growth_answers(attempt_id,question_id,answer,flagged) VALUES($1,$2,$3,$4)
          ON CONFLICT(attempt_id,question_id) DO UPDATE SET answer=EXCLUDED.answer,flagged=EXCLUDED.flagged,updated_at=NOW()`,[a.id,answer.questionId,answer.answer,answer.flagged]);
      }
      if(data.project) {
        if(a.kind!=='project') fail(400,'Project evidence is only accepted for internal projects.');
        await client.query(`INSERT INTO growth_project_submissions(attempt_id,repository_url,demo_url,summary) VALUES($1,$2,$3,$4)
          ON CONFLICT(attempt_id) DO UPDATE SET repository_url=EXCLUDED.repository_url,demo_url=EXCLUDED.demo_url,summary=EXCLUDED.summary,updated_at=NOW()`,[a.id,data.project.repositoryUrl,data.project.demoUrl,data.project.summary]);
      }
      await client.query('UPDATE growth_attempts SET answer_revision=answer_revision+1 WHERE id=$1',[a.id]);
      return {revision:a.answer_revision+1,savedAt:new Date().toISOString()};
    });res.json(attempt);
  });
  router.post('/attempts/:id/submit',async(req,res)=>{
    const a=await transaction(pool,async client=>{
      let a=await getAttempt(client,req.params.id,req.user,true);
      if(a.status==='active' && a.kind==='project') {
        const evidence=(await client.query('SELECT * FROM growth_project_submissions WHERE attempt_id=$1',[a.id])).rows[0];
        const files=(await client.query('SELECT id FROM growth_artifacts WHERE attempt_id=$1',[a.id])).rows;
        if(!evidence?.summary.trim() || (!evidence.repository_url && !evidence.demo_url && !files.length)) fail(400,'Add a summary and at least one repository, demo link or evidence file.');
      }
      a=await submit(client,a);return attemptResponse(client,await getAttempt(client,a.id,req.user));
    });res.json({attempt:a});
  });
  router.post('/attempts/:id/security-event',async(req,res)=>{
    const data=validate(z.object({eventId:z.string().uuid(),kind:z.enum(['focus-left','capture-shortcut','copy','print-shortcut','context-menu'])}),req.body);
    const result=await transaction(pool,async client=>{
      const a=await getAttempt(client,req.params.id,req.user,true);
      if(a.kind==='project')fail(400,'Exam controls do not apply to internal-project workspaces.');
      if(a.status!=='active')return {warnings:a.security_warning_count,limit:a.security_warning_limit,stopped:Boolean(a.security_stopped_at)};
      // Blur and visibilitychange can describe the same departure. Count that once.
      const recent=data.kind==='focus-left'?(await client.query("SELECT id FROM growth_security_events WHERE attempt_id=$1 AND kind IN ('focus-left','capture-shortcut','print-shortcut') AND created_at>NOW()-INTERVAL '2 seconds'",[a.id])).rows.length>0:false;
      const inserted=await client.query('INSERT INTO growth_security_events(attempt_id,client_event_id,kind,counted,actor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(attempt_id,client_event_id) DO NOTHING RETURNING id',[a.id,data.eventId,data.kind,!recent,req.user.id]);
      let count=a.security_warning_count;
      if(inserted.rows.length&&!recent){count++;await client.query('UPDATE growth_attempts SET security_warning_count=$2 WHERE id=$1',[a.id,count]);}
      const stopped=count>=a.security_warning_limit;
      if(stopped)await stopExam(client,a,`Exam stopped after ${count} browser-integrity warnings. These events require human review and are not proof of cheating.`,req.user.id);
      return {warnings:count,limit:a.security_warning_limit,stopped};
    });res.json(result);
  });
  router.post('/attempts/:id/check',rateLimit({windowMs:60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
    const data=validate(z.object({questionId:z.string().max(80),source:z.string().min(1).max(30000),execute:z.boolean().default(false)}),req.body);
    const a=await getAttempt(pool,req.params.id,req.user);writable(a);
    const q=a.questions.find(q=>q.id===data.questionId && q.type==='code');if(!q) fail(400,'Choose a coding question.');
    const syntax=checkJavaScript(data.source);
    const result=data.execute && syntax.valid?await runJavaScript(data.source,q.tests,config):null;
    if(data.execute)await pool.query('INSERT INTO growth_code_checks(attempt_id,question_id,source_hash,result) VALUES($1,$2,$3,$4)',[a.id,q.id,createHash('sha256').update(data.source).digest('hex'),JSON.stringify({syntax,execution:result})]);
    res.json({syntax,execution:result});
  });
  return router;
}

export function createGrowthAdminRouter(pool) {
  const router=Router();router.use(authenticationRequired(pool),roleRequired('admin'));
  router.get('/skills',async(_req,res)=>res.json({items:(await pool.query('SELECT * FROM growth_skills ORDER BY name')).rows}));
  router.post('/skills',async(req,res)=>{
    const d=validate(skillSchema,req.body);if(d.masterThreshold<d.level2Threshold)fail(400,'Master threshold must be at least the Level 2 threshold.');
    try {const {rows}=await pool.query(`INSERT INTO growth_skills(slug,name,description,career_paths,status,level2_threshold,master_threshold) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[d.slug,d.name,d.description,d.careerPaths,d.status,d.level2Threshold,d.masterThreshold]);res.status(201).json({item:rows[0]});}
    catch(error){if(error.code==='23505')fail(409,'This skill slug already exists.');throw error;}
  });
  router.put('/skills/:id',async(req,res)=>{
    if(!validId(req.params.id)) fail(404,'Skill not found.');const d=validate(skillSchema,req.body);if(d.masterThreshold<d.level2Threshold)fail(400,'Master threshold must be at least the Level 2 threshold.');
    try {const {rows}=await pool.query('UPDATE growth_skills SET slug=$2,name=$3,description=$4,career_paths=$5,status=$6,level2_threshold=$7,master_threshold=$8,updated_at=NOW() WHERE id=$1 RETURNING *',[req.params.id,d.slug,d.name,d.description,d.careerPaths,d.status,d.level2Threshold,d.masterThreshold]);if(!rows[0])fail(404,'Skill not found.');res.json({item:rows[0]});}
    catch(error){if(error.code==='23505')fail(409,'This skill slug already exists.');throw error;}
  });
  router.get('/content',async(req,res)=>{
    const kind=validate(z.enum(['assessment','challenge','project']),req.query.kind);
    res.json({items:(await pool.query(`${selectContent} WHERE a.kind=$1 AND v.version=(SELECT MAX(v2.version) FROM growth_activity_versions v2 WHERE v2.activity_id=a.id) ORDER BY a.position,v.title`,[kind])).rows.map(row=>displayContent(row,true))});
  });
  router.get('/content/:id',async(req,res)=>res.json({item:displayContent(await content(pool,req.params.id,true),true)}));
  router.post('/content',async(req,res)=>{
    const d=validate(contentSchema,req.body);validateQuestions(d);
    try {const result=await transaction(pool,async client=>{
      if(d.skillId && !(await client.query('SELECT id FROM growth_skills WHERE id=$1',[d.skillId])).rows.length) fail(400,'Choose an existing skill.');
      const {rows}=await client.query('INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES($1,$2,$3,$4) RETURNING id',[d.slug,d.kind,d.skillId,d.position]);
      await writeVersion(client,rows[0].id,1,d,req.user.id);return displayContent(await content(client,rows[0].id,true),true);
    });res.status(201).json({item:result});} catch(error){if(error.code==='23505')fail(409,'This activity slug already exists.');throw error;}
  });
  router.put('/content/:id',async(req,res)=>{
    const d=validate(contentSchema,req.body);validateQuestions(d);
    const item=await transaction(pool,async client=>{
      await client.query('SELECT id FROM growth_activities WHERE id::text=$1 FOR UPDATE',[req.params.id]);
      const old=await content(client,req.params.id,true);
      if(d.baseVersion!==old.content_version)fail(409,'Another edit exists. Reload the latest content before saving.');
      if(d.kind!==old.kind || d.slug!==old.slug || d.skillId!==old.skill_id || d.position!==old.position)fail(400,'Kind, slug, skill and position are fixed once created. Create a new activity to change them.');
      await writeVersion(client,old.id,old.content_version+1,d,req.user.id);return displayContent(await content(client,old.id,true),true);
    });res.json({item});
  });
  router.post('/content/:id/publish',async(req,res)=>{
    const d=validate(z.object({version:z.number().int().positive(),archive:z.boolean().default(false)}),req.body);
    const item=await transaction(pool,async client=>{
      await client.query('SELECT id FROM growth_activities WHERE id::text=$1 FOR UPDATE',[req.params.id]);
      const a=await content(client,req.params.id,true);if(a.content_version!==d.version)fail(409,'Reload the latest content version.');
      validateQuestions({kind:a.kind,skillId:a.skill_id,questions:a.questions,requirements:a.requirements},!d.archive);
      if(!d.archive && a.skill_id && !(await client.query('SELECT id FROM growth_skills WHERE id=$1 AND status=\'published\'',[a.skill_id])).rows.length)fail(400,'Publish this challenge’s skill first.');
      await client.query('UPDATE growth_activity_versions SET status=$3 WHERE activity_id=$1 AND version=$2',[a.id,d.version,d.archive?'archived':'published']);
      await client.query('UPDATE growth_activities SET published_version=$2 WHERE id=$1',[a.id,d.archive?null:d.version]);
      return displayContent(await content(client,a.id,true),true);
    });res.json({item});
  });
  router.get('/reviews',async(req,res)=>{
    const status=req.query.active==='true'?"t.status='active' AND t.deadline_at IS NOT NULL":req.query.all==='true'?"t.status<>'active'":"t.status='pending-review'";
    const query=attemptSelect.replace('SELECT t.*,','SELECT u.email AS developer_email,t.*,');
    res.json({items:(await pool.query(`${query} JOIN users u ON u.id=t.user_id WHERE ${status} ORDER BY t.submitted_at DESC LIMIT 200`)).rows.map(({questions:_q,...a})=>a)});
  });
  router.get('/reviews/:id',async(req,res)=>res.json({attempt:await transaction(pool,async client=>{
    const a=await getAttempt(client,req.params.id,req.user,true);const user=(await client.query('SELECT first_name,last_name,email FROM users WHERE id=$1',[a.user_id])).rows[0];
    return {...await attemptResponse(client,a,true),developer:user};
  })}));
  router.post('/reviews/:id/stop',async(req,res)=>{
    const data=validate(z.object({reason:z.string().trim().min(5).max(1000)}),req.body);
    const a=await transaction(pool,async client=>{
      const a=await getAttempt(client,req.params.id,req.user,true);
      if(a.kind==='project')fail(400,'Only timed assessments and challenges can be stopped.');
      if(a.status!=='active')fail(409,'This exam is already submitted or stopped.');
      await client.query("INSERT INTO growth_security_events(attempt_id,client_event_id,kind,actor_id,details) VALUES($1,gen_random_uuid(),'manual-stop',$2,$3)",[a.id,req.user.id,data.reason]);
      await stopExam(client,a,data.reason,req.user.id);return attemptResponse(client,await getAttempt(client,a.id,req.user),true);
    });res.json({attempt:a});
  });
  router.post('/reviews/:id',async(req,res)=>{
    const d=validate(z.object({feedback:z.string().trim().min(3).max(5000),score:z.number().min(0).max(100).optional(),securityDecision:z.enum(['confirm-stop','allow-grading']).optional(),grades:z.array(z.object({questionId:z.string().max(80),points:z.number().min(0).max(100)})).max(40).default([])}),req.body);
    const a=await transaction(pool,async client=>{
      const a=await getAttempt(client,req.params.id,req.user,true);
      if(a.status!=='pending-review') fail(409,'This result is final or has not been submitted. It cannot be regraded.');
      if(a.security_stopped_at&&!d.securityDecision)fail(400,'Review the exam-integrity events and choose an explicit decision.');
      const answers=await answersFor(client,a.id);const base=objectiveGrade(a.questions,Object.fromEntries(answers.map(q=>[q.question_id,q.answer])));
      let score=d.score;
      if(a.security_stopped_at&&d.securityDecision==='confirm-stop')score=0;
      else if(a.kind!=='project') {
        const manual=a.questions.filter(q=>q.type!=='mcq');
        if(d.grades.length!==manual.length || new Set(d.grades.map(g=>g.questionId)).size!==manual.length)fail(400,'Grade every written and coding question once.');
        let points=base.earned;
        for(const g of d.grades){const q=manual.find(q=>q.id===g.questionId);if(!q||g.points>q.points)fail(400,'Question grade exceeds the available points.');points+=g.points;}
        score=Math.round(points*10000/base.total)/100;
      } else if(score===undefined)fail(400,'Enter the project score.');
      await credit(client,a,score,d.feedback,req.user.id);
      await client.query("INSERT INTO growth_review_events(attempt_id,actor_id,action,details) VALUES($1,$2,'reviewed',$3)",[a.id,req.user.id,JSON.stringify({...d,score})]);
      return attemptResponse(client,await getAttempt(client,a.id,req.user),true);
    });res.json({attempt:a});
  });
  return router;
}

export function createGrowthFileRouter(pool) {
  const router=Router();router.use(authenticationRequired(pool));
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10485760,files:1,fields:0}});
  router.post('/:id',roleRequired('developer'),upload.single('file'),async(req,res)=>{
    const f=req.file;if(!f)fail(400,'Choose an evidence file.');
    const b=f.buffer;const mime=b.subarray(0,5).toString()==='%PDF-'?'application/pdf':b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':null;
    if(!mime || f.mimetype!==mime)fail(400,'Upload a valid PDF, PNG or JPEG file. Use a repository link for source code.');
    const file=await transaction(pool,async client=>{
      const a=await getAttempt(client,req.params.id,req.user,true);writable(a);if(a.kind!=='project')fail(400,'Evidence files belong to internal projects.');
      const {rows}=await client.query('SELECT count(*)::int AS count,COALESCE(sum(byte_size),0)::int AS bytes FROM growth_artifacts WHERE attempt_id=$1',[a.id]);
      if(rows[0].count>=5||rows[0].bytes+f.size>26214400)fail(400,'Use at most five files and 25 MB per project submission.');
      return (await client.query('INSERT INTO growth_artifacts(attempt_id,original_name,mime_type,byte_size,content) VALUES($1,$2,$3,$4,$5) RETURNING id,original_name,byte_size',[a.id,f.originalname.replace(/[\\/\x00-\x1f]/g,'_').slice(-180),mime,f.size,f.buffer])).rows[0];
    });res.status(201).json({file});
  });
  router.get('/:id',async(req,res)=>{
    if(!validId(req.params.id))fail(404,'File not found.');
    const {rows}=await pool.query(`SELECT f.* FROM growth_artifacts f JOIN growth_attempts t ON t.id=f.attempt_id WHERE f.id=$1 ${req.user.role==='admin'?'':'AND t.user_id=$2'}`,req.user.role==='admin'?[req.params.id]:[req.params.id,req.user.id]);
    const f=rows[0];if(!f)fail(404,'File not found.');res.set('Content-Security-Policy','sandbox');res.type(f.mime_type).attachment(f.original_name).send(Buffer.from(f.content));
  });
  router.delete('/:id',roleRequired('developer'),async(req,res)=>{
    if(!validId(req.params.id))fail(404,'File not found.');
    await transaction(pool,async client=>{
      const f=(await client.query('SELECT attempt_id FROM growth_artifacts WHERE id=$1',[req.params.id])).rows[0];if(!f)fail(404,'File not found.');
      writable(await getAttempt(client,f.attempt_id,req.user,true));await client.query('DELETE FROM growth_artifacts WHERE id=$1',[req.params.id]);
    });res.status(204).end();
  });return router;
}
