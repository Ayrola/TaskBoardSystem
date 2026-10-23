import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isOverdue, formatDeadline } from '../src/utils/deadlines.js';
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8');
const rows = async sql => (await db.query(sql)).rows;
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table auth.users(id uuid primary key); grant usage on schema auth to authenticated;`);
await db.exec(read('20261022163528_initial_schema.sql'));
await db.exec(`create table public.project_members(project_id uuid,user_id uuid,primary key(project_id,user_id));
create function public.can_access_project(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid()='${id(9)}' or exists(select 1 from public.projects where id=pid and owner_id=auth.uid())
or exists(select 1 from public.project_members where project_id=pid and user_id=auth.uid()) $$;`);
// Use the real ordering/locking RPCs rather than mocks.
const members = read('20261022180734_project_members.sql');
for (const name of ['lock_project_for_task_changes','tasks_sync_done','create_task','update_task','move_task']) {
  const match = members.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(match, name); await db.exec(match[0]);
}
const policies = await rows("select tablename,policyname from pg_policies where schemaname='public'");
for (const {tablename,policyname} of policies) await db.exec(`drop policy "${policyname}" on public."${tablename}"`);
await db.exec(`create policy projects_read on public.projects for select to authenticated using(public.can_access_project(id));
create policy stages_read on public.project_stages for select to authenticated using(public.can_access_project(project_id));
create policy tasks_access on public.tasks for all to authenticated using(public.can_access_project(project_id)) with check(public.can_access_project(project_id));`);
const path = process.env.DEADLINES_MIGRATION;
const sql = path ? readFileSync(path,'utf8') : read(readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_task_deadlines.sql')));
// Inject a test-only clock into the actual RPC body to exercise historical DST boundaries deterministically.
await db.exec(sql.replace('v_now timestamptz := statement_timestamp();', "v_now timestamptz := coalesce(nullif(current_setting('test.now',true),'')::timestamptz, statement_timestamp());"));
await db.exec(`insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(9)}');
insert into projects(id,title,owner_id) values('${id(10)}','Accessible','${id(1)}'),('${id(20)}','Private','${id(3)}');
insert into project_members values('${id(10)}','${id(2)}');
insert into project_stages(id,project_id,name,position,is_done) values
('${id(11)}','${id(10)}','Open',0,false),('${id(12)}','${id(10)}','Done',1,true),('${id(21)}','${id(20)}','Open',0,false);
insert into tasks(id,project_id,stage_id,title,position,due_at) values
('${id(101)}','${id(10)}','${id(11)}','Yesterday',0,'2026-03-07T12:00:00Z'),
('${id(102)}','${id(10)}','${id(11)}','Today midnight',1,'2026-03-08T05:00:00Z'),
('${id(103)}','${id(10)}','${id(11)}','Now',2,'2026-03-08T16:00:00Z'),
('${id(104)}','${id(10)}','${id(11)}','Last today',3,'2026-03-09T03:59:59Z'),
('${id(105)}','${id(10)}','${id(11)}','Tomorrow midnight',4,'2026-03-09T04:00:00Z'),
('${id(106)}','${id(10)}','${id(12)}','Completed overdue',0,'2026-03-07T12:00:00Z'),
('${id(107)}','${id(10)}','${id(11)}','No deadline',5,null),
('${id(201)}','${id(20)}','${id(21)}','Hidden overdue',0,'2026-03-07T12:00:00Z');
select set_config('test.now','2026-03-08T16:00:00Z',false);
set role authenticated; select set_config('test.uid','${id(2)}',false);`);
const page = async (bucket,zone='America/New_York',project='null',limit=20,offset=0) =>
  (await rows(`select deadlines_page('${bucket}','${zone}',${project},${limit},${offset}) as p`))[0].p;
let overdue=await page('overdue'); assert.equal(overdue.total,2); assert.deepEqual(overdue.rows.map(t=>t.title),['Yesterday','Today midnight']);
let today=await page('today'); assert.equal(today.total,3); assert.equal(today.rows.find(t=>t.title==='Now').overdue,false);
assert.equal(new Date(today.day_end)-new Date(today.day_start),23*3600000);
assert.equal((await page('upcoming')).rows[0].title,'Tomorrow midnight');
assert.equal((await page('overdue','America/New_York',`'${id(20)}'`)).total,0);
const a=await page('today','America/New_York','null',2,0), b=await page('today','America/New_York','null',2,2);
assert.equal(a.total,3); assert.equal(a.rows.length,2);assert.equal(b.rows.length,1);
assert.equal(new Set([...a.rows,...b.rows].map(t=>t.id)).size,3);
assert.ok(today.rows.every(t=>t.title!=='Completed overdue' && t.title!=='No deadline'));
assert.equal((await page('today','UTC')).total,2);
await assert.rejects(page('bad')); await assert.rejects(page('today','Invalid/Zone'));
// Preserve board order on deadline edits, and preserve deadlines through old clients/RPCs.
const before=await rows('select id,stage_id,position from tasks order by id');
await db.exec(`select update_task_with_deadline('${id(107)}','No deadline',null,'${id(11)}','2026-03-08T17:00:00Z')`);
assert.deepEqual(await rows('select id,stage_id,position from tasks order by id'),before);
await db.exec(`select update_task('${id(107)}','Old client edit',null,'${id(11)}')`);
assert.ok((await rows(`select due_at from tasks where id='${id(107)}'`))[0].due_at);
await db.exec(`select update_task_with_deadline('${id(107)}','Cleared',null,'${id(11)}',null)`);
assert.equal((await rows(`select due_at from tasks where id='${id(107)}'`))[0].due_at,null);
await db.exec(`select update_task_with_deadline('${id(102)}','Completed',null,'${id(12)}','2026-03-07T12:00:00Z')`);
assert.equal((await page('overdue')).total,1);
const created=(await rows(`select create_task_with_deadline('${id(10)}','${id(11)}','New task',null,'2026-03-10T00:00:00Z') as id`))[0].id;
assert.equal((await rows(`select position from tasks where id='${created}'`))[0].position,5);
await assert.rejects(db.exec(`select update_task_with_deadline('${id(201)}','Denied',null,'${id(21)}',null)`));
await assert.rejects(db.exec(`select create_task_with_deadline('${id(20)}','${id(21)}','Denied',null,null)`));
await assert.rejects(db.exec(`select update_task_with_deadline('${id(101)}','Must roll back',null,'${id(11)}','infinity')`));
assert.equal((await rows(`select title from tasks where id='${id(101)}'`))[0].title,'Yesterday');
await db.exec(`select set_config('test.now','2026-11-01T16:00:00Z',false)`);
today=await page('today'); assert.equal(new Date(today.day_end)-new Date(today.day_start),25*3600000);
await db.exec(`select set_config('test.now','2026-10-23T12:00:00Z',false)`);
const tokyo=await page('today','Asia/Tokyo'); assert.equal(new Date(tokyo.day_start).toISOString(),'2026-10-22T15:00:00.000Z');
await db.exec(`select set_config('test.uid','${id(9)}',false); select set_config('test.now','2026-03-08T16:00:00Z',false)`);
assert.equal((await page('overdue')).total,2);
await db.exec(`reset role; delete from project_members; set role authenticated; select set_config('test.uid','${id(2)}',false)`);
assert.equal((await page('overdue')).total,0);
await db.exec('set role anon'); await assert.rejects(page('overdue'));
await db.close();
assert.equal(isOverdue({done:true,dueAt:'2020-01-01T00:00:00Z'}),false);
assert.equal(isOverdue({done:false,dueAt:null}),false);
assert.equal(isOverdue({done:false,dueAt:'2020-01-01T00:00:00Z'}),true);
assert.notEqual(formatDeadline('2026-01-01T00:00:00Z','Asia/Tokyo'),formatDeadline('2026-01-01T00:00:00Z','UTC'));
const result=spawnSync(process.execPath,['--input-type=module','-e',`
import assert from 'node:assert/strict';
import {fromLocalDeadlineInput,toLocalDeadlineInput,deadlineFromEditor} from './src/utils/deadlines.js';
assert.equal(fromLocalDeadlineInput('2026-07-01T09:30'),'2026-07-01T13:30:00.000Z');
assert.equal(fromLocalDeadlineInput('2026-01-01T09:30'),'2026-01-01T14:30:00.000Z');
assert.equal(fromLocalDeadlineInput(''),null);
assert.throws(()=>fromLocalDeadlineInput('2026-03-08T02:30'));
assert.throws(()=>fromLocalDeadlineInput('2026-02-30T09:00'));
assert.throws(()=>fromLocalDeadlineInput('bad'));
assert.equal(fromLocalDeadlineInput('2026-11-01T01:30'),'2026-11-01T05:30:00.000Z');
const later='2026-11-01T06:30:42.123Z';
assert.equal(toLocalDeadlineInput(later),'2026-11-01T01:30');
assert.equal(deadlineFromEditor('2026-11-01T01:30',later),later);
assert.equal(deadlineFromEditor('',later),null);
`],{env:{...process.env,TZ:'America/New_York'},encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
console.log('PASS: deadline CRUD and atomic rollback, existing ordering, legacy saves, completed exclusion, RLS and roles, server pagination, timezone boundaries, 23/25-hour days, local conversion, DST gaps/folds, unchanged precision.');
