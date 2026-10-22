-- Task write operations that allocate positions on the server.
--
-- Both functions are SECURITY INVOKER, so grants and RLS still decide who may read
-- or write. They take a transaction-scoped advisory lock keyed on the target stage
-- before reading max(position). Concurrent creates/moves into the same stage queue up
-- on that lock, so two requests can never compute the same "last position + 1".
-- (An advisory lock is used instead of SELECT ... FOR UPDATE because it does not need
-- UPDATE rights on project_stages, and it also covers an empty stage.)
-- tasks.done is not written here: the tasks_sync_done trigger derives it from the stage.

create function public.create_task(
  p_project_id uuid,
  p_stage_id uuid,
  p_title text,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_position integer;
  v_task_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- RLS hides stages of projects the caller cannot access, so this also checks access.
  if not exists (
    select 1 from public.project_stages s
    where s.id = p_stage_id and s.project_id = p_project_id
  ) then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('task-stage:' || p_stage_id::text, 0));

  select coalesce(max(t.position) + 1, 0) into v_position
  from public.tasks t
  where t.stage_id = p_stage_id;

  insert into public.tasks (project_id, stage_id, title, description, position)
  values (p_project_id, p_stage_id, p_title, p_description, v_position)
  returning id into v_task_id;

  return v_task_id;
end;
$$;

-- Edits a task by id. If the stage changes, the task is appended to the end of the new stage.
create function public.update_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_stage_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_current_stage uuid;
  v_position integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select t.project_id, t.stage_id into v_project_id, v_current_stage
  from public.tasks t
  where t.id = p_task_id;

  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if p_stage_id is null or p_stage_id = v_current_stage then
    update public.tasks
    set title = p_title, description = p_description
    where id = p_task_id;
  else
    if not exists (
      select 1 from public.project_stages s
      where s.id = p_stage_id and s.project_id = v_project_id
    ) then
      raise exception 'Stage not found' using errcode = 'P0002';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('task-stage:' || p_stage_id::text, 0));

    select coalesce(max(t.position) + 1, 0) into v_position
    from public.tasks t
    where t.stage_id = p_stage_id;

    update public.tasks
    set title = p_title, description = p_description, stage_id = p_stage_id, position = v_position
    where id = p_task_id;
  end if;

  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.create_task(uuid, uuid, text, text) from public, anon;
revoke all on function public.update_task(uuid, text, text, uuid) from public, anon;
grant execute on function public.create_task(uuid, uuid, text, text) to authenticated;
grant execute on function public.update_task(uuid, text, text, uuid) to authenticated;
