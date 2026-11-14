import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/passwords.js';
import { createMailer } from '../src/mail.js';
import { testDatabase } from './helpers/database.js';

const password = 'Testing2026!', origin = 'http://localhost:3000';
const config = { webOrigins: [origin], appUrl: origin, production: false, authLimit: 1000, recoveryLimit: 1000, sessionDays: 7, secureCookies: false };
const mail = []; let fixture, app, dev, other, company, member, admin, hash;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
const post = (path, body, actor) => request(app).post('/api'+path).set('Origin', origin).set('Cookie', actor?.cookie || '').send(body);
const get = (path, actor) => request(app).get('/api'+path).set('Cookie', actor?.cookie || '');
const token = message => message.text.match(/#token=([a-f0-9]{64})/)[1];
async function person(name, role) {
  const {rows} = await fixture.pool.query('INSERT INTO public.users(role,email,password_hash,first_name,last_name) VALUES($1,$2,$3,$4,$5) RETURNING id', [role, name+'@example.com', hash, name, 'Test']);
  const id = rows[0].id;
  if(role==='developer') await fixture.pool.query("INSERT INTO public.developer_profiles(user_id,location,preferred_position) VALUES($1,'Amman','Full-Stack Developer')",[id]);
  if(role==='company') await fixture.pool.query("INSERT INTO public.company_profiles(user_id,company_name,website,industry,company_size,location,contact_name,contact_title) VALUES($1,$2,'https://example.com','Technology','11-50','Amman',$2,'Lead')",[id,name+' Company']);
  const login = await post('/auth/login', {email:name+'@example.com',password,role}).expect(200);
  return {id,email:name+'@example.com',cookie:login.headers['set-cookie'][0].split(';')[0]};
}
async function verify(actor) {
  await post('/auth/send-verification',{},actor).expect(200);
  const link = token(mail.at(-1));
  await post('/auth/verify-email',{token:link}).expect(200);
  return link;
}
const upload = (actor, kind, bytes=pdf, type='application/pdf', name='document.pdf') => request(app).post('/api/files/'+kind).set('Origin',origin).set('Cookie',actor.cookie).attach('file',bytes,{filename:name,contentType:type});
async function profile(actor, extra={}) {
  const data=(await get('/profile',actor).expect(200)).body.profile;
  return request(app).put('/api/profile').set('Origin',origin).set('Cookie',actor.cookie).send({...data,...extra});
}
before(async()=>{
  fixture=await testDatabase(); hash=await hashPassword(password);
  app=createApp({pool:fixture.pool,config,logger:{error(){}},sendMail:async message=>{mail.push(message);}});
  dev=await person('developer','developer'); other=await person('other','developer'); company=await person('owner','company'); member={email:'member@example.com'}; admin=await person('admin','admin');
});
after(async()=>{await fixture?.pool.end();});

test('profiles require authentication and account owners cannot read another profile through an ID parameter',async()=>{
  await get('/profile').expect(401); await get('/profile',admin).expect(403);
  const result=await get('/profile?userId='+other.id,dev).expect(200); assert.equal(result.body.user.id,dev.id);
});
test('full developer onboarding and company details persist across API restarts without changing email or verified state',async()=>{
  const education=[{degree:'BSc',institution:'University',graduationYear:2026,coursework:'Databases'}];
  const result=await profile(dev,{firstName:'Updated',bio:'Developer bio',phone:'+962',education,skills:['React','PostgreSQL'],yearsExperience:3,careerGoals:'Build useful apps',linkedin:'https://linkedin.com/in/test',portfolio:'https://example.com/work',weeklyHours:30,projectTypes:['Training Project'],availableFrom:'2026-11-02',onboardingStep:8,email:'hijack@example.com',verificationStatus:'verified'});
  assert.equal(result.status,200);assert.equal(result.body.profile.bio,'Developer bio');assert.equal(result.body.user.email,dev.email);assert.equal(result.body.verification.status,'draft');
  const restart=createApp({pool:fixture.pool,config,sendMail:async()=>{}});
  const saved=await request(restart).get('/api/profile').set('Cookie',dev.cookie).expect(200);
  assert.deepEqual(saved.body.profile.education,education);assert.equal(saved.body.profile.availableFrom,'2026-11-02');assert.equal(saved.body.profile.onboardingStep,8);
  const comp=await profile(company,{registrationNumber:'JO-123',registrationCountry:'Jordan',about:'Saved company'});assert.equal(comp.status,200);assert.equal(comp.body.profile.registrationNumber,'JO-123');
});
test('invalid profile values and script URLs are rejected atomically',async()=>{
  for(const invalid of [{weeklyHours:0},{github:'javascript:alert(1)'},{yearsExperience:-1},{education:[{degree:'Incomplete'}]},{availableFrom:'2026-02-30'}]) assert.equal((await profile(dev,invalid)).status,400);
  assert.equal((await get('/profile',dev)).body.profile.weeklyHours,30);
});
test('uploads validate bytes, MIME, size, allowed role and request origin',async()=>{
  await upload(dev,'cv',Buffer.from('<script>bad</script>')).expect(400);
  await upload(dev,'cv',pdf,'image/png').expect(400);
  await upload(company,'cv').expect(400);
  await upload(dev,'registration').expect(400);
  await upload(dev,'cv',Buffer.alloc(5*1024*1024+1,65)).expect(400);
  await upload(dev,'certificate',Buffer.alloc(10*1024*1024+1,65)).expect(413);
  await request(app).post('/api/files/cv').set('Origin','https://evil.example').set('Cookie',dev.cookie).attach('file',pdf,{filename:'x.pdf',contentType:'application/pdf'}).expect(403);
});
test('private files can be downloaded by their owner or an admin, with attachment and sandbox headers',async()=>{
  const response=await upload(dev,'cv').expect(201);const id=response.body.file.id;
  assert.equal(response.body.file.content,undefined);
  await get('/files/'+id,other).expect(404); await get('/files/'+id,company).expect(404);await get('/files/'+id).expect(401);
  const owner=await get('/files/'+id,dev).expect(200);assert.match(owner.headers['content-disposition'],/attachment/);assert.match(owner.headers['content-security-policy'],/sandbox/);assert.equal(owner.headers['x-content-type-options'],'nosniff');
  await get('/files/'+id,admin).expect(200);
  await request(app).delete('/api/files/'+id).set('Cookie',other.cookie).send({}).expect(404);
});
test('verification email tokens are hashed, expire, cannot act as reset tokens, and are single use',async()=>{
  await post('/profile/submit',{},dev).expect(400);
  const link=await verify(dev);await post('/auth/verify-email',{token:link}).expect(400);
  const rows=(await fixture.pool.query('SELECT token_hash FROM public.account_tokens WHERE user_id=$1',[dev.id])).rows;
  assert.notEqual(rows[0].token_hash,link);assert.equal((await get('/auth/me',dev)).body.user.emailVerified,true);
  await post('/auth/reset-password',{token:link,password:'NewPassword2026!',confirmPassword:'NewPassword2026!'}).expect(400);
  await post('/auth/send-verification',{},other).expect(200);const expired=token(mail.at(-1));
  await fixture.pool.query("UPDATE public.account_tokens SET expires_at=NOW()-INTERVAL '1 hour' WHERE user_id=$1",[other.id]);await post('/auth/verify-email',{token:expired}).expect(400);
});
test('admin review is role protected, records feedback, rejects stale decisions, and ignores URL status spoofing',async()=>{
  await request(app).put('/api/profile/career-path').set('Cookie',dev.cookie).send({careerPath:'Backend Developer'}).expect(403);
  await post('/profile/submit',{},dev).expect(200);await post('/profile/submit',{},dev).expect(409);
  const detail=(await get('/admin/verifications/'+dev.id,admin).expect(200)).body;
  const body={status:'more-info',feedback:'Please provide supporting identity evidence.',revision:detail.verification.revision};
  await post('/admin/verifications/'+dev.id,body,company).expect(403);await get('/admin/verifications?role=developer',dev).expect(403);
  await post('/admin/verifications/'+dev.id,{...body,feedback:''},admin).expect(400);
  await post('/admin/verifications/'+dev.id,body,admin).expect(200);
  await post('/admin/verifications/'+dev.id,{...body,status:'verified'},admin).expect(409);
  const self=(await get('/profile?status=verified',dev)).body;assert.equal(self.verification.status,'more-info');assert.equal(self.verification.feedback,body.feedback);assert.ok(self.history.length>=2);
  assert.equal((await get('/admin/verifications?role=developer',admin)).body.items[0].id,dev.id);
});
test('resubmission, approval and career-path saving work; profile changes revoke approval and prevent stale reviews',async()=>{
  await post('/profile/submit',{},dev).expect(200);const current=(await get('/profile',dev)).body;
  await post('/admin/verifications/'+dev.id,{status:'verified',feedback:'Approved.',revision:current.verification.revision},admin).expect(200);
  await request(app).put('/api/profile/career-path').set('Cookie',dev.cookie).send({careerPath:'Backend Developer'}).expect(200);
  assert.equal((await get('/profile',dev)).body.profile.careerPath,'Backend Developer');
  await profile(dev,{onboardingStep:9});assert.equal((await get('/profile',dev)).body.verification.status,'verified');
  await profile(dev,{bio:'Edited after review'});assert.equal((await get('/profile',dev)).body.verification.status,'draft');
  await post('/admin/verifications/'+dev.id,{status:'verified',feedback:'',revision:current.verification.revision},admin).expect(409);
});
test('company submission needs registration details, document and verified email; rejection is visible and can be resubmitted',async()=>{
  await verify(company);await post('/profile/submit',{},company).expect(400);await upload(company,'registration').expect(201);
  await post('/profile/submit',{},company).expect(200);const current=(await get('/profile',company)).body;
  await post('/admin/verifications/'+company.id,{status:'rejected',feedback:'Registration document needs a clearer copy.',revision:current.verification.revision},admin).expect(200);
  assert.equal((await get('/profile',company)).body.verification.status,'rejected');
  await post('/profile/submit',{},company).expect(200);
});
test('simultaneous admin decisions cannot overwrite one another',async()=>{
  const current=(await get('/profile',company)).body.verification;
  const decisions=await Promise.all([
    post('/admin/verifications/'+company.id,{status:'verified',feedback:'Reviewed.',revision:current.revision},admin),
    post('/admin/verifications/'+company.id,{status:'rejected',feedback:'A different decision.',revision:current.revision},admin),
  ]);
  assert.deepEqual(decisions.map(result=>result.status).sort(),[200,409]);
  const saved=(await get('/profile',company)).body.verification;
  assert.equal(saved.revision,current.revision+1);
});
test('removing or replacing reviewed documents returns the account to draft; old CV bytes are no longer accessible',async()=>{
  const before=(await get('/profile',dev)).body.files.find(file=>file.kind==='cv');
  const after=await upload(dev,'cv',pdf,'application/pdf','new-cv.pdf').expect(201);assert.notEqual(after.body.file.id,before.id);await get('/files/'+before.id,dev).expect(404);
  const current=(await get('/profile',company)).body.files[0];await request(app).delete('/api/files/'+current.id).set('Cookie',company.cookie).send({}).expect(204);assert.equal((await get('/profile',company)).body.verification.status,'draft');
});
test('team invites create ready-to-sign-in staff inside the inviting company without signup',async()=>{
  const invitation=await post('/team/invite',{name:'Member',email:member.email,password,role:'Evaluator'},company).expect(201);
  assert.equal(invitation.body.member.token_hash,undefined);assert.equal(invitation.body.member.status,'active');assert.ok(mail.at(-1).text.includes('Password: '+password));
  const login=await post('/auth/login',{email:member.email,password,role:'company'}).expect(200);member={...member,id:login.body.user.id,cookie:login.headers['set-cookie'][0].split(';')[0]};
  assert.equal(login.body.user.companyAccess.companyId,company.id);assert.equal(login.body.user.companyAccess.role,'Evaluator');
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS count FROM public.company_profiles WHERE user_id=$1',[member.id])).rows[0].count,0);
  const roster=await get('/team?companyId='+company.id,member).expect(200);assert.equal(roster.body.canManage,false);assert.equal(roster.body.members.find(row=>row.email===member.email).status,'active');
  assert.equal((await get('/team/workspaces',member)).body.workspaces.length,1);
});
test('team permissions enforce workspace boundaries, immutable owner and revocation',async()=>{
  const id=(await get('/team',company)).body.members.find(row=>row.email===member.email).id;
  await post('/team/invite?companyId='+company.id,{name:'Intruder',email:'intruder@example.com',password,role:'Admin'},member).expect(403);
  await request(app).patch('/api/team/'+id+'?companyId='+member.id).set('Cookie',company.cookie).send({role:'Admin'}).expect(403);
  await request(app).patch('/api/team/'+id).set('Cookie',company.cookie).send({role:'Admin'}).expect(204);
  assert.equal((await get('/team?companyId='+company.id,member)).body.canManage,true);
  await request(app).delete('/api/team/'+company.id).set('Cookie',company.cookie).send({}).expect(404);
  await request(app).delete('/api/team/'+id).set('Cookie',company.cookie).send({}).expect(204);
  await get('/team?companyId='+company.id,member).expect(401);await get('/team',dev).expect(403);
});
test('password reset gives neutral responses, uses one-time expiring tokens, and invalidates all previous sessions',async()=>{
  const known=await post('/auth/forgot-password',{email:other.email}).expect(202);const link=token(mail.at(-1));
  const unknown=await post('/auth/forgot-password',{email:'missing@example.com'}).expect(202);assert.deepEqual(known.body,unknown.body);assert.equal(known.body.token,undefined);
  await post('/auth/reset-password',{token:link,password:'NewPassword2026!',confirmPassword:'Mismatch'}).expect(400);
  await post('/auth/reset-password',{token:link,password:'NewPassword2026!',confirmPassword:'NewPassword2026!'}).expect(200);
  await post('/auth/reset-password',{token:link,password:'AnotherPassword2026!',confirmPassword:'AnotherPassword2026!'}).expect(400);
  await get('/auth/me',other).expect(401);await post('/auth/login',{email:other.email,password}).expect(401);await post('/auth/login',{email:other.email,password:'NewPassword2026!'}).expect(200);
});
test('new reset links supersede old ones and expired links cannot change passwords',async()=>{
  await post('/auth/forgot-password',{email:other.email}).expect(202);const first=token(mail.at(-1));
  await post('/auth/forgot-password',{email:other.email}).expect(202);const second=token(mail.at(-1));assert.notEqual(first,second);
  const data={password:'Changed2026!',confirmPassword:'Changed2026!'};
  await post('/auth/reset-password',{...data,token:first}).expect(400);
  await fixture.pool.query("UPDATE public.account_tokens SET expires_at=NOW()-INTERVAL '1 minute' WHERE user_id=$1 AND purpose='password-reset'",[other.id]);
  await post('/auth/reset-password',{...data,token:second}).expect(400);
});
test('combined SQL upgrades a populated Week 1 database and can be re-run without losing data',async()=>{
  const isolated=await testDatabase();try{
    const count=(await fixture.pool.query('SELECT count(*)::int AS count FROM public.users')).rows[0].count;
    await fixture.db.exec(fixture.schema);assert.equal((await fixture.pool.query('SELECT count(*)::int AS count FROM public.users')).rows[0].count,count);
    const week1=await readFile(new URL('../database/001_auth.sql',import.meta.url),'utf8');const week2=await readFile(new URL('../database/002_profiles_verification.sql',import.meta.url),'utf8');
    const {PGlite}=await import('@electric-sql/pglite');const old=new PGlite();try{await old.exec(week1);await old.query("INSERT INTO public.users(role,email,password_hash,first_name) VALUES('developer','legacy@example.com',$1,'Legacy')",[hash]);await old.exec(week2);assert.equal((await old.query('SELECT email FROM public.users')).rows[0].email,'legacy@example.com');}finally{await old.close();}
  }finally{await isolated.pool.end();}
});
test('development email outbox is private local text and disabled in production',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'weconnect-mail-'));
  try{await createMailer({mailMode:'outbox',mailOutbox:directory,production:false})({to:'test@example.com',subject:'Test',text:'Private link'});const names=await readdir(directory);assert.equal(names.length,1);assert.match(await readFile(join(directory,names[0]),'utf8'),/Private link/);await assert.rejects(()=>createMailer({mailMode:'outbox',production:true})({to:'x',subject:'x',text:'x'}));}finally{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('weconnect-mail-'));await rm(target,{recursive:true,force:true});}
});
