-- Project membership.
--
-- Access model
--   owner   : edit/delete the project, manage members, and do everything a member can
--   member  : view the project and its stages; create/edit/delete/move its tasks and attachments
--   outsider: nothing
-- Members cannot change ownership (projects.owner_id has no UPDATE grant for anyone), and cannot
-- add or remove members. Stage structure (create/rename/reorder/delete stages) stays owner-only.
-- Nobody becomes a member implicitly: membership rows are only ever created by a project owner.
--
-- Recursion
--   projects policies must not read project_members through its own RLS, and project_members policies
--   must not read projects through its RLS (that would loop). All cross-table access checks therefore go
--   through the small SECURITY DEFINER helpers below, which read the base tables directly.
--
-- Helper hardening: search_path is empty and every object is schema-qualified; they return only a boolean,
-- take the caller from auth.uid() (never from an argument), and are executable by `authenticated` only.

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

alter table public.project_members enable row level security;
revoke all on public.project_members from public, anon, authenticated;
grant select, delete on public.project_members to authenticated;
grant insert (project_id, user_id) on public.project_members to authenticated;

-- ---------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER, boolean results only)
-- ---------------------------------------------------------------------------
create function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = (select auth.uid())
  );
$$;

create function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = (select auth.uid())
  );
$$;

create function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = (select auth.uid())
  );
$$;

-- Serializes task-order changes. Members have no UPDATE right on projects, so the row lock is taken here
-- on their behalf, but only after the caller's access has been verified.
create function public.lock_project_for_task_changes(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.can_access_project(p_project_id) then
    return false;
  end if;
  perform 1 from public.projects p where p.id = p_project_id for no key update;
  return found;
end;
$$;

revoke all on function public.is_project_owner(uuid) from public, anon, authenticated;
revoke all on function public.is_project_member(uuid) from public, anon, authenticated;
revoke all on function public.can_access_project(uuid) from public, anon, authenticated;
revoke all on function public.lock_project_for_task_changes(uuid) from public, anon, authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.can_access_project(uuid) to authenticated;
grant execute on function public.lock_project_for_task_changes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- project_members policies
-- ---------------------------------------------------------------------------
-- A member sees only their own membership row; the owner sees the whole list.
create policy project_members_select on public.project_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_project_owner(project_id));

-- Only the owner adds members, and not themselves (the owner is implicitly part of the project).
create policy project_members_insert_owner on public.project_members
  for insert to authenticated
  with check (public.is_project_owner(project_id) and user_id <> (select auth.uid()));

create policy project_members_delete_owner on public.project_members
  for delete to authenticated
  using (public.is_project_owner(project_id));

-- ---------------------------------------------------------------------------
-- projects: members may read; insert/update/delete stay owner-only (existing policies)
-- ---------------------------------------------------------------------------
drop policy projects_select_own on public.projects;
create policy projects_select_accessible on public.projects
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_project_member(id));

-- ---------------------------------------------------------------------------
-- project_stages: members may read; structure changes stay owner-only (existing policies)
-- ---------------------------------------------------------------------------
drop policy project_stages_select_own on public.project_stages;
create policy project_stages_select_accessible on public.project_stages
  for select to authenticated
  using (public.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- tasks: owner and members
-- ---------------------------------------------------------------------------
drop policy tasks_select_own on public.tasks;
drop policy tasks_insert_own on public.tasks;
drop policy tasks_update_own on public.tasks;
drop policy tasks_delete_own on public.tasks;

create policy tasks_select_accessible on public.tasks
  for select to authenticated using (public.can_access_project(project_id));
create policy tasks_insert_accessible on public.tasks
  for insert to authenticated with check (public.can_access_project(project_id));
create policy tasks_update_accessible on public.tasks
  for update to authenticated
  using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));
create policy tasks_delete_accessible on public.tasks
  for delete to authenticated using (public.can_access_project(project_id));

-- The done flag is derived from the stage. It reads and locks the stage row, which a member cannot
-- update under RLS, so this must run with the owner's rights (read-only use, nothing returned to the caller).
create or replace function public.tasks_sync_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage_done boolean;
begin
  select s.is_done into stage_done
  from public.project_stages s
  where s.id = new.stage_id and s.project_id = new.project_id
  for share;

  new.done := coalesce(stage_done, false);
  return new;
end;
$$;
revoke all on function public.tasks_sync_done() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- task_attachments metadata: owner and members
-- ---------------------------------------------------------------------------
drop policy task_attachments_select_own on public.task_attachments;
drop policy task_attachments_insert_own on public.task_attachments;
drop policy task_attachments_delete_own on public.task_attachments;

create policy task_attachments_select_accessible on public.task_attachments
  for select to authenticated using (public.can_access_project(project_id));

create policy task_attachments_insert_accessible on public.task_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and public.can_access_project(project_id)
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'task-attachments'
        and o.name = task_attachments.storage_path
        and (o.metadata ->> 'size')::bigint = task_attachments.size_bytes
    )
  );

create policy task_attachments_delete_accessible on public.task_attachments
  for delete to authenticated using (public.can_access_project(project_id));

-- Storage policies (bucket 'task-attachments' only) call this; access is decided from the real task and
-- project, never from the project id written in the path.
create or replace function public.attachment_path_accessible(p_path text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_path ~ format(
      '^%1$s/%1$s/%1$s$',
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    ), false)
    and exists (
      select 1
      from public.tasks t
      where t.project_id::text = split_part(p_path, '/', 1)
        and t.id::text = split_part(p_path, '/', 2)
        and public.can_access_project(t.project_id)
    );
$$;

-- ---------------------------------------------------------------------------
-- Task RPCs: the project lock now works for members too
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

  if not public.lock_project_for_task_changes(p_project_id) then
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

  if not public.lock_project_for_task_changes(v_project_id) then
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

  if p_stage_id is not null and p_stage_id <> v_current_stage then
    perform public.move_task(p_task_id, p_stage_id, 2147483647);
  end if;
end;
$$;

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
-- Dashboard and project list: explicit access rule (owned or member projects)
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
  select
    (select count(*) from public.projects p where public.can_access_project(p.id)),
    count(*),
    count(*) filter (where not t.done),
    count(*) filter (where t.done)
  from public.tasks t
  where public.can_access_project(t.project_id);
end;
$$;

-- The return type gains is_owner so the UI can hide owner-only actions from members.
drop function public.list_projects_with_counts();
create function public.list_projects_with_counts()
returns table (
  id uuid,
  title text,
  description text,
  created_at timestamptz,
  stage_count bigint,
  open_tasks bigint,
  done_tasks bigint,
  is_owner boolean
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
  select
    p.id,
    p.title,
    p.description,
    p.created_at,
    (select count(*) from public.project_stages s where s.project_id = p.id),
    (select count(*) from public.tasks t where t.project_id = p.id and not t.done),
    (select count(*) from public.tasks t where t.project_id = p.id and t.done),
    (p.owner_id = (select auth.uid()))
  from public.projects p
  where public.can_access_project(p.id)
  order by p.created_at desc, p.id;
end;
$$;

revoke all on function public.get_dashboard_stats() from public, anon;
revoke all on function public.list_projects_with_counts() from public, anon;
grant execute on function public.get_dashboard_stats() to authenticated;
grant execute on function public.list_projects_with_counts() to authenticated;
