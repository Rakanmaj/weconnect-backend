import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {readFile} from 'node:fs/promises';
import {createApp} from '../src/app.js';
import {testDatabase} from './helpers/database.js';
import {hashPassword} from '../src/passwords.js';
import {growthCatalogSql, refreshAssessmentCatalogSql, refreshChallengeLessonsSql} from '../src/growth-catalog.js';
import {checkJavaScript,runJavaScript} from '../src/growth-grading.js';

const origin='http://localhost:3000',password='TestGrowth2026!';
const config={webOrigins:[origin],secureCookies:false,sessionDays:7,authLimit:1000,production:false};
let fixture,app,admin,dev,other,company,devId,assessment,attemptId;
const write=(agent,method,path,body={})=>agent[method]('/api'+path).set('Origin',origin).send(body);
const data=email=>({role:'developer',email,password,confirmPassword:password,firstName:'Growth',lastName:'Tester',preferredRole:'Full-Stack Developer',location:'Amman',github:''});
const q=(id='knowledge')=>({id,type:'mcq',prompt:'Which status means created?',points:100,options:['200','201'],correctAnswer:'201',starterCode:'',rubric:'',tests:[]});
async function passMilestoneChallenge(agent,slug){
  const a=(await write(agent,'post',`/growth/activities/${slug}/start`).expect(200)).body.attempt;
  const stored=(await fixture.pool.query('SELECT paper_questions FROM growth_attempts WHERE id=$1',[a.id])).rows[0].paper_questions;
  const key=Object.fromEntries(stored.map(q=>[q.id,q.correctAnswer]));
  const answers=a.questions.map(q=>({questionId:q.id,answer:key[q.id]}));
  await write(agent,'put',`/growth/attempts/${a.id}/answers`,{revision:0,answers}).expect(200);
  const passed=(await write(agent,'post',`/growth/attempts/${a.id}/submit`).expect(200)).body.attempt;
  assert.equal(passed.status,'passed');
}
async function createActivity(overrides={}){
  const body={kind:'assessment',slug:'test-'+crypto.randomUUID().slice(0,8),title:'Test Activity',description:'Integration assessment',careerPaths:['Full-Stack Developer'],durationMinutes:5,passScore:70,questions:[q()],requirements:'Answer the questions.',...overrides};
  const response=await write(admin,'post','/admin/growth/content',body).expect(201);
  await write(admin,'post',`/admin/growth/content/${response.body.item.id}/publish`,{version:1}).expect(200);
  return response.body.item;
}
before(async()=>{
  process.env.NODE_TEST_CONTEXT='1';
  fixture=await testDatabase();await fixture.db.exec(await readFile(new URL('../database/003_developer_growth.sql',import.meta.url),'utf8'));await fixture.db.exec(growthCatalogSql());await fixture.db.exec(refreshChallengeLessonsSql());await fixture.db.exec(refreshAssessmentCatalogSql());
  await fixture.db.exec(await readFile(new URL('../database/005_exam_integrity.sql',import.meta.url),'utf8'));
  await fixture.db.exec(await readFile(new URL('../database/006_exam_bank.sql',import.meta.url),'utf8'));
  await fixture.db.exec(await readFile(new URL('../database/007_milestone_coaching.sql',import.meta.url),'utf8'));
  await fixture.db.exec(await readFile(new URL('../database/009_question_results.sql',import.meta.url),'utf8'));
  app=createApp({pool:fixture.pool,config,logger:{error(){}}});
  admin=request.agent(app);dev=request.agent(app);other=request.agent(app);company=request.agent(app);
  await fixture.pool.query("INSERT INTO users(role,email,password_hash,first_name) VALUES('admin','reviewer@example.com',$1,'Reviewer')",[await hashPassword(password)]);
  await write(admin,'post','/auth/login',{email:'reviewer@example.com',password,role:'admin'}).expect(200);
  devId=(await write(dev,'post','/auth/register',data('growth@example.com')).expect(201)).body.user.id;
  await write(other,'post','/auth/register',data('othergrowth@example.com')).expect(201);
  await write(company,'post','/auth/register',{role:'company',email:'growthcompany@example.com',password,confirmPassword:password,companyName:'Growth Co',website:'https://example.com',industry:'Technology',size:'1-10',location:'Amman',contactName:'Owner',contactTitle:'Owner',about:''}).expect(201);
  assessment=(await dev.get('/api/growth/activities/full-stack-assessment').expect(200)).body.item;
});
after(async()=>{await fixture?.pool.end();});

