import { PGlite } from '@electric-sql/pglite';
import { readFileSync,readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { activitySummary } from '../src/utils/activity.js';
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const read=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const rows=async sql=>(await db.query(sql)).rows;
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table auth.users(id uuid primary key); grant usage on schema auth to authenticated;`);
await db.exec(read('20261022163528_initial_schema.sql'));
await db.exec(read('20261022163601_stage_done_sync_security_definer.sql'));
await db.exec(`create table project_members(project_id uuid,user_id uuid);
create function can_access_project(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid()='${id(9)}' or exists(select 1 from public.projects where id=pid and owner_id=auth.uid()) or exists(select 1 from public.project_members where project_id=pid and user_id=auth.uid()) $$;
create function can_manage_project(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid()='${id(9)}' or exists(select 1 from public.projects where id=pid and owner_id=auth.uid()) $$;`);
for (const [file,names] of [
  ['20261022180734_project_members.sql',['lock_project_for_task_changes','tasks_sync_done','create_task','update_task','delete_task']],
  ['20261022184825_pagination_large_boards.sql',['move_task','move_task_relative']],
  ['20261022182816_admin_console.sql',['delete_stage']],
]) for(const name of names) {
  const match=read(file).match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`));assert.ok(match,name); await db.exec(match[0]);
}
const policies=await rows("select tablename,policyname from pg_policies where schemaname='public'");
for(const {tablename,policyname} of policies) await db.exec(`drop policy "${policyname}" on public."${tablename}"`);
await db.exec(`create policy projects_read on projects for select to authenticated using(can_access_project(id));
create policy stages_read on project_stages for select to authenticated using(can_access_project(project_id));
create policy stages_update on project_stages for update to authenticated using(can_manage_project(project_id)) with check(can_manage_project(project_id));
create policy tasks_access on tasks for all to authenticated using(can_access_project(project_id)) with check(can_access_project(project_id));
insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(9)}');
insert into projects(id,title,owner_id) values('${id(10)}','Accessible','${id(1)}'),('${id(20)}','Private','${id(3)}');
insert into project_members values('${id(10)}','${id(2)}');
insert into project_stages(id,project_id,name,position,is_done) values
('${id(11)}','${id(10)}','Open',0,false),('${id(12)}','${id(10)}','Done',1,true),('${id(13)}','${id(10)}','Backup',2,false),('${id(21)}','${id(20)}','Private',0,false);
insert into tasks(id,project_id,stage_id,title,position) values
('${id(101)}','${id(10)}','${id(11)}','Task A',0),('${id(102)}','${id(10)}','${id(11)}','Task B',1),('${id(103)}','${id(10)}','${id(11)}','Task C',2),
('${id(104)}','${id(10)}','${id(13)}','Task D',0),('${id(105)}','${id(10)}','${id(13)}','Task E',1),('${id(201)}','${id(20)}','${id(21)}','Private task',0);`);
await db.exec(read('20261023064326_task_deadlines.sql'));
const migrationFile=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_task_activity.sql'));
const migration=process.env.ACTIVITY_MIGRATION ? readFileSync(process.env.ACTIVITY_MIGRATION,'utf8')
 : migrationFile ? read(migrationFile) : readFileSync(new URL('../supabase/pending/task_activity.sql',import.meta.url),'utf8');
