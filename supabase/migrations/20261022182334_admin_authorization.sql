-- Owner or admin: may edit/delete the project, change stages and manage members.
create function public.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = (select auth.uid())
  );
$$;
revoke all on function public.can_manage_project(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_project(uuid) to authenticated;

-- Owner, member or admin: may view the project and work with its tasks and attachments.
-- Tasks, attachments, Storage and Realtime policies all call this, so admins are covered everywhere.
create or replace function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or exists (
      select 1 from public.projects p
      where p.id = p_project_id and p.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.project_members m
      where m.project_id = p_project_id and m.user_id = (select auth.uid())
    );
$$;

-- projects (insert stays "you can only create projects you own")
drop policy projects_select_accessible on public.projects;
drop policy projects_update_own on public.projects;
drop policy projects_delete_own on public.projects;
create policy projects_select_accessible on public.projects
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_project_member(id) or public.is_admin());
create policy projects_update_managers on public.projects
  for update to authenticated
  using (public.can_manage_project(id))
  with check (public.can_manage_project(id));
create policy projects_delete_managers on public.projects
  for delete to authenticated
  using (public.can_manage_project(id));

-- stages
drop policy project_stages_insert_own on public.project_stages;
drop policy project_stages_update_own on public.project_stages;
drop policy project_stages_delete_own on public.project_stages;
create policy project_stages_insert_managers on public.project_stages
  for insert to authenticated with check (public.can_manage_project(project_id));
create policy project_stages_update_managers on public.project_stages
  for update to authenticated
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));
create policy project_stages_delete_managers on public.project_stages
  for delete to authenticated using (public.can_manage_project(project_id));

-- members
drop policy project_members_select on public.project_members;
drop policy project_members_insert_owner on public.project_members;
drop policy project_members_delete_owner on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_project(project_id));
create policy project_members_insert_managers on public.project_members
  for insert to authenticated
  with check (public.can_manage_project(project_id) and user_id <> (select auth.uid()));
create policy project_members_delete_managers on public.project_members
  for delete to authenticated
  using (public.can_manage_project(project_id));

-- Member directory RPCs: managers (owner or admin); the project owner never appears in the picker.
create or replace function public.search_users_for_project(
  p_project_id uuid,
  p_query text,
  p_limit integer default 10
)
returns table (user_id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 20);
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if char_length(v_query) < 2 then
    return;
  end if;
  v_query := left(v_query, 100);
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select u.id,
         left(
           case
             when nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '') is not null
               then btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'))
                    || ' (' || coalesce(u.email, 'no email') || ')'
             else coalesce(u.email, 'User ' || left(u.id::text, 8))
           end, 150)
  from auth.users u
  where u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and u.id <> (select auth.uid())
    and not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = u.id)
    and not exists (
      select 1 from public.project_members m
      where m.project_id = p_project_id and m.user_id = u.id
    )
    and (
      u.email ilike v_pattern escape '\'
      or coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '') ilike v_pattern escape '\'
    )
  order by 2, 1
  limit v_limit;
end;
$$;

create or replace function public.list_project_members(p_project_id uuid)
returns table (user_id uuid, label text, is_owner boolean, added_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  return query
  select x.uid,
         left(
           case
             when nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '') is not null
               then btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'))
                    || ' (' || coalesce(u.email, 'no email') || ')'
             else coalesce(u.email, 'User ' || left(x.uid::text, 8))
           end, 150),
         x.owner_flag,
         x.added
  from (
    select p.owner_id as uid, true as owner_flag, p.created_at as added
    from public.projects p where p.id = p_project_id
    union all
    select m.user_id, false, m.created_at
    from public.project_members m where m.project_id = p_project_id
  ) x
  left join auth.users u on u.id = x.uid
  order by x.owner_flag desc, x.added, x.uid
  limit 500;
end;
$$;

-- Project list: admins see every project; can_manage says whether edit/delete/users actions apply.
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
  is_owner boolean,
  can_manage boolean
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
    (p.owner_id = (select auth.uid())),
    public.can_manage_project(p.id)
  from public.projects p
  where public.can_access_project(p.id)
  order by p.created_at desc, p.id;
end;
$$;
revoke all on function public.list_projects_with_counts() from public, anon;
grant execute on function public.list_projects_with_counts() to authenticated;
