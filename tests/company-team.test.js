import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/passwords.js';
import { digestToken } from '../src/recovery.js';
import { testDatabase } from './helpers/database.js';

const password='Member2026!',origin='http://localhost:3000';
const config={webOrigins:[origin],appUrl:origin,secureCookies:false,sessionDays:7,authLimit:1000,recoveryLimit:1000,production:false};
let fixture,app,owner,otherOwner,admin,staff={};const mail=[];
const post=(url,body,actor)=>request(app).post('/api'+url).set('Origin',origin).set('Cookie',actor?.cookie||'').send(body);
const get=(url,actor)=>request(app).get('/api'+url).set('Cookie',actor?.cookie||'');
const identity=response=>({id:response.body.user.id,cookie:response.headers['set-cookie'][0].split(';')[0],user:response.body.user});
async function login(email,actorPassword=password){return identity(await post('/auth/login',{email,password:actorPassword,role:'company'}).expect(200));}
async function provision(role,email=role.toLowerCase()+'@staff.example.com',actor=owner){
 const response=await post('/team/invite',{name:role+' Member',email,password,role},actor).expect(201);
 const account=await login(email);return{...account,email,memberId:response.body.member.id};
}
before(async()=>{
 fixture=await testDatabase();app=createApp({pool:fixture.pool,config,logger:{error(){}},sendMail:async message=>mail.push(message)});
 for(const [email,name]of [['owner@company.example','Original Company'],['other@company.example','Other Company']]){
  const response=await post('/auth/register',{role:'company',email,password,confirmPassword:password,companyName:name,website:'https://example.com',industry:'Software',size:'11-50',location:'Amman',contactName:'Company Owner',contactTitle:'Owner',about:''}).expect(201);
  if(!owner)owner=identity(response);else otherOwner=identity(response);
 }
 const result=await fixture.pool.query("INSERT INTO public.users(role,email,password_hash,first_name) VALUES('admin','platform@example.com',$1,'Platform Admin') RETURNING id",[await hashPassword(password)]);
 admin=identity(await post('/auth/login',{email:'platform@example.com',password,role:'admin'}).expect(200));assert.equal(admin.id,result.rows[0].id);
});
after(async()=>{await fixture?.pool.end();});

