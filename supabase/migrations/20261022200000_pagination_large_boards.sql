-- Pagination and large-board support.
--
-- * list_projects_page: server-side pagination with a deterministic order and the exact total.
-- * board_stage_counts: exact task count per stage, independent of how many rows a browser has loaded.
-- * move_task: unchanged semantics (the server renumbers the WHOLE destination and source columns), but it no
--   longer returns every task of both columns; clients refetch the affected columns by cursor instead.
-- * move_task_relative: placement expressed against the real column ("after task X", "top", "end") so a drop into
--   a partially loaded column cannot be misplaced by an out-of-date browser index.
-- * get_dashboard_stats: same numbers, but the access check runs once per project instead of once per task.

create index if not exists projects_created_id_idx on public.projects (created_at desc, id);
create index if not exists tasks_stage_position_id_idx on public.tasks (stage_id, position, id);

-- ---------------------------------------------------------------------------
-- Projects: one page plus the exact total, ordered by (created_at desc, id).
-- Counts are computed in the database for the returned projects only, so they include every row.
-- ---------------------------------------------------------------------------
create function public.list_projects_page(p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return (
    with visible as (
      select p.id, p.title, p.description, p.created_at, p.owner_id
      from public.projects p
      where public.can_access_project(p.id)
    ),
    page as (
      select * from visible
      order by created_at desc, id
      limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'total', (select count(*) from visible),
      'rows', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', g.id,
              'title', g.title,
              'description', g.description,
              'created_at', g.created_at,
              'stage_count', (select count(*) from public.project_stages s where s.project_id = g.id),
              'open_tasks', (select count(*) from public.tasks t where t.project_id = g.id and not t.done),
              'done_tasks', (select count(*) from public.tasks t where t.project_id = g.id and t.done),
              'is_owner', (g.owner_id = (select auth.uid())),
              'can_manage', public.can_manage_project(g.id)
            )
            order by g.created_at desc, g.id
          )
          from page g
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;
revoke all on function public.list_projects_page(integer, integer) from public, anon;
grant execute on function public.list_projects_page(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Exact task count per stage (including stages with none). RLS and the access check decide visibility.
-- ---------------------------------------------------------------------------
create function public.board_stage_counts(p_project_id uuid)
returns table (stage_id uuid, task_count bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.can_access_project(p_project_id) then
    return;
  end if;

  return query
  select s.id, (select count(*) from public.tasks t where t.stage_id = s.id)
  from public.project_stages s
  where s.project_id = p_project_id
  order by s.position, s.id;
end;
$$;
revoke all on function public.board_stage_counts(uuid) from public, anon;
grant execute on function public.board_stage_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard: same result as before; access is evaluated per project, not per task row.
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_stats()
returns table (project_count bigint, total_tasks bigint, open_tasks bigint, done_tasks bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
  with mine as (
    select p.id from public.projects p where public.can_access_project(p.id)
  )
  select
    (select count(*) from mine),
    count(t.id),
    count(t.id) filter (where not t.done),
    count(t.id) filter (where t.done)
  from public.tasks t
  where t.project_id in (select m.id from mine m);
end;
$$;

-- ---------------------------------------------------------------------------
-- move_task: same placement rules, leaner result. The renumbering always reads the full columns from the
-- database under the project lock; it never depends on what a browser has loaded.
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

-- ---------------------------------------------------------------------------
-- move_task_relative: destination placement for columns the browser has only partly loaded.
--   p_to_end                -> after the last task of the whole column (loaded or not)
--   p_after_task_id is null -> top of the column
--   p_after_task_id = X     -> directly after X, wherever X is now in the column
-- If X is no longer in the destination column the board changed under the user: errcode 40001, nothing is
-- moved, and the client reloads. The final placement is still computed by move_task on the full column.
-- ---------------------------------------------------------------------------
create function public.move_task_relative(
  p_task_id uuid,
  p_stage_id uuid,
  p_after_task_id uuid default null,
  p_to_end boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_index integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_task_id is null or p_stage_id is null then
    raise exception 'Task and stage are required' using errcode = '22023';
  end if;

  select t.project_id into v_project_id from public.tasks t where t.id = p_task_id;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if not public.lock_project_for_task_changes(v_project_id) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if coalesce(p_to_end, false) then
    select count(*) into v_index
    from public.tasks t
    where t.stage_id = p_stage_id and t.id <> p_task_id;
  elsif p_after_task_id is null then
    v_index := 0;
  else
    perform 1 from public.tasks a
    where a.id = p_after_task_id and a.stage_id = p_stage_id and a.id <> p_task_id;
    if not found then
      raise exception 'The column changed; reload and try again' using errcode = '40001';
    end if;

    select count(*) into v_index
    from public.tasks t
    join public.tasks a on a.id = p_after_task_id
    where t.stage_id = p_stage_id
      and t.id <> p_task_id
      and (t.position, t.id) <= (a.position, a.id);
  end if;

  return public.move_task(p_task_id, p_stage_id, v_index);
end;
$$;
revoke all on function public.move_task_relative(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.move_task_relative(uuid, uuid, uuid, boolean) to authenticated;
