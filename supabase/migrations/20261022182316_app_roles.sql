create type public.app_role as enum ('user', 'admin');

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;
revoke all on public.user_roles from public, anon, authenticated;
grant select on public.user_roles to authenticated;
-- Admin-only by policy. user_id is immutable and rows are never deleted by clients (they cascade from auth.users).
grant insert (user_id, role) on public.user_roles to authenticated;
grant update (role) on public.user_roles to authenticated;

-- Reads user_roles with elevated privileges so policies that call it never recurse into user_roles' own RLS.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy user_roles_insert_admin on public.user_roles
  for insert to authenticated
  with check (public.is_admin());
create policy user_roles_update_admin on public.user_roles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create function public.user_roles_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.user_roles_touch() from public, anon, authenticated;
create trigger user_roles_touch before update on public.user_roles
  for each row execute function public.user_roles_touch();

-- Signed-in clients can never remove or demote the last admin. Trusted server contexts (no JWT user) are exempt.
create function public.user_roles_keep_an_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from public.user_roles r where r.role = 'admin' and r.user_id <> old.user_id
     ) then
    raise exception 'At least one admin must remain' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.user_roles_keep_an_admin() from public, anon, authenticated;
create trigger user_roles_keep_an_admin before update or delete on public.user_roles
  for each row execute function public.user_roles_keep_an_admin();

-- Every new account gets the plain 'user' role. The value is a constant: signup metadata is never read.
create function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user_role() from public, anon, authenticated;
create trigger on_auth_user_created_role
  after insert on auth.users
  for each row execute function public.handle_new_user_role();

-- Backfill existing accounts; existing rows (for example admins) are never overwritten.
insert into public.user_roles (user_id, role)
select u.id, 'user' from auth.users u
on conflict (user_id) do nothing;
