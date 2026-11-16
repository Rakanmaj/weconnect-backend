import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../',import.meta.url));
const artifacts=new URL('../.local/lab-privacy/',import.meta.url);await mkdir(artifacts,{recursive:true});
const require=createRequire(root+'/backend/package.json'),express=require('express');
const load=path=>import(pathToFileURL(root+'/'+path));
const {testDatabase}=await load('backend/tests/helpers/database.js');
const {growthCatalogSql}=await load('backend/src/growth-catalog.js');
const {createApp}=await load('backend/src/app.js');
const {hashPassword}=await load('backend/src/passwords.js');
process.env.NODE_TEST_CONTEXT='1';
const fixture=await testDatabase();
for(const file of ['003_developer_growth.sql','005_exam_integrity.sql','006_exam_bank.sql','007_milestone_coaching.sql','009_question_results.sql'])await fixture.db.exec(await readFile(root+'/backend/database/'+file,'utf8'));
await fixture.db.exec(growthCatalogSql());
const password='PrivacyCheck2026!',hash=await hashPassword(password);
const developer=(await fixture.pool.query("INSERT INTO users(role,email,password_hash,first_name,email_verified_at) VALUES('developer','privacy@example.invalid',$1,'Privacy Tester',NOW()) RETURNING id",[hash])).rows[0].id;
await fixture.pool.query("INSERT INTO developer_profiles(user_id,career_path) VALUES($1,'Full-Stack Developer')",[developer]);
await fixture.pool.query("INSERT INTO account_verifications(user_id,status) VALUES($1,'verified')",[developer]);
// Test-only prerequisite in an isolated in-memory database, never a real account.
await fixture.pool.query("INSERT INTO growth_attempts(user_id,activity_id,version,status,score,submitted_at) SELECT $1,id,published_version,'passed',100,NOW() FROM growth_activities WHERE slug='full-stack-assessment'",[developer]);
const base='http://127.0.0.1:4417';
const config={webOrigins:[base],secureCookies:false,sessionDays:7,authLimit:1000,production:false};
const app=createApp({pool:fixture.pool,config,logger:{error(){}},sendMail:async()=>{}});
app.use(express.static(root+'/frontend/dist'));app.get('/{*path}',(_req,res)=>res.sendFile(root+'/frontend/dist/index.html'));
const server=await new Promise(resolve=>{const value=app.listen(4417,'127.0.0.1',()=>resolve(value));});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const checks=[];const check=name=>{checks.push(name);console.log('PASS: '+name);};
async function api(method,path,body){return page.evaluate(async({method,path,body})=>{const response=await fetch('/api'+path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()};},{method,path,body});}
async function start(slug){const result=await api('POST',`/growth/activities/${slug}/start`,{});assert.equal(result.status,200);return result.body.attempt;}
try{
 await page.goto(base+'/login');await page.locator('input[type=email]').fill('privacy@example.invalid');await page.locator('input[type=password]').fill(password);await page.getByRole('button',{name:'Continue as Developer',exact:true}).click();await page.waitForURL('**/developer/dashboard');
 const a=await start('javascript-1');await page.goto(base+`/developer/challenges/javascript?attempt=${a.id}`);await page.bringToFront();await page.getByRole('button',{name:'Submit challenge',exact:true}).waitFor();
 if(process.argv.includes('--before')){
  const protectionMounted=await page.locator('[data-private-assessment]').count()>0;
  await page.keyboard.press('Control+c');
  const warnings=(await fixture.pool.query('SELECT security_warning_count FROM growth_attempts WHERE id=$1',[a.id])).rows[0].security_warning_count;
  const result={protectionMounted,warningsAfterCopy:warnings};console.log(JSON.stringify(result));await writeFile(new URL('before.json',artifacts),JSON.stringify(result,null,2));
 }else{
  await page.locator('[data-private-assessment]').waitFor();await page.getByText('Warnings: 0/3',{exact:true}).waitFor();check('Learning lab question workspace mounts protection and visible warning counter');
  assert.equal(await page.getByRole('timer').count(),0);check('untimed challenge behavior is unchanged');
  await page.getByRole('radio').first().check();
  await page.keyboard.press('Control+c');await page.getByText('Warnings: 1/3',{exact:true}).waitFor();check('copy shortcut records a warning even when question text cannot be selected');
  const warningBeforeScreenshot=(await fixture.pool.query('SELECT security_warning_count FROM growth_attempts WHERE id=$1',[a.id])).rows[0].security_warning_count;
  await page.screenshot({path:fileURLToPath(new URL('lab-question.png',artifacts))});
  assert.equal((await fixture.pool.query('SELECT security_warning_count FROM growth_attempts WHERE id=$1',[a.id])).rows[0].security_warning_count,warningBeforeScreenshot);check('screenshots are not falsely claimed to be detectable');
  await page.keyboard.press('PrintScreen');await page.getByText('Warnings: 2/3',{exact:true}).waitFor();await page.getByRole('heading',{name:'Questions hidden',exact:true}).waitFor();check('delivered capture shortcut hides questions and records one warning for keydown/keyup');
  await page.keyboard.press('Control+p');await page.getByRole('heading',{name:'Exam stopped for review',exact:true}).waitFor();
  const stopped=(await api('GET',`/growth/attempts/${a.id}`)).body.attempt;
  assert.equal(stopped.status,'pending-review');assert.equal(stopped.score,null);assert.equal(stopped.security_warning_count,3);assert.equal(stopped.answers[0].answer,a.questions[0].options[0]);
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS n FROM growth_completions WHERE attempt_id=$1',[a.id])).rows[0].n,0);check('third warning stops challenge, preserves the answer and awards no credit');
  assert.equal((await api('PUT',`/growth/attempts/${a.id}/answers`,{revision:stopped.answer_revision,answers:[]})).status,409);check('stopped challenge rejects further answer writes');
  await page.reload();await page.getByRole('heading',{name:'Exam stopped for review',exact:true}).waitFor();await page.getByText('Warnings: 3/3',{exact:true}).waitFor();check('warning count and stopped state survive reload');
  const focus=await start('react-1');await page.goto(base+`/developer/challenges/react?attempt=${focus.id}`);await page.bringToFront();await page.getByText('Warnings: 0/3',{exact:true}).waitFor();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'));});
  await page.getByRole('heading',{name:'Questions hidden',exact:true}).waitFor();await page.getByText('Warnings: 1/3',{exact:true}).waitFor();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});window.dispatchEvent(new Event('focus'));});
  const events=(await api('GET',`/growth/attempts/${focus.id}`)).body.attempt.securityEvents;
  assert.equal(events.filter(event=>event.counted).length,1);check('paired blur/visibility signals hide lab questions and count once');
  await page.getByRole('heading',{name:'Question 1',exact:true}).click({button:'right'});await page.getByText('Warnings: 2/3',{exact:true}).waitFor();
  await page.keyboard.press('Control+x');await page.getByRole('heading',{name:'Exam stopped for review',exact:true}).waitFor();check('question context-menu and cut shortcuts also produce persisted warnings');
  const offline=await start('node-1');await page.goto(base+`/developer/challenges/node?attempt=${offline.id}`);await page.bringToFront();await page.getByText('Warnings: 0/3',{exact:true}).waitFor();
  await page.route('**/security-event',route=>route.abort());await page.keyboard.press('Control+c');await page.getByRole('heading',{name:'Connection check required',exact:true}).waitFor();
  assert.equal((await fixture.pool.query('SELECT security_warning_count FROM growth_attempts WHERE id=$1',[offline.id])).rows[0].security_warning_count,0);
  await page.unroute('**/security-event');await page.getByRole('button',{name:'Retry connection check',exact:true}).click();await page.getByText('Warnings: 1/3',{exact:true}).waitFor();check('offline warning delivery hides questions and retries once after reconnect');
  const custom=(await fixture.pool.query("INSERT INTO growth_activities(slug,kind,position,published_version) VALUES('privacy-written','assessment',1,1) RETURNING id")).rows[0].id;
  await fixture.pool.query(`INSERT INTO growth_activity_versions(activity_id,version,title,career_paths,status,questions) VALUES($1,1,'Privacy written test',ARRAY['Full-Stack Developer'],'published',$2)`,[custom,JSON.stringify([{id:'explain',type:'written',prompt:'Explain session ownership.',points:100,options:[],tests:[],starterCode:'',rubric:'Use the server session.'}])]);
  const written=await start('privacy-written');await page.goto(base+`/developer/assessment?attempt=${written.id}`);await page.bringToFront();
  const answer=page.getByLabel('Written answer',{exact:true});await answer.fill('This is my own written answer.');await page.getByRole('button',{name:'Save progress',exact:true}).click();await page.getByRole('status').filter({hasText:'All changes saved'}).waitFor();
  await answer.press('Control+a');await answer.press('Control+c');
  assert.equal((await api('GET',`/growth/attempts/${written.id}`)).body.attempt.security_warning_count,0);check('copying text inside the student answer editor remains allowed');
  await page.dispatchEvent('body','keyup',{key:'PrintScreen'});await page.getByText('Warnings: 1/3',{exact:true}).waitFor();check('PrintScreen delivered only on keyup is handled');
  assert.deepEqual(errors,[]);check('no uncaught browser errors');
  await writeFile(new URL('after.json',artifacts),JSON.stringify({checks,liveDatabaseUsed:false,uncaughtErrors:errors.length},null,2));
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fixture.pool.end();}
