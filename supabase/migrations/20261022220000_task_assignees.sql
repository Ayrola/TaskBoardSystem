create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on public.task_assignees(user_id, task_id);
alter table public.task_assignees enable row level security;
revoke all on public.task_assignees from public, anon, authenticated;
grant select, delete on public.task_assignees to authenticated;
grant insert (task_id, user_id) on public.task_assignees to authenticated;

create policy task_assignees_select on public.task_assignees for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id)));
create policy task_assignees_insert on public.task_assignees for insert to authenticated
with check (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id)));
create policy task_assignees_delete on public.task_assignees for delete to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id)));

-- Validate even direct inserts. Lock the membership so concurrent removal either
-- rejects this insert or waits for it and then removes the assignment.
create function public.task_assignees_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_owner uuid;
begin
  select t.project_id into v_project from public.tasks t where t.id = new.task_id;
  if v_project is null or not public.can_access_project(v_project) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  select p.owner_id into v_owner from public.projects p where p.id = v_project for share;
  if new.user_id <> v_owner then
    perform 1 from public.project_members m
    where m.project_id = v_project and m.user_id = new.user_id for share;
    if not found then
      raise exception 'Only the project owner and current members can be assigned' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger task_assignees_validate before insert or update on public.task_assignees
for each row execute function public.task_assignees_validate();

create function public.clear_removed_member_assignments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.task_assignees a using public.tasks t
  where a.task_id = t.id and t.project_id = old.project_id and a.user_id = old.user_id
    and not exists (select 1 from public.projects p where p.id = old.project_id and p.owner_id = old.user_id);
  return null;
end;
$$;
create trigger clear_removed_member_assignments after delete on public.project_members
for each row execute function public.clear_removed_member_assignments();

-- A project-scoped directory; never searches unrelated accounts. Bound results
-- and use literal substring matching so wildcard input cannot broaden the search.
create function public.search_task_assignees(p_project_id uuid, p_query text default '')
returns table(user_id uuid, label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.can_access_project(p_project_id) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  return query
  select u.id, left(coalesce(nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''), u.email, 'User ' || left(u.id::text, 8)), 150)
  from auth.users u
  where u.deleted_at is null and (
    exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = u.id)
    or exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = u.id)
  ) and (strpos(lower(coalesce(u.email, '')), lower(left(btrim(coalesce(p_query, '')), 100))) > 0
    or strpos(lower(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), lower(left(btrim(coalesce(p_query, '')), 100))) > 0)
  order by 2, 1 limit 50;
end;
$$;

-- Batch labels for the loaded cards, with explicit per-task access checks.
create function public.list_task_assignees(p_task_ids uuid[])
returns table(task_id uuid, user_id uuid, label text)
language sql stable security definer set search_path = '' as $$
  select a.task_id, a.user_id,
    left(coalesce(nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''), u.email, 'User ' || left(u.id::text, 8)), 150)
  from public.task_assignees a
  join public.tasks t on t.id = a.task_id
  join auth.users u on u.id = a.user_id
  where a.task_id = any(p_task_ids[1:500]) and auth.uid() is not null
    and public.can_access_project(t.project_id)
  order by 3, 2;
$$;

create function public.task_assignees_notify_board() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project uuid;
begin
  select t.project_id into v_project from public.tasks t
  where t.id = case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  if v_project is not null then perform public.board_notify(v_project, 'project_changed'); end if;
  return null;
end;
$$;
create trigger task_assignees_notify_board after insert or delete on public.task_assignees
for each row execute function public.task_assignees_notify_board();

revoke all on function public.task_assignees_validate() from public, anon, authenticated;
revoke all on function public.clear_removed_member_assignments() from public, anon, authenticated;
revoke all on function public.task_assignees_notify_board() from public, anon, authenticated;
revoke all on function public.search_task_assignees(uuid, text) from public, anon, authenticated;
revoke all on function public.list_task_assignees(uuid[]) from public, anon, authenticated;
grant execute on function public.search_task_assignees(uuid, text) to authenticated;
grant execute on function public.list_task_assignees(uuid[]) to authenticated;
