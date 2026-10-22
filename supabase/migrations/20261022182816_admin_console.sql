-- Admin console support: admin-only project directory, and the only supported way to reorder and delete stages.
-- Stage deletion/reordering move through functions so positions stay contiguous and tasks are never orphaned.

-- Display label of a user. Internal helper: no client can execute it.
create or replace function public.admin_user_label(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(
    case
      when nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '') is not null
        then btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'))
             || ' (' || coalesce(u.email, 'no email') || ')'
      else coalesce(u.email, 'User ' || left(u.id::text, 8))
    end, 150)
  from auth.users u
  where u.id = p_user_id;
$$;

revoke all on function public.admin_user_label(uuid) from public, anon, authenticated;

-- Admin-only, bounded and paginated. Returns owner label only (never raw Auth data).
create or replace function public.admin_list_projects(
  p_limit integer default 20,
  p_offset integer default 0,
  p_search text default null,
  p_project_id uuid default null
)
returns table (
  id uuid,
  title text,
  description text,
  owner_id uuid,
  owner_label text,
  created_at timestamptz,
  updated_at timestamptz,
  stage_count bigint,
  task_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_pattern text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  v_pattern := nullif(btrim(coalesce(p_search, '')), '');
  if v_pattern is not null then
    v_pattern := '%' || replace(replace(replace(left(v_pattern, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select p.id, p.title, p.description, p.owner_id,
         coalesce(public.admin_user_label(p.owner_id), 'User ' || left(p.owner_id::text, 8)),
         p.created_at, p.updated_at,
         (select count(*) from public.project_stages s where s.project_id = p.id),
         (select count(*) from public.tasks t where t.project_id = p.id),
         count(*) over ()
  from public.projects p
  where (p_project_id is null or p.id = p_project_id)
    and (v_pattern is null or p.title ilike v_pattern escape '\')
  order by p.created_at desc, p.id
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.admin_list_projects(integer, integer, text, uuid) from public, anon;
grant execute on function public.admin_list_projects(integer, integer, text, uuid) to authenticated;

-- Moves one stage to a zero-based index and renumbers the project's stages 0..n-1. Tasks stay in their stages.
create or replace function public.move_stage(p_stage_id uuid, p_index integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_count integer;
  v_index integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_stage_id is null or p_index is null or p_index < 0 then
    raise exception 'Invalid stage or position' using errcode = '22023';
  end if;

  select s.project_id into v_project_id from public.project_stages s where s.id = p_stage_id;
  if not found or not public.can_manage_project(v_project_id) then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;

  -- Same project row lock as the task functions; everything below is re-read after it is held.
  perform 1 from public.projects p where p.id = v_project_id for no key update;
  perform 1 from public.project_stages s where s.id = p_stage_id and s.project_id = v_project_id;
  if not found then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;

  select count(*) - 1 into v_count from public.project_stages s where s.project_id = v_project_id;
  v_index := least(p_index, v_count);

  update public.project_stages s
  set position = d.new_pos
  from (
    select x.id, case when x.rn < v_index then x.rn else x.rn + 1 end as new_pos
    from (
      select o.id, (row_number() over (order by o.position, o.id) - 1)::integer as rn
      from public.project_stages o
      where o.project_id = v_project_id and o.id <> p_stage_id
    ) x
  ) d
  where s.id = d.id and s.position <> d.new_pos;

  update public.project_stages s set position = v_index where s.id = p_stage_id and s.position <> v_index;

  return (
    select jsonb_build_object(
      'project_id', v_project_id,
      'stages', coalesce(jsonb_agg(
        jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position, 'is_done', s.is_done)
        order by s.position, s.id), '[]'::jsonb)
    )
    from public.project_stages s
    where s.project_id = v_project_id
  );
end;
$$;

revoke all on function public.move_stage(uuid, integer) from public, anon;
grant execute on function public.move_stage(uuid, integer) to authenticated;

-- Deletes a stage. A stage that still has tasks needs an explicit destination stage of the same project;
-- its tasks are appended there (keeping their order), their done flag follows the destination, and both
-- the destination column and the remaining stages are renumbered contiguously.
create or replace function public.delete_stage(p_stage_id uuid, p_target_stage_id uuid default null)
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

revoke all on function public.delete_stage(uuid, uuid) from public, anon;
grant execute on function public.delete_stage(uuid, uuid) to authenticated;

-- Stages are removed and reordered only through the functions above, so direct DELETE and position writes are closed.
revoke delete on public.project_stages from authenticated;
revoke update (position) on public.project_stages from authenticated;
