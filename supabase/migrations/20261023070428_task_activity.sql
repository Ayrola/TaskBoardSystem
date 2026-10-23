create table public.task_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null, -- deliberately no task FK: keep the reference after deletion
  task_title text not null,
  actor_id uuid, -- server auth.uid(); no user FK or email/metadata snapshot
  event_type text not null check(event_type in ('created','updated','deleted')),
  changes jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index task_activity_project_time_idx on public.task_activity(project_id,created_at desc,id desc);
create index task_activity_task_time_idx on public.task_activity(task_id,created_at desc,id desc);
create index task_activity_time_idx on public.task_activity(created_at desc,id desc);
alter table public.task_activity enable row level security;
revoke all on public.task_activity from public,anon,authenticated;
revoke all on sequence public.task_activity_id_seq from public,anon,authenticated;
grant select on public.task_activity to authenticated;
create policy task_activity_read on public.task_activity for select to authenticated
using(public.can_access_project(project_id));

create schema if not exists private;
-- No client can read/write this context or suppress the trigger with a session setting.
create table private.task_activity_context (
  transaction_id bigint primary key,
  project_id uuid not null,
  target_task_id uuid
);
revoke all on private.task_activity_context from public,anon,authenticated;

create function private.record_task_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_task public.tasks%rowtype; v_actor uuid := auth.uid(); v_changes jsonb := '{}'::jsonb;
  v_event text; v_old_stage text; v_new_stage text;
begin
  if tg_op='DELETE' then v_task:=old; else v_task:=new; end if;
  -- Project deletion removes its history; do not recreate it during a cascade.
  if not exists(select 1 from public.projects where id=v_task.project_id) then return null; end if;
  if v_actor is not null and not public.can_access_project(v_task.project_id) then
    raise exception 'Project not found' using errcode='P0002';
  end if;
  if tg_op='UPDATE' then
    if old.title is distinct from new.title then
      v_changes:=v_changes || jsonb_build_object('title',jsonb_build_object('from',old.title,'to',new.title));
    end if;
    if old.description is distinct from new.description then
      v_changes:=v_changes || jsonb_build_object('description_changed',true);
    end if;
    if old.stage_id is distinct from new.stage_id then
      select name into v_old_stage from public.project_stages where id=old.stage_id;
      select name into v_new_stage from public.project_stages where id=new.stage_id;
      v_changes:=v_changes || jsonb_build_object('stage',jsonb_build_object('from_id',old.stage_id,'from_name',v_old_stage,'to_id',new.stage_id,'to_name',v_new_stage));
    end if;
    if old.done is distinct from new.done then
      v_changes:=v_changes || jsonb_build_object('completed',jsonb_build_object('from',old.done,'to',new.done));
    end if;
    if old.position is distinct from new.position then
      if v_changes='{}'::jsonb and exists(select 1 from private.task_activity_context c
        where c.transaction_id=txid_current() and c.project_id=new.project_id and c.target_task_id is distinct from new.id) then
        return null;
      end if;
      v_changes:=v_changes || jsonb_build_object('position',jsonb_build_object('from',old.position,'to',new.position));
    end if;
    if v_changes='{}'::jsonb then return null; end if;
    v_event:='updated';
  else
    select name into v_new_stage from public.project_stages where id=v_task.stage_id;
    v_changes:=jsonb_build_object('stage',jsonb_build_object('id',v_task.stage_id,'name',v_new_stage),'position',v_task.position,'completed',v_task.done);
    v_event:=case when tg_op='INSERT' then 'created' else 'deleted' end;
  end if;
  insert into public.task_activity(project_id,task_id,task_title,actor_id,event_type,changes)
  values(v_task.project_id,v_task.id,v_task.title,v_actor,v_event,v_changes);
  return null;
end;
$$;
revoke all on function private.record_task_activity() from public,anon,authenticated;
create trigger tasks_record_activity after insert or update or delete on public.tasks
for each row execute function private.record_task_activity();