await db.exec(migration);
assert.equal((await rows('select * from task_activity')).length,0); // no invented backfill
await db.exec(`set role authenticated; select set_config('test.uid','${id(2)}',false)`);
const events=async()=>rows('select * from task_activity order by id');
const count=async()=>(await events()).length;
const latest=async()=>(await events()).at(-1);
const created=(await rows(`select create_task_with_deadline('${id(10)}','${id(11)}','Created',null,now()+interval '1 day') as id`))[0].id;
assert.equal(await count(),1);assert.equal((await latest()).event_type,'created');assert.equal((await latest()).actor_id,id(2));
await db.exec(`update tasks set title='<b>Literal title</b>',description='<p>Do not duplicate private description</p>' where id='${created}'`);
assert.equal(await count(),2);let entry=await latest();
assert.equal(entry.changes.description_changed,true);assert.ok(!JSON.stringify(entry).includes('private description'));
assert.equal(entry.changes.title.to,'<b>Literal title</b>');
await db.exec(`update tasks set title=title,description=description where id='${created}'`);assert.equal(await count(),2);
await db.exec(`update tasks set due_at=now() where id='${created}'`);assert.equal(await count(),2);
// Multi-neighbour move: exactly one action, with all information on the moved task.
let before=await count();
await db.exec(`select move_task_relative('${id(103)}','${id(11)}',null,false)`);
assert.equal(await count(),before+1);entry=await latest();assert.equal(entry.task_id,id(103));assert.deepEqual(entry.changes.position,{from:2,to:0});
// Adjacent move (one neighbour) must not become a second action either.
before=await count();await db.exec(`select move_task('${id(103)}','${id(11)}',1)`);assert.equal(await count(),before+1);
// No-op movement produces no entry.
before=await count();await db.exec(`select move_task('${id(103)}','${id(11)}',1)`);assert.equal(await count(),before);
// Cross-stage move with completion and source renumbering is one combined entry.
await db.exec(`select move_task_relative('${id(103)}','${id(12)}',null,true)`);
assert.equal(await count(),before+1);entry=await latest();assert.equal(entry.task_id,id(103));assert.equal(entry.changes.stage.from_name,'Open');assert.equal(entry.changes.stage.to_name,'Done');assert.deepEqual(entry.changes.completed,{from:false,to:true});
// Context is cleaned on success and failure, and browser-controlled settings cannot suppress auditing.
await assert.rejects(db.exec(`select move_task('${id(101)}','${id(21)}',0)`));
await db.exec("select set_config('taskboard.audit_suppressed','true',false); select set_config('taskboard.actor_id','forged',false)");
before=await count();await db.exec(`update tasks set position=25 where id='${created}'`);assert.equal(await count(),before+1);assert.equal((await latest()).actor_id,id(2));
await assert.rejects(db.exec(`insert into task_activity(project_id,task_id,task_title,actor_id,event_type,changes) values('${id(10)}','${created}','Forged','${id(3)}','created','{}')`));
await assert.rejects(db.exec('update task_activity set task_title=\'Forged\''));
await assert.rejects(db.exec('delete from task_activity'));
await assert.rejects(db.exec(`insert into private.task_activity_context values(txid_current(),'${id(10)}',null)`));
await assert.rejects(db.exec(`select private.activity_move_task_impl('${id(101)}','${id(11)}',0)`));
await assert.rejects(db.exec(`select private.run_task_order_action('move','${id(201)}','${id(21)}',0)`));
await assert.rejects(db.exec(`select delete_stage('${id(13)}','${id(12)}')`)); // member cannot manage stages
// Deleting a task retains its audit snapshot, suppresses neighbour gap-closing, and removes the live link.
before=await count();await db.exec(`select delete_task('${id(101)}')`);assert.equal(await count(),before+1);
entry=await latest();assert.equal(entry.event_type,'deleted');assert.equal(entry.task_title,'Task A');
const taskPage=await rows(`select task_activity_page('${id(10)}','${id(101)}',20,0) as page`);
assert.equal(taskPage[0].page.rows[0].task_exists,false);assert.equal(taskPage[0].page.rows[0].id,String(entry.id));
// Transaction rollback rolls back audit rows as well as the mutation.
before=await count();await db.exec(`begin; update tasks set title='Rolled back' where id='${id(102)}'; rollback;`);assert.equal(await count(),before);
await db.exec(`select set_config('test.uid','${id(1)}',false)`);
// Stage removal logs moved source tasks, not any existing destination renumbering.
before=await count();await db.exec(`select delete_stage('${id(13)}','${id(12)}')`);assert.equal(await count(),before+2);
assert.ok((await events()).slice(-2).every(e=>[id(104),id(105)].includes(e.task_id)&&e.changes.stage));
// Stage completion propagation logs the real completion changes on affected tasks.
before=await count();const openCount=(await rows(`select count(*)::int as n from tasks where stage_id='${id(11)}'`))[0].n;
await db.exec(`update project_stages set is_done=true where id='${id(11)}'`);assert.equal(await count(),before+openCount);
// Stable newest-first server pagination and task/project filters.
const page1=(await rows(`select task_activity_page('${id(10)}',null,3,0) as page`))[0].page;
const page2=(await rows(`select task_activity_page('${id(10)}',null,3,3) as page`))[0].page;
assert.equal(page1.rows.length,3);assert.equal(page2.rows.length,3);assert.equal(new Set([...page1.rows,...page2.rows].map(e=>e.id)).size,6);
assert.ok(page1.rows.every((e,i,a)=>i===0||new Date(a[i-1].created_at)>=new Date(e.created_at)));
assert.equal((await rows(`select task_activity_page('${id(20)}') as page`))[0].page.total,0);
const snapshot=page1.snapshot_id;
const frozenCount=page1.total;
await db.exec(`update tasks set title='New event after snapshot' where id='${id(102)}'`);
const frozen=(await rows(`select task_activity_page('${id(10)}',null,3,3,${snapshot}) as page`))[0].page;
assert.equal(frozen.total,frozenCount);assert.deepEqual(frozen.rows.map(e=>e.id),page2.rows.map(e=>e.id));
await db.exec(`select set_config('test.uid','${id(3)}',false)`);assert.equal(await count(),0);
await db.exec(`update tasks set title='Private update' where id='${id(201)}'`);assert.equal(await count(),1);
await db.exec(`select set_config('test.uid','${id(9)}',false)`);assert.equal(await count(),page1.total+2);
await assert.rejects(db.exec('delete from task_activity')); // even app admins cannot alter history
await db.exec(`reset role; select set_config('test.uid','',false); update tasks set title='System update' where id='${id(201)}'`);
assert.equal((await latest()).actor_id,null);
assert.equal((await rows('select * from private.task_activity_context')).length,0);
await db.exec(`delete from project_members; set role authenticated; select set_config('test.uid','${id(2)}',false)`);assert.equal(await count(),0);
await db.exec(`reset role; select set_config('test.uid','',false); delete from projects where id='${id(10)}'`);
assert.equal((await rows(`select * from task_activity where project_id='${id(10)}'`)).length,0);
await db.exec('set role anon');await assert.rejects(db.exec('select * from task_activity'));await assert.rejects(db.exec('select task_activity_page()'));
await db.close();
assert.equal(activitySummary({event_type:'updated',changes:{description_changed:true}}),'Description changed.');
assert.match(activitySummary({event_type:'updated',changes:{position:{from:0,to:2},completed:{to:false}}}),/Position changed from 1 to 3.*Reopened/);
console.log('PASS: creation/content/stage/position/completion/deletion, immutable server actors, private context, one-event moves/deletes, no-op/rollback, stage propagation, snapshots, no rich text, pagination, RLS, admin/member/owner/system/anon and revoked access.');