test('growth migration and catalogue are repeatable and preserve existing accounts',async()=>{
  const before=(await fixture.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  await fixture.db.exec(await readFile(new URL('../database/003_developer_growth.sql',import.meta.url),'utf8'));await fixture.db.exec(growthCatalogSql());
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n,before);
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM growth_activities')).rows[0].n,48);
});
test('assessment eligibility requires account approval and a selected career path',async()=>{
  assert.equal(assessment.questions.length,0);assert.equal(assessment.questionCount,6);
  await write(dev,'post',`/growth/activities/${assessment.id}/start`).expect(403);
  await fixture.pool.query("INSERT INTO account_verifications(user_id,status) VALUES($1,'verified') ON CONFLICT(user_id) DO UPDATE SET status='verified'",[devId]);
  await write(dev,'post',`/growth/activities/${assessment.id}/start`).expect(403);
  await fixture.pool.query("UPDATE developer_profiles SET career_path='Full-Stack Developer' WHERE user_id=$1",[devId]);
  const result=await write(dev,'post',`/growth/activities/${assessment.id}/start`).expect(200);attemptId=result.body.attempt.id;
  assessment={...assessment,questions:result.body.attempt.questions};
  assert.ok(new Date(result.body.attempt.deadline_at)>new Date());assert.equal(result.body.attempt.questions[0].correctAnswer,undefined);assert.equal(result.body.attempt.questions[4].rubric,undefined);
  const again=await write(dev,'post',`/growth/activities/${assessment.id}/start`).expect(200);assert.equal(again.body.attempt.id,attemptId);
});
test('roles, ownership and request-origin checks protect all growth routes',async()=>{
  await request(app).get('/api/growth/overview').expect(401);
  await company.get('/api/growth/overview').expect(403);
  await dev.get('/api/admin/growth/content?kind=assessment').expect(403);
  await other.get(`/api/growth/attempts/${attemptId}`).expect(404);
  await write(other,'put',`/growth/attempts/${attemptId}/answers`,{revision:0,answers:[]}).expect(404);
  await dev.post(`/api/growth/attempts/${attemptId}/submit`).set('Origin','https://untrusted.example').send({}).expect(403);
});
test('answers autosave, resume and reject stale tabs and foreign question IDs',async()=>{
  await write(dev,'put',`/growth/attempts/${attemptId}/answers`,{revision:0,answers:[{questionId:'http',answer:'201',flagged:true}]}).expect(200);
  const resumed=(await dev.get(`/api/growth/attempts/${attemptId}`).expect(200)).body.attempt;
  assert.equal(resumed.answer_revision,1);assert.equal(resumed.answers[0].answer,'201');assert.equal(resumed.answers[0].flagged,true);
  await write(dev,'put',`/growth/attempts/${attemptId}/answers`,{revision:0,answers:[{questionId:'http',answer:'500'}]}).expect(409);
  await write(dev,'put',`/growth/attempts/${attemptId}/answers`,{revision:1,answers:[{questionId:'foreign',answer:'bad'}]}).expect(400);
  await write(dev,'put',`/growth/attempts/${attemptId}/answers`,{revision:1,answers:[{questionId:'http',answer:'not an option'}]}).expect(400);
});
test('published question edits are versioned and never change an existing attempt',async()=>{
  const original=(await admin.get(`/api/admin/growth/content/${assessment.id}`)).body.item;
  const updated={kind:original.kind,slug:original.slug,skillId:original.skill_id,position:original.position,title:'Updated assessment title',description:original.description,careerPaths:original.career_paths,durationMinutes:original.duration_minutes,passScore:original.pass_score,requirements:original.requirements,questions:original.questions.map(q=>({...q,prompt:'Updated: '+q.prompt})),baseVersion:1};
  await write(admin,'put',`/admin/growth/content/${assessment.id}`,updated).expect(200);
  await write(admin,'put',`/admin/growth/content/${assessment.id}`,updated).expect(409);
  await write(admin,'post',`/admin/growth/content/${assessment.id}/publish`,{version:2}).expect(200);
  const existing=(await dev.get(`/api/growth/attempts/${attemptId}`)).body.attempt;
  assert.equal(existing.version,1);assert.equal(existing.title,assessment.title);assert.equal(existing.questions[0].prompt.startsWith('Updated:'),false);
});
test('syntax checks never execute user code and real sandbox test evidence is saved',async()=>{
  assert.equal(checkJavaScript('globalThis.neverRun = true;').valid,true);assert.equal(globalThis.neverRun,undefined);
  assert.equal(checkJavaScript('const = ;').valid,false);
  const r=await write(dev,'post',`/growth/attempts/${attemptId}/check`,{questionId:'deduplicate',source:'console.log("safe");',execute:true}).expect(200);
  assert.equal(r.body.execution.available,true);assert.equal(r.body.execution.engine,'local-quickjs');
  const saved=(await dev.get(`/api/growth/attempts/${attemptId}`)).body.attempt;assert.equal(saved.codeChecks.length,1);
});
test('submissions lock answers and publish a placement score without an administrator',async()=>{
  const pseudo='READ stdin text\nPARSE JSON\nIF parse fails OR value is not an array: PRINT "INVALID"\nELSE walk items in order, append to output only on first sighting of each string\nPRINT JSON array of results';
  const written='Validate the profile form on the client and again on the server. Enforce ownership from the session and never trust a supplied user id. Return useful errors and use safe parameterized database writes.';
  const paper=(await fixture.pool.query('SELECT paper_questions FROM growth_attempts WHERE id=$1',[attemptId])).rows[0].paper_questions;
  const mcqKey=Object.fromEntries(paper.map(q=>[q.id,q.correctAnswer]));
  const answers=assessment.questions.map(q=>({questionId:q.id,answer:q.type==='mcq'?mcqKey[q.id]:q.type==='code'?pseudo:written}));
  await write(dev,'put',`/growth/attempts/${attemptId}/answers`,{revision:1,answers}).expect(200);
  const submitted=(await write(dev,'post',`/growth/attempts/${attemptId}/submit`).expect(200)).body.attempt;
  assert.equal(submitted.status,'passed');assert.ok(Number(submitted.score)>=70);assert.match(submitted.feedback,/scored|%/);
  assert.equal(submitted.question_results.length,submitted.questions.length);
  assert.ok(submitted.question_results.every(item=>typeof item.note==='string'&&item.note.length>0));
  await write(dev,'post',`/growth/attempts/${attemptId}/submit`).expect(200);
  await write(dev,'put',`/growth/attempts/${attemptId}/answers`,{revision:2,answers:[]}).expect(409);
  assert.equal((await admin.get('/api/admin/growth/reviews').expect(200)).body.items.some(a=>a.id===attemptId),false);
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM growth_completions WHERE user_id=$1 AND activity_id=$2',[devId,assessment.id])).rows[0].n,1);
  assert.equal((await dev.get('/api/growth/overview')).body.assessmentPassed,true);
  await write(dev,'post',`/growth/activities/${assessment.id}/start`).expect(409);
});
test('manual grading validates points and publishes immutable results without duplicate credit',async()=>{
  const content=await createActivity({questions:[
    {id:'deduplicate',type:'code',prompt:'Remove duplicates from the array.',points:30,options:[],correctAnswer:'',starterCode:'',rubric:'Correctness and validation.',tests:[]},
    {id:'design',type:'written',prompt:'Describe ownership checks.',points:30,options:[],correctAnswer:'',starterCode:'',rubric:'Session ownership.',tests:[]},
  ]});
  const started=(await write(dev,'post',`/growth/activities/${content.id}/start`).expect(200)).body.attempt;
  await write(dev,'put',`/growth/attempts/${started.id}/answers`,{revision:0,answers:[{questionId:'deduplicate',answer:'const values = [];'},{questionId:'design',answer:'Check the session owner before saving the profile.'}]}).expect(200);
  const stopped=(await write(admin,'post',`/admin/growth/reviews/${started.id}/stop`,{reason:'Hold this paper for a manual score check.'}).expect(200)).body.attempt;
  assert.equal(stopped.status,'pending-review');assert.equal(stopped.score,null);
  await write(admin,'post',`/admin/growth/reviews/${started.id}`,{feedback:'Reviewed carefully',securityDecision:'allow-grading',grades:[{questionId:'deduplicate',points:100},{questionId:'design',points:30}]}).expect(400);
  const r=(await write(admin,'post',`/admin/growth/reviews/${started.id}`,{feedback:'Correct implementation with clear edge cases.',securityDecision:'allow-grading',grades:[{questionId:'deduplicate',points:30},{questionId:'design',points:30}]}).expect(200)).body.attempt;
  assert.equal(r.status,'passed');assert.equal(Number(r.score),100);assert.equal(r.level,4);
  await write(admin,'post',`/admin/growth/reviews/${started.id}`,{feedback:'Changed result',securityDecision:'allow-grading',grades:[]}).expect(409);
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM growth_completions WHERE user_id=$1 AND activity_id=$2',[devId,content.id])).rows[0].n,1);
});
test('server deadlines automatically submit saved answers and forbid late writes',async()=>{
  const content=await createActivity();const a=(await write(dev,'post',`/growth/activities/${content.id}/start`).expect(200)).body.attempt;
  await write(dev,'put',`/growth/attempts/${a.id}/answers`,{revision:0,answers:[{questionId:'knowledge',answer:'201'}]}).expect(200);
  await fixture.pool.query("UPDATE growth_attempts SET deadline_at=NOW()-INTERVAL '1 second' WHERE id=$1",[a.id]);
  await write(dev,'put',`/growth/attempts/${a.id}/answers`,{revision:1,answers:[{questionId:'knowledge',answer:'200'}]}).expect(409);
  const result=(await dev.get(`/api/growth/attempts/${a.id}`).expect(200)).body.attempt;
  assert.equal(result.expired,true);assert.equal(result.status,'passed');assert.equal(Number(result.score),100);
});
test('challenge prerequisites enforce order, failed attempts can retry and skill progress counts once',async()=>{
  await write(dev,'post','/growth/activities/javascript-2/start').expect(403);
  const a=(await write(dev,'post','/growth/activities/javascript-1/start').expect(200)).body.attempt;
  assert.equal(a.questions.length,10);assert.match(a.lessonUrl,/w3schools\.com/);assert.ok(a.coach.hints.length);
  const missed=(await write(dev,'post',`/growth/attempts/${a.id}/submit`).expect(200)).body.attempt;
  assert.equal(missed.status,'failed');assert.ok(Number(missed.score)<60);
  const retry=(await write(dev,'post','/growth/activities/javascript-1/start').expect(200)).body.attempt;assert.notEqual(a.id,retry.id);
  assert.equal(retry.questions.length,10);
  const firstIds=new Set(a.questions.map(q=>q.id));
  assert.ok(retry.questions.every(q=>!firstIds.has(q.id)));
  assert.ok(retry.coach.hints.some(hint=>/last try/i.test(hint)));
  const stored=(await fixture.pool.query('SELECT paper_questions FROM growth_attempts WHERE id=$1',[retry.id])).rows[0].paper_questions;
  const key=Object.fromEntries(stored.map(q=>[q.id,q.correctAnswer]));
  const answers=retry.questions.map(q=>({questionId:q.id,answer:key[q.id]}));
  await write(dev,'put',`/growth/attempts/${retry.id}/answers`,{revision:0,answers}).expect(200);
  const passed=(await write(dev,'post',`/growth/attempts/${retry.id}/submit`).expect(200)).body.attempt;
  assert.equal(passed.status,'passed');assert.ok(Number(passed.score)>=60);
  await write(dev,'post','/growth/activities/javascript-2/start').expect(200);
  const js=(await dev.get('/api/growth/skills').expect(200)).body.items.find(s=>s.slug==='javascript');assert.equal(js.completed,1);assert.equal(js.level,'Level 1');
});
test('internal projects save evidence, scope file access and receive completion only after review',async()=>{
  const a=(await write(dev,'post','/growth/activities/accessible-profile/start').expect(200)).body.attempt;
  await write(dev,'post',`/growth/attempts/${a.id}/submit`).expect(400);
  await write(dev,'put',`/growth/attempts/${a.id}/answers`,{revision:0,answers:[],project:{repositoryUrl:'javascript:alert(1)',demoUrl:'',summary:'Bad URL'}}).expect(400);
  await write(dev,'put',`/growth/attempts/${a.id}/answers`,{revision:0,answers:[],project:{repositoryUrl:'https://example.com/project',demoUrl:'',summary:'Implemented labels, validation and persistence with integration tests.'}}).expect(200);
  const f=(await dev.post(`/api/growth-files/${a.id}`).set('Origin',origin).attach('file',Buffer.from('%PDF-1.4\nTest evidence'),{filename:'evidence.pdf',contentType:'application/pdf'}).expect(201)).body.file;
  await other.get(`/api/growth-files/${f.id}`).expect(404);await admin.get(`/api/growth-files/${f.id}`).expect(200);
  await dev.post(`/api/growth-files/${a.id}`).set('Origin',origin).attach('file',Buffer.from('<html>bad</html>'),{filename:'fake.pdf',contentType:'application/pdf'}).expect(400);
  await write(dev,'post',`/growth/attempts/${a.id}/submit`).expect(200);
  await write(dev,'delete',`/growth-files/${f.id}`).expect(409);
  await write(admin,'post',`/admin/growth/reviews/${a.id}`,{feedback:'Meets the functional and accessibility requirements.',score:90}).expect(200);
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM growth_completions WHERE user_id=$1 AND activity_id=$2',[devId,a.activity_id])).rows[0].n,1);
});
test('drafts are private, invalid question banks cannot publish, archives preserve old attempts',async()=>{
  const d=(await write(admin,'post','/admin/growth/content',{kind:'assessment',slug:'empty-assessment',title:'Empty draft',careerPaths:['Full-Stack Developer'],questions:[]}).expect(201)).body.item;
  await dev.get(`/api/growth/activities/${d.id}`).expect(404);
  await write(admin,'post',`/admin/growth/content/${d.id}/publish`,{version:1}).expect(400);
  await write(admin,'post',`/admin/growth/content/${assessment.id}/publish`,{version:2,archive:true}).expect(200);
  await dev.get(`/api/growth/activities/${assessment.id}`).expect(404);
  await dev.get(`/api/growth/attempts/${attemptId}`).expect(200);
});
test('managed-runner adapter submits constrained jobs and reads real statuses',async()=>{
  const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/submissions?')?{token:'test-token'}:{status:{id:3,description:'Accepted'}}};};
  const result=await runJavaScript('console.log(3)',[{name:'Example',input:'',output:'3'}],{runnerUrl:'http://sandbox.example',runnerToken:'private-token'},fetcher);
  assert.equal(result.available,true);assert.equal(result.tests[0].passed,true);
  const body=JSON.parse(calls[0].options.body);assert.equal(body.enable_network,false);assert.equal(body.cpu_time_limit,2);assert.equal(body.wall_time_limit,5);assert.equal(calls[0].options.headers['X-Auth-Token'],'private-token');
  assert.equal((await runJavaScript('bad',[{name:'Case'}],{runnerUrl:'http://sandbox.example'},async()=>{throw new Error('offline');})).available,false);
});
test('skill thresholds reach Level 2 and Master only after distinct passed challenges',async()=>{
  const skill=(await write(admin,'post','/admin/growth/skills',{slug:'boundary-skill',name:'Boundary skill',careerPaths:['Full-Stack Developer'],status:'published',level2Threshold:3,masterThreshold:10}).expect(201)).body.item;
  for(let n=1;n<=10;n++){
    const activity=await createActivity({kind:'challenge',skillId:skill.id,position:n});
    const a=(await write(dev,'post',`/growth/activities/${activity.id}/start`).expect(200)).body.attempt;
    await write(dev,'put',`/growth/attempts/${a.id}/answers`,{revision:0,answers:[{questionId:'knowledge',answer:'201'}]}).expect(200);
    await write(dev,'post',`/growth/attempts/${a.id}/submit`).expect(200);
    await write(dev,'post',`/growth/attempts/${a.id}/submit`).expect(200);
    const progress=(await dev.get('/api/growth/skills')).body.items.find(s=>s.id===skill.id);
    assert.equal(progress.completed,n);assert.equal(progress.level,n>=10?'Master':n>=3?'Level 2':'Level 1');
  }
});
test('local JavaScript sandbox executes examples, blocks host modules and stops infinite loops',async()=>{
  const echo=await runJavaScript('console.log(require("node:fs").readFileSync(0,"utf8"))',[{name:'stdin',input:'hello',output:'hello'}],{});
  assert.equal(echo.tests[0].passed,true);
  const blocked=await runJavaScript('require("node:child_process").execSync("never")',[{name:'blocked module',input:'',output:''}],{});
  assert.equal(blocked.tests[0].passed,false);assert.match(blocked.tests[0].status,/unavailable/);
  const globals=await runJavaScript('console.log(typeof process,typeof fetch)',[{name:'host access',input:'',output:'undefined undefined'}],{});
  assert.equal(globals.tests[0].passed,true);
  const endless=await runJavaScript('while(true) {}',[{name:'timeout',input:'',output:''}],{});
  assert.equal(endless.tests[0].passed,false);assert.match(endless.tests[0].status,/time limit/);
  assert.equal((await runJavaScript('print(1)',[],{runnerMode:'disabled'})).available,false);
});
test('three distinct integrity warnings stop an exam without automatic grading or lost answers',async()=>{
  const c=await createActivity();const a=(await write(dev,'post',`/growth/activities/${c.id}/start`).expect(200)).body.attempt;
  await write(dev,'put',`/growth/attempts/${a.id}/answers`,{revision:0,answers:[{questionId:'knowledge',answer:'201'}]}).expect(200);
  const first={eventId:crypto.randomUUID(),kind:'capture-shortcut'};
  assert.equal((await write(dev,'post',`/growth/attempts/${a.id}/security-event`,first).expect(200)).body.warnings,1);
  assert.equal((await write(dev,'post',`/growth/attempts/${a.id}/security-event`,first).expect(200)).body.warnings,1);
  await write(other,'post',`/growth/attempts/${a.id}/security-event`,{eventId:crypto.randomUUID(),kind:'copy'}).expect(404);
  await write(dev,'post',`/growth/attempts/${a.id}/security-event`,{eventId:crypto.randomUUID(),kind:'print-shortcut'}).expect(200);
  const stopped=(await write(dev,'post',`/growth/attempts/${a.id}/security-event`,{eventId:crypto.randomUUID(),kind:'copy'}).expect(200)).body;assert.equal(stopped.stopped,true);
  const result=(await dev.get(`/api/growth/attempts/${a.id}`)).body.attempt;assert.equal(result.status,'pending-review');assert.equal(result.score,null);assert.ok(result.security_stopped_at);assert.equal(result.answers[0].answer,'201');assert.equal(result.securityEvents.length,3);
  await write(dev,'put',`/growth/attempts/${a.id}/answers`,{revision:1,answers:[]}).expect(409);
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM growth_completions WHERE attempt_id=$1',[a.id])).rows[0].n,0);
  await write(admin,'post',`/admin/growth/reviews/${a.id}`,{feedback:'Reviewed browser events.'}).expect(400);
  const final=(await write(admin,'post',`/admin/growth/reviews/${a.id}`,{feedback:'The stopped exam needs a new supervised attempt.',securityDecision:'confirm-stop'}).expect(200)).body.attempt;assert.equal(final.score,0);assert.equal(final.status,'failed');
});
test('duplicate focus signals count once and an administrator can stop an active exam',async()=>{
  const c=await createActivity();const a=(await write(dev,'post',`/growth/activities/${c.id}/start`).expect(200)).body.attempt;
  await write(dev,'post',`/growth/attempts/${a.id}/security-event`,{eventId:crypto.randomUUID(),kind:'focus-left'}).expect(200);
  const duplicate=(await write(dev,'post',`/growth/attempts/${a.id}/security-event`,{eventId:crypto.randomUUID(),kind:'focus-left'}).expect(200)).body;assert.equal(duplicate.warnings,1);
  const paired=(await write(dev,'post',`/growth/attempts/${a.id}/security-event`,{eventId:crypto.randomUUID(),kind:'print-shortcut'}).expect(200)).body;
  const pairedFocus=(await write(dev,'post',`/growth/attempts/${a.id}/security-event`,{eventId:crypto.randomUUID(),kind:'focus-left'}).expect(200)).body;assert.equal(pairedFocus.warnings,paired.warnings);
  assert.ok((await admin.get('/api/admin/growth/reviews?active=true')).body.items.some(r=>r.id===a.id));
  await write(dev,'post',`/admin/growth/reviews/${a.id}/stop`,{reason:'Not authorized'}).expect(403);
  const stopped=(await write(admin,'post',`/admin/growth/reviews/${a.id}/stop`,{reason:'Instructor requested a supervised review.'}).expect(200)).body.attempt;
  assert.ok(stopped.security_stopped_at);assert.equal(stopped.status,'pending-review');assert.equal(stopped.securityEvents[0].kind,'manual-stop');
  const final=(await write(admin,'post',`/admin/growth/reviews/${a.id}`,{feedback:'Reviewed signals and chose to grade the saved answers.',securityDecision:'allow-grading',grades:[]}).expect(200)).body.attempt;assert.equal(final.status,'failed');
});
test('failed placement opens milestone-1 prep and blocks retake until every path skill is passed',async()=>{
  await write(admin,'post',`/admin/growth/content/${assessment.id}/publish`,{version:2,archive:false}).expect(200);
  const prep=request.agent(app);
  const prepId=(await write(prep,'post','/auth/register',data(`prep-path-${crypto.randomUUID().slice(0,8)}@example.com`)).expect(201)).body.user.id;
  await fixture.pool.query("INSERT INTO account_verifications(user_id,status) VALUES($1,'verified') ON CONFLICT(user_id) DO UPDATE SET status='verified'",[prepId]);
  await fixture.pool.query("UPDATE developer_profiles SET career_path='Full-Stack Developer' WHERE user_id=$1",[prepId]);
  await write(prep,'post','/growth/activities/javascript-1/start').expect(403);
  const failed=(await write(prep,'post','/growth/activities/full-stack-assessment/start').expect(200)).body.attempt;
  const wrong=failed.questions.map(q=>({questionId:q.id,answer:q.options?.[0]||'wrong'}));
  await write(prep,'put',`/growth/attempts/${failed.id}/answers`,{revision:0,answers:wrong}).expect(200);
  const submitted=(await write(prep,'post',`/growth/attempts/${failed.id}/submit`).expect(200)).body.attempt;
  assert.equal(submitted.status,'failed');
  const overview=(await prep.get('/api/growth/overview').expect(200)).body;
  assert.equal(overview.assessmentPassed,false);
  assert.equal(overview.placementPrep.attempted,true);
  assert.equal(overview.placementPrep.complete,false);
  assert.ok(overview.placementPrep.total>=4);
  for (const slug of ['javascript','react','node','postgresql']) assert.ok(overview.placementPrep.skills.some(s=>s.slug===slug));
  assert.equal(overview.canRetakePlacement,false);
  await write(prep,'post','/growth/activities/javascript-1/start').expect(200);
  await write(prep,'post','/growth/activities/javascript-2/start').expect(403);
  await fixture.pool.query("UPDATE growth_attempts SET submitted_at=NOW()-INTERVAL '25 hours' WHERE id=$1",[failed.id]);
  await write(prep,'post','/growth/activities/full-stack-assessment/start').expect(403);
  for (const row of overview.placementPrep.skills) {
    if (row.milestoneSlug) await passMilestoneChallenge(prep,row.milestoneSlug);
  }
  const ready=(await prep.get('/api/growth/overview').expect(200)).body;
  assert.equal(ready.placementPrep.complete,true);
  assert.equal(ready.canRetakePlacement,true);
  await write(prep,'post','/growth/activities/full-stack-assessment/start').expect(200);
});
