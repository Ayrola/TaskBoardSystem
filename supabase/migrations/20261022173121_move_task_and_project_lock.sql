-- Task ordering is serialized per project by locking the project row.
--
-- Every operation that changes task order (create_task, update_task when the stage changes,
-- move_task, delete_task) first runs
--     SELECT ... FROM projects WHERE id = ... FOR NO KEY UPDATE
-- under the caller's RLS. This needs the owner's UPDATE policy, so non-owners cannot take the lock.
-- FOR NO KEY UPDATE is used instead of FOR UPDATE so that plain task inserts
-- (which only take FOR KEY SHARE on the project) are not blocked by it.
-- Task and stage data are re-read after the lock is held. Lock order is always project, then task rows.
--
-- All functions are SECURITY INVOKER and use RLS as the authorization boundary.

-- Re-ordering siblings must not look like an edit: only content/stage changes bump updated_at.
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update of title, description, stage_id on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- move_task
-- ---------------------------------------------------------------------------
create or replace function public.move_task(
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

  -- Unlocked read only to discover which project to lock. RLS hides foreign tasks.
  select t.project_id into v_project_id
  from public.tasks t
  where t.id = p_task_id;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  perform 1 from public.projects p where p.id = v_project_id for no key update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  -- Re-read after the lock: the task may have been moved or deleted while we waited.
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

  -- An index past the end means "append"; negative or null indices were rejected above.
  v_index := least(p_index, v_dest_count);

  -- Renumber the destination's other tasks 0..n-1 (by position, then id), leaving a gap at v_index.
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

  -- Close the gap left in the source column. done is set by the tasks_sync_done trigger.
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

  return (
    select jsonb_build_object(
      'task_id', p_task_id,
      'project_id', v_project_id,
      'source_stage_id', v_src_stage,
      'stage_id', p_stage_id,
      'position', v_index,
      'done', v_done,
      'changed', (v_src_stage <> p_stage_id or v_src_pos <> v_index),
      'tasks', coalesce(
        jsonb_agg(
          jsonb_build_object('id', t.id, 'stage_id', t.stage_id, 'position', t.position, 'done', t.done)
          order by t.stage_id, t.position, t.id
        ),
        '[]'::jsonb
      )
    )
    from public.tasks t
    where t.stage_id in (v_src_stage, p_stage_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_task: delete and close the gap in one locked transaction
-- ---------------------------------------------------------------------------
create or replace function public.delete_task(p_task_id uuid)
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

  perform 1 from public.projects p where p.id = v_project_id for no key update;
  if not found then
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

-- ---------------------------------------------------------------------------
-- create_task: same project lock instead of the per-stage advisory lock
-- ---------------------------------------------------------------------------
create or replace function public.create_task(
  p_project_id uuid,
  p_stage_id uuid,
  p_title text,
  p_description text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_position integer;
  v_task_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform 1 from public.projects p where p.id = p_project_id for no key update;
  if not found then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;

  perform 1 from public.project_stages s
  where s.id = p_stage_id and s.project_id = p_project_id;
  if not found then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;

  select coalesce(max(t.position) + 1, 0) into v_position
  from public.tasks t
  where t.stage_id = p_stage_id;

  insert into public.tasks (project_id, stage_id, title, description, position)
  values (p_project_id, p_stage_id, p_title, p_description, v_position)
  returning id into v_task_id;

  return v_task_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_task: field edits, and a stage change is delegated to move_task (append to the end)
-- ---------------------------------------------------------------------------
create or replace function public.update_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_stage_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_current_stage uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select t.project_id into v_project_id from public.tasks t where t.id = p_task_id;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  perform 1 from public.projects p where p.id = v_project_id for no key update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  select t.stage_id into v_current_stage
  from public.tasks t
  where t.id = p_task_id and t.project_id = v_project_id
  for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  update public.tasks
  set title = p_title, description = p_description
  where id = p_task_id;

  -- Any failure here (for example a foreign stage) rolls back the field edit too.
  if p_stage_id is not null and p_stage_id <> v_current_stage then
    perform public.move_task(p_task_id, p_stage_id, 2147483647);
  end if;
end;
$$;

revoke all on function public.move_task(uuid, uuid, integer) from public, anon;
revoke all on function public.delete_task(uuid) from public, anon;
revoke all on function public.create_task(uuid, uuid, text, text) from public, anon;
revoke all on function public.update_task(uuid, text, text, uuid) from public, anon;
grant execute on function public.move_task(uuid, uuid, integer) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;
grant execute on function public.create_task(uuid, uuid, text, text) to authenticated;
grant execute on function public.update_task(uuid, text, text, uuid) to authenticated;
