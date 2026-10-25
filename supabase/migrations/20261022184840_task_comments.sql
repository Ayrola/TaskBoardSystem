-- Task comments: plain text discussion on a task.
--
-- Access is always decided live through the PARENT TASK's project (public.can_access_project), never from a
-- stored copy. A removed member therefore loses read, add, edit and delete at once; their earlier comments stay.
--   read / add  : owner, members, admins
--   edit        : the author only, and only while the author can still access the project
--   delete      : the author (while they have access), or the project owner / an admin (moderation)
-- Moderators cannot rewrite someone else's words, only remove them.

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  project_id uuid not null,
  -- Null once the author's account is deleted; the discussion is kept and shown as "Deleted user".
  author_id uuid references auth.users (id) on delete set null default auth.uid(),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_comments_task_project_fkey
    foreign key (task_id, project_id) references public.tasks (id, project_id) on delete cascade,
  constraint task_comments_body_not_blank check (btrim(body) <> ''),
  constraint task_comments_body_length check (char_length(body) <= 2000)
);

-- Newest-first keyset pagination for one task, plus the author and project lookups used by RLS and cleanup.
create index task_comments_task_created_idx on public.task_comments (task_id, created_at desc, id desc);
create index task_comments_project_idx on public.task_comments (project_id);
create index task_comments_author_idx on public.task_comments (author_id);

alter table public.task_comments enable row level security;

-- The browser may only supply task_id and body (insert) or body (update). author_id, project_id and the
-- timestamps cannot be set by the client at all.
revoke all on public.task_comments from public, anon, authenticated;
grant select, delete on public.task_comments to authenticated;
grant insert (task_id, body) on public.task_comments to authenticated;
grant update (body) on public.task_comments to authenticated;

create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.can_access_project(project_id));

create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_access_project(project_id));

create policy task_comments_update_author on public.task_comments
  for update to authenticated
  using (author_id = (select auth.uid()) and public.can_access_project(project_id))
  with check (author_id = (select auth.uid()) and public.can_access_project(project_id));

create policy task_comments_delete on public.task_comments
  for delete to authenticated
  using (
    public.can_access_project(project_id)
    and (author_id = (select auth.uid()) or public.can_manage_project(project_id))
  );

-- Derives project_id from the parent task (RLS on tasks applies, so an invisible task is "not found") and
-- pins the author to the authenticated user.
create function public.task_comments_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if new.author_id is not null and new.author_id <> v_uid then
    raise exception 'Comments can only be written as yourself' using errcode = '42501';
  end if;
  new.author_id := v_uid;

  select t.project_id into new.project_id from public.tasks t where t.id = new.task_id;
  if new.project_id is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  new.body := btrim(new.body);
  new.created_at := now();
  new.updated_at := new.created_at;
  return new;
end;
$$;
revoke all on function public.task_comments_before_insert() from public, anon, authenticated;

create trigger task_comments_before_insert
  before insert on public.task_comments
  for each row execute function public.task_comments_before_insert();

create function public.task_comments_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.body := btrim(new.body);
  if new.body is distinct from old.body then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;
revoke all on function public.task_comments_before_update() from public, anon, authenticated;

create trigger task_comments_before_update
  before update on public.task_comments
  for each row execute function public.task_comments_before_update();

-- One page of comments, newest first, with display labels. auth.users is read here (SECURITY DEFINER) so the
-- browser never touches it. The label is the profile name, else the part of the email before "@", else a short
-- id; full email addresses are not disclosed to other participants.
-- Cursor: pass the created_at and id of the last row received to get the next (older) page.
create function public.list_task_comments(
  p_task_id uuid,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_project uuid;
  v_manage boolean;
  v_total bigint;
  v_rows jsonb;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Invalid cursor' using errcode = '22023';
  end if;

  select t.project_id into v_project from public.tasks t where t.id = p_task_id;
  if v_project is null or not public.can_access_project(v_project) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  v_manage := public.can_manage_project(v_project);

  select count(*) into v_total from public.task_comments c where c.task_id = p_task_id;

  with page as (
    select c.id, c.body, c.created_at, c.updated_at, c.author_id
    from public.task_comments c
    where c.task_id = p_task_id
      and (p_before_created_at is null or (c.created_at, c.id) < (p_before_created_at, p_before_id))
    order by c.created_at desc, c.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(row_json order by created_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         count(*)
  into v_rows, v_count
  from (
    select p.id, p.created_at,
           row_number() over (order by p.created_at desc, p.id desc) as rn,
           jsonb_build_object(
             'id', p.id,
             'body', p.body,
             'created_at', p.created_at,
             'updated_at', p.updated_at,
             'author_label', case
               when p.author_id is null or u.id is null then 'Deleted user'
               else left(coalesce(
                 nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''),
                 nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
                 'User ' || left(p.author_id::text, 8)
               ), 100)
             end,
             'is_mine', p.author_id = v_uid,
             'can_edit', p.author_id = v_uid,
             'can_delete', p.author_id = v_uid or v_manage
           ) as row_json
    from page p
    left join auth.users u on u.id = p.author_id
  ) shaped;

  return jsonb_build_object('total', v_total, 'has_more', v_count > v_limit, 'rows', v_rows);
end;
$$;
revoke all on function public.list_task_comments(uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.list_task_comments(uuid, integer, timestamptz, uuid) to authenticated;
