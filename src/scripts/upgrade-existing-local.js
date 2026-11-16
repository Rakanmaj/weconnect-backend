import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import assert from 'node:assert/strict';
import {getConfig} from '../config.js';
import {createPool} from '../db.js';
import {assessmentCatalog,challengeCatalog} from '../growth-catalog.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pool=createPool(getConfig().databaseUrl);
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=root+`.local/backups/before-ai-upgrade-${stamp}.dump`;
async function digest(client,table,columns,keys,pk){
 const projection=columns.map(quote).join(',');
 const where=`jsonb_build_array(${pk.map(quote).join(',')})::text=ANY($1::text[])`;
 return (await client.query(`SELECT count(*)::int AS rows,md5(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text))) AS digest FROM (SELECT ${projection} FROM public.${quote(table)} WHERE ${where}) t`,[keys])).rows[0];
}
let client;
try{
 const db=(await pool.query('SELECT current_database() AS name')).rows[0].name;
 assert.equal(db,decodeURIComponent(new URL(getConfig().databaseUrl).pathname.slice(1)),'Connected database differs from the configured target.');
 await mkdir(root+'.local/backups',{recursive:true});
 const url=new URL(getConfig().databaseUrl);
 execFileSync(process.env.PG_DUMP_PATH||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe':'pg_dump'),['-Fc','--no-password','--file',backup],{env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))},stdio:['ignore','pipe','pipe'],timeout:60000});
 assert.ok((await stat(backup)).size>0);
 const tables=(await pool.query(`SELECT c.relname AS name,array_agg(a.attname::text ORDER BY k.ordinality) AS pk FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indisprimary AND n.nspname='public' GROUP BY c.relname ORDER BY c.relname`)).rows;
 const preserved=[];
 for(const table of tables){
  const columns=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[table.name])).rows.map(row=>row.column_name).filter(name=>table.name!=='growth_activities'||name!=='published_version');
  const keys=(await pool.query(`SELECT jsonb_build_array(${table.pk.map(quote).join(',')})::text AS key FROM public.${quote(table.name)}`)).rows.map(row=>row.key);
  preserved.push({...table,columns,keys,before:await digest(pool,table.name,columns,keys,table.pk)});
 }
 client=await pool.connect();await client.query('BEGIN');
 await client.query("SELECT pg_advisory_xact_lock(hashtext('weconnect_local_ai_upgrade'))");
 const applied=[];
 for(const name of ['006_exam_bank.sql','007_milestone_coaching.sql','008_company_marketplace.sql','009_question_results.sql']){
  const migration=name.replace('.sql','');
  if((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[migration])).rows.length)continue;
  const sql=(await readFile(root+'database/'+name,'utf8')).replace(/^\s*(?:BEGIN|COMMIT);\s*$/gmi,'');
  await client.query(sql);applied.push(migration);
 }
 // Existing attempts keep their original paper even after a new catalogue version is published.
 await client.query('UPDATE growth_attempts t SET paper_questions=v.questions FROM growth_activity_versions v WHERE t.activity_id=v.activity_id AND t.version=v.version AND t.paper_questions IS NULL');
 const versioned=[],authoredSkipped=[];
 for(const item of [...assessmentCatalog,...challengeCatalog]){
  const old=(await client.query(`SELECT a.id,a.published_version,v.* FROM growth_activities a JOIN growth_activity_versions v ON v.activity_id=a.id AND v.version=a.published_version WHERE a.slug=$1 FOR UPDATE OF a`,[item.slug])).rows[0];
  if(!old)continue;
  const authored=(await client.query('SELECT 1 FROM growth_activity_versions WHERE activity_id=$1 AND created_by IS NOT NULL LIMIT 1',[old.id])).rows.length;
  if(authored){authoredSkipped.push(item.slug);continue;}
  const expected={title:item.title,description:item.description,career_paths:item.careerPaths,duration_minutes:item.durationMinutes,pass_score:item.passScore,questions:item.questions,requirements:item.requirements};
  if(isDeepStrictEqual(Object.fromEntries(Object.keys(expected).map(key=>[key,old[key]])),expected))continue;
  const version=(await client.query('SELECT max(version)::int+1 AS next FROM growth_activity_versions WHERE activity_id=$1',[old.id])).rows[0].next;
  await client.query(`INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'published')`,[old.id,version,item.title,item.description,item.careerPaths,item.durationMinutes,item.passScore,JSON.stringify(item.questions),item.requirements]);
  await client.query('UPDATE growth_activities SET published_version=$2 WHERE id=$1',[old.id,version]);
  versioned.push({slug:item.slug,from:old.published_version,to:version});
 }
 for(const table of preserved)assert.deepEqual(await digest(client,table.name,table.columns,table.keys,table.pk),table.before,'Existing data changed in '+table.name);
 await client.query('COMMIT');client.release();client=null;
 const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM users) AS accounts,(SELECT count(*)::int FROM growth_activity_versions) AS content_versions,(SELECT count(*)::int FROM growth_attempts) AS attempts,(SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables`)).rows[0];
 const result={database:db,appliedAt:new Date().toISOString(),backup,applied,existingRowsPreserved:true,existingExamVersionsPreserved:true,versionedCatalog:versioned,authoredSkipped,counts};
 await writeFile(root+'.local/ai-upgrade-result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,versionedCatalog:versioned.length}));
}catch(error){if(client){await client.query('ROLLBACK');client.release();}console.error('Upgrade failed:',error.message);process.exitCode=1;}finally{await pool.end();}
