-- Defence in depth: the project owner can never appear as a membership row.
create function public.project_members_block_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.owner_id = new.user_id
  ) then
    raise exception 'The project owner cannot be a member' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.project_members_block_owner() from public, anon, authenticated;

create trigger project_members_block_owner
  before insert on public.project_members
  for each row execute function public.project_members_block_owner();

-- Owner-only user picker: bounded, returns only an id and a display label.
create function public.search_users_for_project(
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
  if not public.is_project_owner(p_project_id) then
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

-- Owner-only member list (owner first), labelled the same way.
create function public.list_project_members(p_project_id uuid)
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
  if not public.is_project_owner(p_project_id) then
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

revoke all on function public.search_users_for_project(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.list_project_members(uuid) from public, anon, authenticated;
grant execute on function public.search_users_for_project(uuid, text, integer) to authenticated;
grant execute on function public.list_project_members(uuid) to authenticated;
