import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { boardFiltersFromQuery, matchesBoardTask } from '../src/utils/board-filters.js';
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table auth.users(id uuid primary key);grant usage on schema auth to authenticated;`);
await db.exec(read('20261022163528_initial_schema.sql'));
await db.exec(`create table project_members(project_id uuid,user_id uuid);
create function can_access_project(pid uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid()='${id(9)}' or exists(select 1 from public.projects where id=pid and owner_id=auth.uid()) or exists(select 1 from public.project_members where project_id=pid and user_id=auth.uid())$$;
create table task_assignees(task_id uuid references tasks(id) on delete cascade,user_id uuid,primary key(task_id,user_id));
create table task_activity(id bigint generated always as identity primary key,project_id uuid,task_id uuid,task_title text,event_type text,changes jsonb,created_at timestamptz default now());
alter table task_assignees enable row level security;alter table task_activity enable row level security;
grant select on task_assignees,task_activity to authenticated;
create policy assignments_read on task_assignees for select to authenticated using(exists(select 1 from tasks where id=task_id));
create policy activity_read on task_activity for select to authenticated using(can_access_project(project_id));
create function list_task_assignees(p_task_ids uuid[]) returns table(task_id uuid,user_id uuid,label text) language sql stable security invoker set search_path='' as $$select a.task_id,a.user_id,'Person '||right(a.user_id::text,2) from public.task_assignees a where task_id=any(p_task_ids)$$;`);
for(const row of (await db.query("select tablename,policyname from pg_policies where schemaname='public' and tablename in ('projects','tasks','project_stages')")).rows)await db.exec(`drop policy "${row.policyname}" on public."${row.tablename}"`);
await db.exec(`create policy projects_read on projects for select to authenticated using(can_access_project(id));
create policy tasks_read on tasks for select to authenticated using(can_access_project(project_id));
create policy stages_read on project_stages for select to authenticated using(can_access_project(project_id));
insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(9)}');
insert into projects(id,title,owner_id)values('${id(10)}','Analytics','${id(1)}'),('${id(20)}','Empty','${id(1)}'),('${id(30)}','Private','${id(3)}');
insert into project_members values('${id(10)}','${id(2)}');
insert into project_stages(id,project_id,name,position,is_done)values('${id(11)}','${id(10)}','Custom review',4,false),('${id(12)}','${id(10)}','Accepted',8,true),('${id(31)}','${id(30)}','Private',0,false);
insert into tasks(id,project_id,stage_id,title,position,created_at)
select ('00000000-0000-0001-0000-'||lpad(n::text,12,'0'))::uuid,'${id(10)}','${id(11)}','Task '||n,n,case when n=1 then now()-interval '120 days' when n=2 then now()+interval '2 days' else now()-interval '1 hour' end from generate_series(1,1205) n;
insert into tasks(id,project_id,stage_id,title,position)values('${id(100)}','${id(30)}','${id(31)}','Hidden',0);
update tasks set stage_id='${id(12)}' where position<=5 and project_id='${id(10)}';
alter table tasks add column due_at timestamptz;
update tasks set due_at=now()-interval '1 day' where project_id='${id(10)}' and position in (1,6);
update tasks set due_at=now()+interval '1 day' where project_id='${id(10)}' and position in (2,7);
insert into task_assignees select id,'${id(1)}' from tasks where project_id='${id(10)}' and position in(6,7);
insert into task_assignees select id,'${id(2)}' from tasks where project_id='${id(10)}' and position=6;
insert into task_activity(project_id,task_id,task_title,event_type,changes,created_at) values
('${id(10)}',null,'Deleted task','deleted','{}',now()-interval '1 hour'),
('${id(10)}',null,'Old task','created','{}',now()-interval '100 days'),
('${id(30)}','${id(100)}','Private activity','created','{}',now());`);

await db.exec(`create table project_labels(id uuid primary key,project_id uuid,name text,colour text);
create table task_labels(task_id uuid,label_id uuid,project_id uuid,primary key(task_id,label_id));
alter table project_labels enable row level security;alter table task_labels enable row level security;
grant select on project_labels,task_labels to authenticated;
create policy labels_read on project_labels for select to authenticated using(can_access_project(project_id));
create policy links_read on task_labels for select to authenticated using(can_access_project(project_id));
insert into project_labels values('${id(31)}','${id(10)}','Клиент','#4488aa'),('${id(32)}','${id(10)}','Product','#228844'),('${id(33)}','${id(30)}','Private','#ffffff');
insert into task_labels select id,'${id(31)}','${id(10)}' from tasks where project_id='${id(10)}';
insert into task_labels select id,'${id(32)}','${id(10)}' from tasks where project_id='${id(10)}' and position=6;
insert into task_activity(project_id,task_id,task_title,event_type,changes,created_at)
select '${id(10)}',id,title,'updated','{"completed":{"from":false,"to":true},"stage":{"from_id":"${id(11)}","to_id":"${id(12)}"}}',now()-interval '30 minutes' from tasks where project_id='${id(10)}' and position=1;`);
const file=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_project_statistics_report.sql'));
await db.exec(read(file));
const get=async(project=id(10),days=30,start=null,end=null,tz='Europe/Sofia')=>(await db.query('select project_statistics_report($1,$2,$3,$4,$5) data',[project,days,start,end,tz])).rows[0].data;
await db.exec(`set role authenticated;set test.uid='${id(1)}'`);
const snapshot=await get();assert.equal(snapshot.tasks.length,1205);assert.equal(snapshot.project.id,id(10));assert.equal(snapshot.labels.length,2);assert.ok(snapshot.tasks.every(t=>t.project_id===id(10)));assert.ok(snapshot.events.every(e=>e.task_title===undefined&&e.actor_id===undefined));
assert.equal(snapshot.tasks.find(t=>t.position===6).label_ids.length,2);assert.ok(snapshot.tasks.find(t=>t.position===1).completed_at);assert.equal(snapshot.tasks.find(t=>t.position===6).completed_at,null);
const empty=await get(id(20));assert.deepEqual(empty.tasks,[]);assert.deepEqual(empty.people,[]);
const dst=await get(id(10),null,'2026-03-29','2026-03-29');assert.equal((Date.parse(dst.meta.end_exclusive)-Date.parse(dst.meta.start_at))/3600000,23);
for(const args of [[id(10),8],[id(10),null,null,null],[id(10),null,'2026-10-25','2026-10-24'],[id(10),null,'2026-10-25','2026-10-26'],[id(10),7,null,null,'Bad/Zone']])await assert.rejects(get(...args));
await assert.rejects(get(id(30)));
await db.exec(`set test.uid='${id(2)}'`);assert.equal((await get()).tasks.length,1205);await assert.rejects(get(id(20)));
await db.exec(`set test.uid='${id(9)}'`);assert.equal((await get(id(30))).tasks.length,1);
await db.exec(`set test.uid='${id(3)}'`);await assert.rejects(get());
await db.exec('set role anon');await assert.rejects(get());
await db.exec('reset role');assert.equal((await db.query("select prosecdef from pg_proc where proname='project_statistics_report'")).rows[0].prosecdef,false);
await db.close();console.log('PASS: report snapshot covers 1205 tasks, scoped labels/assignees/events, recorded completion dates only, empty data, DST/custom ranges, owner/member/admin/outsider/anon and SECURITY INVOKER.');