test('owner-set credentials produce an active company member without a company profile or token acceptance',async()=>{
 for(const role of ['Admin','Evaluator','Recruiter'])staff[role]=await provision(role);
 for(const [role,account]of Object.entries(staff)){
  const me=await get('/auth/me',account).expect(200);assert.equal(me.body.user.companyAccess.role,role);assert.equal(me.body.user.companyAccess.companyId,owner.id);assert.equal(me.body.user.company.name,'Original Company');assert.equal(me.body.user.emailVerified,false);
  const db=(await fixture.pool.query('SELECT password_hash FROM public.users WHERE id=$1',[account.id])).rows[0];assert.notEqual(db.password_hash,password);assert.ok(await verifyPassword(password,db.password_hash));
  assert.equal((await fixture.pool.query('SELECT count(*)::int AS count FROM public.company_profiles WHERE user_id=$1',[account.id])).rows[0].count,0);
  const membership=(await fixture.pool.query('SELECT status,token_hash,expires_at FROM public.company_team_members WHERE id=$1',[account.memberId])).rows[0];assert.equal(membership.status,'active');assert.equal(membership.token_hash,null);assert.equal(membership.expires_at,null);
 }
 assert.ok(mail[0].text.includes('Email: admin@staff.example.com'));assert.ok(mail[0].text.includes('Password: '+password));assert.ok(mail[0].text.includes('/login?next='));assert.ok(!mail[0].text.includes('#token='));
 const roster=(await get('/team',owner)).body;assert.equal(roster.members.length,4);assert.ok(!JSON.stringify(roster).includes(password));assert.ok(!JSON.stringify(roster).includes('password_hash'));
});
test('server permission matrix distinguishes owner, administrator, evaluator and recruiter',async()=>{
 const permissions={Owner:['dashboard','projects','project-management','talent','hiring','interviews','offers','evaluations','profile','verification','team','team-management','payments','settings','notifications'],Admin:['dashboard','projects','project-management','talent','hiring','interviews','offers','evaluations','profile','verification','team','team-management','payments','settings','notifications'],Evaluator:['dashboard','projects','evaluations','team','notifications'],Recruiter:['dashboard','projects','talent','hiring','interviews','offers','team','notifications']};
 for(const [role,actor]of Object.entries({Owner:owner,...staff}))for(const module of permissions.Owner)await get('/company/access/'+module,actor).expect(permissions[role].includes(module)?200:403);
 await get('/company/access/hiring',admin).expect(403);await get('/company/access/projects').expect(401);
 for(const role of ['Evaluator','Recruiter']){await get('/profile',staff[role]).expect(403);await post('/profile/submit',{},staff[role]).expect(403);await request(app).post('/api/files/registration').set('Cookie',staff[role].cookie).attach('file',Buffer.from('%PDF-1.4\n%%EOF'),{filename:'doc.pdf',contentType:'application/pdf'}).expect(403);}
});
test('administrators edit the inviting company profile, not a separate staff company',async()=>{
 const data=(await get('/profile',staff.Admin).expect(200)).body;assert.equal(data.profile.name,'Original Company');assert.equal(data.ownerEmail,'owner@company.example');
 await request(app).put('/api/profile').set('Cookie',staff.Admin.cookie).send({...data.profile,about:'Edited by company admin'}).expect(200);
 assert.equal((await get('/profile',owner)).body.profile.about,'Edited by company admin');assert.equal((await get('/profile',otherOwner)).body.profile.about,'');
 const uploaded=await request(app).post('/api/files/registration').set('Cookie',staff.Admin.cookie).attach('file',Buffer.from('%PDF-1.4\n%%EOF'),{filename:'business.pdf',contentType:'application/pdf'}).expect(201);
 const fileId=uploaded.body.file.id;assert.equal((await fixture.pool.query('SELECT user_id FROM public.profile_files WHERE id=$1',[fileId])).rows[0].user_id,owner.id);
 await get('/files/'+fileId,owner).expect(200);await get('/files/'+fileId,staff.Admin).expect(200);await get('/files/'+fileId,otherOwner).expect(404);await get('/files/'+fileId,staff.Recruiter).expect(403);
});
test('members cannot switch, spoof or manage another company workspace',async()=>{
 for(const account of Object.values(staff)){
  await post('/team/switch',{companyId:otherOwner.id},account).expect(403);await get('/team?companyId='+otherOwner.id,account).expect(403);
  assert.equal((await get('/team/workspaces',account)).body.workspaces.length,1);
 }
 await post('/team/invite?companyId='+otherOwner.id,{name:'Intruder',email:'intruder@example.com',password,role:'Admin'},staff.Admin).expect(403);
 await post('/team/invite',{name:'Self promote',email:'promote@example.com',password,role:'Admin'},staff.Evaluator).expect(403);
 await request(app).patch('/api/team/'+staff.Evaluator.memberId).set('Cookie',staff.Evaluator.cookie).send({role:'Admin'}).expect(403);
});
test('existing emails and privileged fields cannot overwrite identities or passwords',async()=>{
 const before=(await fixture.pool.query('SELECT password_hash FROM public.users WHERE id=$1',[otherOwner.id])).rows[0].password_hash;
 for(const email of ['other@company.example','platform@example.com','recruiter@staff.example.com'])await post('/team/invite',{name:'Hijack',email,password:'Different2026!',role:'Admin'},owner).expect(409);
 assert.equal((await fixture.pool.query('SELECT password_hash FROM public.users WHERE id=$1',[otherOwner.id])).rows[0].password_hash,before);
 await post('/team/invite',{name:'Bad password',email:'short@example.com',password:'123',role:'Admin'},owner).expect(400);
 await post('/team/invite',{name:'Platform role',email:'role@example.com',password,role:'admin'},owner).expect(400);
 const account=await provision('Recruiter','identity@example.com');const row=(await fixture.pool.query('SELECT role,email_verified_at FROM public.users WHERE id=$1',[account.id])).rows[0];assert.equal(row.role,'company');assert.equal(row.email_verified_at,null);
});
test('mail failure rolls back both the new login and its company membership',async()=>{
 const failing=createApp({pool:fixture.pool,config,logger:{error(){}},sendMail:async()=>{throw new Error('offline');}});
 const response=await request(failing).post('/api/team/invite').set('Origin',origin).set('Cookie',owner.cookie).send({name:'Mail failure',email:'failure@example.com',password,role:'Recruiter'}).expect(503);
 assert.match(response.body.error,/No account was created/);
 assert.equal((await fixture.pool.query("SELECT count(*)::int AS count FROM public.users WHERE email='failure@example.com'")).rows[0].count,0);
 assert.equal((await fixture.pool.query("SELECT count(*)::int AS count FROM public.company_team_members WHERE email='failure@example.com'")).rows[0].count,0);
});
test('role changes affect existing sessions immediately; revocation kills access and old sessions',async()=>{
 const actor=staff.Recruiter;
 await get('/company/access/hiring',actor).expect(200);await request(app).patch('/api/team/'+actor.memberId).set('Cookie',owner.cookie).send({role:'Evaluator'}).expect(204);
 await get('/company/access/hiring',actor).expect(403);await get('/company/access/evaluations',actor).expect(200);
 await request(app).delete('/api/team/'+owner.id).set('Cookie',staff.Admin.cookie).send({}).expect(404);
 await request(app).delete('/api/team/'+actor.memberId).set('Cookie',owner.cookie).send({}).expect(204);await get('/auth/me',actor).expect(401);
 await post('/auth/login',{email:actor.email,password,role:'company'}).expect(403);
 await request(app).patch('/api/team/'+actor.memberId).set('Cookie',owner.cookie).send({restore:true}).expect(204);await get('/auth/me',actor).expect(401);
 const restored=await login(actor.email);assert.equal(restored.user.companyAccess.role,'Evaluator');
});
test('concurrent invitations to the same email create exactly one account and one credential email',async()=>{
 const body={name:'Concurrent member',email:'race@staff.example.com',password,role:'Evaluator'};const responses=await Promise.all([post('/team/invite',body,owner),post('/team/invite',body,otherOwner)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal(mail.filter(message=>message.to===body.email).length,1);
});
test('old verified invitation accounts can still accept a valid legacy link and switch workspace',async()=>{
 const legacy=identity(await post('/auth/register',{role:'company',email:'legacy@example.com',password,confirmPassword:password,companyName:'Legacy Own Company',website:'https://example.com',industry:'Software',size:'1-10',location:'Amman',contactName:'Legacy User',contactTitle:'Lead',about:''}).expect(201));
 await fixture.pool.query('UPDATE public.users SET email_verified_at=NOW() WHERE id=$1',[legacy.id]);const token='a'.repeat(64);
 await fixture.pool.query("INSERT INTO public.company_team_members(company_id,name,email,team_role,status,token_hash,expires_at) VALUES($1,'Legacy User','legacy@example.com','Recruiter','invited',$2,NOW()+INTERVAL '1 day')",[owner.id,digestToken(token)]);
 const accepted=await post('/team/accept',{token},legacy).expect(200);const selected=accepted.headers['set-cookie'][0].split(';')[0];
 const contextual=await get('/auth/me',{cookie:legacy.cookie+'; '+selected}).expect(200);assert.equal(contextual.body.user.companyAccess.companyId,owner.id);assert.equal(contextual.body.user.companyAccess.role,'Recruiter');
 await post('/team/accept',{token},legacy).expect(400);
});
