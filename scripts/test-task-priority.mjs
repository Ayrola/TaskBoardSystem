import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite(),id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const read=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8').replace(/^\uFEFF/,'');
await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',deleted_at timestamptz);grant usage on schema auth to authenticated;`);
await db.exec(read('20261022163528_initial_schema.sql'));
await db.exec(`create table public.project_members(project_id uuid,user_id uuid,primary key(project_id,user_id));
create function public.can_access_project(pid uuid) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid()='${id(9)}' or exists(select 1 from public.projects where id=pid and owner_id=auth.uid()) or exists(select 1 from public.project_members where project_id=pid and user_id=auth.uid()) $$;
create function public.can_manage_project(pid uuid) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid()='${id(9)}' or exists(select 1 from public.projects where id=pid and owner_id=auth.uid()) $$;
create function public.board_notify(uuid,text) returns void language sql as $$ select $$;revoke all on function board_notify(uuid,text) from public,anon,authenticated;`);
const members=read('20261022180734_project_members.sql');
for(const name of ['lock_project_for_task_changes','tasks_sync_done','create_task','update_task','move_task']){
 const match=members.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`));assert.ok(match,name);await db.exec(match[0]);
}
for(const row of (await db.query("select tablename,policyname from pg_policies where schemaname='public'")).rows)await db.exec(`drop policy "${row.policyname}" on public."${row.tablename}"`);
await db.exec(`create policy projects_read on projects for select to authenticated using(can_access_project(id));create policy stages_read on project_stages for select to authenticated using(can_access_project(project_id));create policy tasks_access on tasks for all to authenticated using(can_access_project(project_id)) with check(can_access_project(project_id));grant select on project_members to authenticated;`);
await db.exec('alter table tasks add constraint tasks_id_project_key unique(id,project_id)');
for(const file of ['20261022185944_task_assignees.sql','20261023063143_project_labels.sql','20261023063225_project_labels_indexes.sql','20261023064326_task_deadlines.sql','20261023065102_task_checklists.sql','20261025163858_task_form_drafts.sql'])await db.exec(read(file));
await db.exec(`insert into auth.users(id,email)values('${id(1)}','owner@test'),('${id(2)}','member@test'),('${id(3)}','other@test'),('${id(9)}','admin@test');
insert into projects(id,title,owner_id)values('${id(10)}','Alpha','${id(1)}'),('${id(20)}','Beta','${id(3)}');
insert into project_stages(id,project_id,name,position,is_done)values('${id(11)}','${id(10)}','Open',0,false),('${id(12)}','${id(10)}','Done',1,true),('${id(21)}','${id(20)}','Other',0,false);
insert into project_members values('${id(10)}','${id(2)}');insert into project_labels(id,project_id,name,colour)values('${id(31)}','${id(10)}','Product','#ffffff'),('${id(32)}','${id(20)}','Private','#000000');`);

await db.exec(read('20261023070428_task_activity.sql'));
await db.exec(`create table notification_checks(project_id uuid);create or replace function board_notify(pid uuid,event text) returns void language sql as $$insert into public.notification_checks values(pid)$$;`);
const broadcast=read('20261022181351_realtime_board_notifications.sql');await db.exec(broadcast.slice(broadcast.indexOf('create function public.tasks_notify_board()'),broadcast.indexOf('-- Membership changes')));
const oldTask=(await db.query(`insert into tasks(project_id,stage_id,title,description,position)values('${id(10)}','${id(11)}','Preserved legacy task','<p>Keep me</p>',0) returning id`)).rows[0].id;
const before=(await db.query('select to_jsonb(t) data from tasks t where id=$1',[oldTask])).rows[0].data;
const beforeEvents=(await db.query('select count(*)::int n from task_activity')).rows[0].n;
const migration=(await import('node:fs')).readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_task_priority.sql'));
await db.exec(read(migration));
assert.deepEqual((await db.query("select to_jsonb(t)-'priority' data from tasks t where id=$1",[oldTask])).rows[0].data,before,'Migration preserves every old field');
assert.equal((await db.query('select priority from tasks where id=$1',[oldTask])).rows[0].priority,'medium');assert.equal((await db.query('select count(*)::int n from task_activity')).rows[0].n,beforeEvents,'No invented migration activity');
const raw=async sql=>(await db.query(sql)).rows;
const create=async priority=>(await db.query('select create_task_with_priority($1,$2,$3,$4,$5,$6) id',[id(10),id(11),'Priority task',null,null,priority])).rows[0].id;
const draft=priority=>({title:'Draft priority task',description:null,stage_id:id(11),due_at:null,priority,label_ids:[],assignee_ids:[],checklist:[]});
const save=async(values,task=null,request=crypto.randomUUID())=>(await db.query('select save_task_form($1,$2,$3,$4,$5) id',[id(10),task,request,values,task?[]:null])).rows[0].id;
await db.exec(`set role authenticated;set test.uid='${id(2)}'`);
for(const priority of ['low','medium','high','urgent']){
 const task=await create(priority);assert.equal((await db.query('select priority from tasks where id=$1',[task])).rows[0].priority,priority);
 const request=crypto.randomUUID(),full=await save(draft(priority),null,request);assert.equal(await save(draft(priority),null,request),full,'Safe retry');
 await assert.rejects(save(draft(priority==='urgent'?'high':'urgent'),null,request),/already created/);
 await save({...draft(priority),title:before.title,description:before.description},oldTask);
 assert.equal((await db.query('select priority from tasks where id=$1',[oldTask])).rows[0].priority,priority);
}
for(const priority of ['','critical','URGENT',null]){
 await assert.rejects(create(priority));await assert.rejects(save(draft(priority)));
 await assert.rejects(db.query('update tasks set priority=$1 where id=$2',[priority,oldTask]));
}
const legacyDraft=draft('urgent');delete legacyDraft.priority;await save({...legacyDraft,title:'Legacy edit'},oldTask);assert.equal((await db.query('select priority from tasks where id=$1',[oldTask])).rows[0].priority,'urgent','Old client edit preserves Urgent');
await db.query("update tasks set due_at='2030-01-01T17:00:00Z' where id=$1",[oldTask]);
await db.query('select update_task_with_priority($1,$2,$3,$4,$5,$6,$7)',[oldTask,'Legacy edit',null,id(11),null,'urgent',true]);
assert.equal(new Date((await db.query('select due_at from tasks where id=$1',[oldTask])).rows[0].due_at).toISOString(),'2030-01-01T17:00:00.000Z','Priority-aware RPC preserves an omitted deadline');
await db.exec(`reset role`);const prior=(await raw('select count(*)::int n from task_activity'))[0].n;const priorNotify=(await raw('select count(*)::int n from notification_checks'))[0].n;
await db.exec(`set role authenticated;set test.uid='${id(2)}'`);await db.query("update tasks set priority='high' where id=$1",[oldTask]);
const event=(await db.query('select changes from task_activity where task_id=$1 order by id desc limit 1',[oldTask])).rows[0].changes;
assert.deepEqual(event.priority,{from:'urgent',to:'high'});
await db.exec('reset role');assert.equal((await raw('select count(*)::int n from task_activity'))[0].n,prior+1);assert.equal((await raw('select count(*)::int n from notification_checks'))[0].n,priorNotify+1,'Priority changes reuse board notification');
await db.exec(`set role authenticated;set test.uid='${id(3)}'`);assert.equal((await db.query("update tasks set priority='low' where id=$1 returning id",[oldTask])).rows.length,0);await assert.rejects(create('urgent'));
await db.exec(`set test.uid='${id(9)}'`);await db.query("update tasks set priority='urgent' where id=$1",[oldTask]);assert.equal((await db.query('select priority from tasks where id=$1',[oldTask])).rows[0].priority,'urgent');
const dashboard=(await db.query('select project_dashboard($1,7,$2) data',[id(10),'Europe/Sofia'])).rows[0].data;
assert.equal(dashboard.priorities.reduce((n,p)=>n+p.count,0),dashboard.totals.total);assert.ok(dashboard.totals.urgent_open>0);assert.ok(dashboard.totals.high_open>0);assert.equal(dashboard.totals.overdue,0,'Priority is not an overdue deadline');
const report=(await db.query('select project_statistics_report($1,7,null,null,$2) data',[id(10),'Europe/Sofia'])).rows[0].data;assert.ok(report.tasks.every(t=>['low','medium','high','urgent'].includes(t.priority)));
await db.exec('set role anon');await assert.rejects(create('high'));await assert.rejects(db.query('select project_dashboard($1)',[id(10)]));
await db.exec('reset role');assert.ok((await raw("select prosecdef from pg_proc where proname in ('save_task_form','create_task_with_priority','update_task_with_priority')")).every(r=>r.prosecdef===false));
await db.close();console.log('PASS: Medium backfill preserves all fields/history, every priority create/edit/default/retry, invalid values, legacy urgent preservation, direct RLS denial, member/admin access, server activity and Realtime, full-project dashboard/report counts.');