-- Existing mutation implementation; callable only by the controlled dispatcher.
create or replace function private.activity_move_task_impl(
  p_task_id uuid,
  p_stage_id uuid,
  p_index integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_src_stage uuid;
  v_src_pos integer;
  v_dest_count integer;
  v_index integer;
  v_done boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_task_id is null or p_stage_id is null then
    raise exception 'Task and stage are required' using errcode = '22023';
  end if;
  if p_index is null or p_index < 0 then
    raise exception 'Invalid destination index' using errcode = '22023';
  end if;

  select t.project_id into v_project_id
  from public.tasks t
  where t.id = p_task_id;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if not public.lock_project_for_task_changes(v_project_id) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  select t.stage_id, t.position into v_src_stage, v_src_pos
  from public.tasks t
  where t.id = p_task_id and t.project_id = v_project_id
  for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  perform 1 from public.project_stages s
  where s.id = p_stage_id and s.project_id = v_project_id;
  if not found then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;

  select count(*) into v_dest_count
  from public.tasks t
  where t.stage_id = p_stage_id and t.id <> p_task_id;

  -- An index past the end means "append".
  v_index := least(p_index, v_dest_count);

  update public.tasks t
  set position = d.new_pos
  from (
    select x.id, case when x.rn < v_index then x.rn else x.rn + 1 end as new_pos
    from (
      select s.id, (row_number() over (order by s.position, s.id) - 1)::integer as rn
      from public.tasks s
      where s.stage_id = p_stage_id and s.id <> p_task_id
    ) x
  ) d
  where t.id = d.id and t.position <> d.new_pos;

  if v_src_stage <> p_stage_id then
    update public.tasks set stage_id = p_stage_id, position = v_index where id = p_task_id;
  else
    update public.tasks set position = v_index where id = p_task_id;
  end if;

  if v_src_stage <> p_stage_id then
    update public.tasks t
    set position = s.rn
    from (
      select o.id, (row_number() over (order by o.position, o.id) - 1)::integer as rn
      from public.tasks o
      where o.stage_id = v_src_stage
    ) s
    where t.id = s.id and t.position <> s.rn;
  end if;

  select t.done into v_done from public.tasks t where t.id = p_task_id;

  return jsonb_build_object(
    'task_id', p_task_id,
    'project_id', v_project_id,
    'source_stage_id', v_src_stage,
    'stage_id', p_stage_id,
    'position', v_index,
    'done', v_done,
    'changed', (v_src_stage <> p_stage_id or v_src_pos <> v_index),
    'source_count', (select count(*) from public.tasks t where t.stage_id = v_src_stage),
    'dest_count', (select count(*) from public.tasks t where t.stage_id = p_stage_id)
  );
end;
$$;

-- Existing mutation implementation; callable only by the controlled dispatcher.
create or replace function private.activity_delete_task_impl(p_task_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_stage_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select t.project_id into v_project_id from public.tasks t where t.id = p_task_id;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if not public.lock_project_for_task_changes(v_project_id) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  delete from public.tasks t
  where t.id = p_task_id and t.project_id = v_project_id
  returning t.stage_id into v_stage_id;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  update public.tasks t
  set position = s.rn
  from (
    select o.id, (row_number() over (order by o.position, o.id) - 1)::integer as rn
    from public.tasks o
    where o.stage_id = v_stage_id
  ) s
  where t.id = s.id and t.position <> s.rn;

  return v_stage_id;
end;
$$;

-- Existing mutation implementation; callable only by the controlled dispatcher.
create or replace function private.activity_delete_stage_impl(p_stage_id uuid, p_target_stage_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_stage_total integer;
  v_task_total integer;
  v_base integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_stage_id is null then
    raise exception 'Stage is required' using errcode = '22023';
  end if;

  select s.project_id into v_project_id from public.project_stages s where s.id = p_stage_id;
  if not found or not public.can_manage_project(v_project_id) then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;

  perform 1 from public.projects p where p.id = v_project_id for no key update;
  perform 1 from public.project_stages s where s.id = p_stage_id and s.project_id = v_project_id for update;
  if not found then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;

  select count(*) into v_stage_total from public.project_stages s where s.project_id = v_project_id;
  if v_stage_total < 2 then
    raise exception 'A project must keep at least one stage' using errcode = '23514';
  end if;

  select count(*) into v_task_total from public.tasks t where t.stage_id = p_stage_id;

  if v_task_total > 0 then
    if p_target_stage_id is null then
      raise exception 'Choose a stage to move the tasks to' using errcode = '22023';
    end if;
    if p_target_stage_id = p_stage_id then
      raise exception 'The destination must be a different stage' using errcode = '22023';
    end if;
    perform 1 from public.project_stages s
    where s.id = p_target_stage_id and s.project_id = v_project_id for share;
    if not found then
      raise exception 'The destination stage must belong to the same project' using errcode = '22023';
    end if;

    select coalesce(max(t.position) + 1, 0) into v_base from public.tasks t where t.stage_id = p_target_stage_id;

    update public.tasks t
    set stage_id = p_target_stage_id, position = v_base + m.rn
    from (
      select o.id, (row_number() over (order by o.position, o.id) - 1)::integer as rn
      from public.tasks o
      where o.stage_id = p_stage_id
    ) m
    where t.id = m.id;

    update public.tasks t
    set position = n.rn
    from (
      select o.id, (row_number() over (order by o.position, o.id) - 1)::integer as rn
      from public.tasks o
      where o.stage_id = p_target_stage_id
    ) n
    where t.id = n.id and t.position <> n.rn;
  end if;

  delete from public.project_stages s where s.id = p_stage_id and s.project_id = v_project_id;

  update public.project_stages s
  set position = n.rn
  from (
    select o.id, (row_number() over (order by o.position, o.id) - 1)::integer as rn
    from public.project_stages o
    where o.project_id = v_project_id
  ) n
  where s.id = n.id and s.position <> n.rn;

  return jsonb_build_object(
    'project_id', v_project_id,
    'deleted_stage_id', p_stage_id,
    'target_stage_id', case when v_task_total > 0 then p_target_stage_id end,
    'moved_tasks', v_task_total
  );
end;
$$;

revoke all on function private.activity_move_task_impl(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function private.activity_delete_task_impl(uuid) from public,anon,authenticated;
revoke all on function private.activity_delete_stage_impl(uuid,uuid) from public,anon,authenticated;

-- This private entry point is the only way to establish trusted renumbering context.
-- Explicit project authorization is required before entering the privileged implementation.
create function private.run_task_order_action(p_action text,p_subject_id uuid,p_stage_id uuid default null,p_index integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project uuid; v_previous private.task_activity_context%rowtype; v_had_context boolean; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_action='delete_stage' then
    select project_id into v_project from public.project_stages where id=p_subject_id;
    if not found or not public.can_manage_project(v_project) then raise exception 'Stage not found' using errcode='P0002'; end if;
  elsif p_action in ('move','delete') then
    select project_id into v_project from public.tasks where id=p_subject_id;
    if not found or not public.can_access_project(v_project) then raise exception 'Task not found' using errcode='P0002'; end if;
  else
    raise exception 'Invalid task action' using errcode='22023';
  end if;
  if not public.lock_project_for_task_changes(v_project) then raise exception 'Project not found' using errcode='P0002'; end if;
  select * into v_previous from private.task_activity_context where transaction_id=txid_current();
  v_had_context:=found;
  insert into private.task_activity_context(transaction_id,project_id,target_task_id)
  values(txid_current(),v_project,case when p_action='move' then p_subject_id else null end)
  on conflict(transaction_id) do update set project_id=excluded.project_id,target_task_id=excluded.target_task_id;
  if p_action='move' then v_result:=private.activity_move_task_impl(p_subject_id,p_stage_id,p_index);
  elsif p_action='delete' then v_result:=to_jsonb(private.activity_delete_task_impl(p_subject_id));
  else v_result:=private.activity_delete_stage_impl(p_subject_id,p_stage_id);
  end if;
  if v_had_context then
    update private.task_activity_context set project_id=v_previous.project_id,target_task_id=v_previous.target_task_id where transaction_id=txid_current();
  else
    delete from private.task_activity_context where transaction_id=txid_current();
  end if;
  return v_result;
end;
$$;
revoke all on function private.run_task_order_action(text,uuid,uuid,integer) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.run_task_order_action(text,uuid,uuid,integer) to authenticated;

-- Keep existing public signatures and OIDs; existing editors and move-relative RPCs use these wrappers.
create or replace function public.move_task(p_task_id uuid,p_stage_id uuid,p_index integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.run_task_order_action('move',p_task_id,p_stage_id,p_index);
$$;
create or replace function public.delete_task(p_task_id uuid)
returns uuid language sql security invoker set search_path='' as $$
  select (private.run_task_order_action('delete',p_task_id) #>> '{}')::uuid;
$$;
create or replace function public.delete_stage(p_stage_id uuid,p_target_stage_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.run_task_order_action('delete_stage',p_stage_id,p_target_stage_id);
$$;
revoke all on function public.move_task(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.delete_task(uuid) from public,anon,authenticated;
revoke all on function public.delete_stage(uuid,uuid) from public,anon,authenticated;
grant execute on function public.move_task(uuid,uuid,integer) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;
grant execute on function public.delete_stage(uuid,uuid) to authenticated;

create function public.task_activity_page(p_project_id uuid default null,p_task_id uuid default null,p_limit integer default 20,p_offset integer default 0,p_snapshot_id bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_snapshot bigint;
begin
  -- Freeze the append-only boundary across page links so new events do not shift older pages.
  if p_snapshot_id is null then select coalesce(max(id),0) into v_snapshot from public.task_activity;
  else v_snapshot:=greatest(p_snapshot_id,0); end if;
  return (select jsonb_build_object(
    'snapshot_id',v_snapshot::text,
    'total',(select count(*) from public.task_activity a where a.id<=v_snapshot and (p_project_id is null or a.project_id=p_project_id) and (p_task_id is null or a.task_id=p_task_id)),
    'rows',coalesce((select jsonb_agg(to_jsonb(page)-'sequence' order by page.created_at desc,page.sequence desc) from (
      select a.id as sequence,a.id::text as id,a.project_id,a.task_id,a.task_title,a.actor_id,a.event_type,a.changes,a.created_at,
        exists(select 1 from public.tasks t where t.id=a.task_id) as task_exists,
        p.title as project_title
      from public.task_activity a join public.projects p on p.id=a.project_id
      where a.id<=v_snapshot and (p_project_id is null or a.project_id=p_project_id) and (p_task_id is null or a.task_id=p_task_id)
      order by a.created_at desc,a.id desc
      limit least(greatest(coalesce(p_limit,20),1),100) offset greatest(coalesce(p_offset,0),0)
    ) page),'[]'::jsonb)
  ));
end;
$$;
revoke all on function public.task_activity_page(uuid,uuid,integer,integer,bigint) from public,anon,authenticated;
grant execute on function public.task_activity_page(uuid,uuid,integer,integer,bigint) to authenticated;
