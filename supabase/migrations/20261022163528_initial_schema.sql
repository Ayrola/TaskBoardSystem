-- Initial Taskboard schema: projects, project_stages, tasks.
-- Authorization boundary is RLS; no project membership yet (owner-only access).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint projects_title_not_blank check (btrim(title) <> ''),
  constraint projects_title_length check (char_length(title) <= 200)
);

create table public.project_stages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null,
  position   integer not null,
  is_done    boolean not null default false,
  constraint project_stages_name_not_blank check (btrim(name) <> ''),
  constraint project_stages_name_length check (char_length(name) <= 100),
  constraint project_stages_position_nonneg check (position >= 0),
  -- Target of the composite FK from tasks.
  constraint project_stages_id_project_key unique (id, project_id)
);

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  stage_id    uuid not null,
  title       text not null,
  -- Sanitized rich HTML. Sanitization happens in the app before saving; the
  -- database only bounds its size.
  description text,
  position    integer not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tasks_title_not_blank check (btrim(title) <> ''),
  constraint tasks_title_length check (char_length(title) <= 200),
  constraint tasks_description_length check (char_length(description) <= 100000),
  constraint tasks_position_nonneg check (position >= 0),
  -- The stage must belong to the same project. NO ACTION (not CASCADE) so a
  -- stage with tasks cannot be deleted silently; the check runs at the end of
  -- the statement, so deleting a whole project still cascades cleanly.
  constraint tasks_stage_project_fkey
    foreign key (stage_id, project_id)
    references public.project_stages (id, project_id)
    on delete no action
);

-- ---------------------------------------------------------------------------
-- Indexes (FK support and ordering)
-- ---------------------------------------------------------------------------

create index projects_owner_created_idx on public.projects (owner_id, created_at desc);
create index project_stages_project_position_idx on public.project_stages (project_id, position);
create index tasks_stage_position_idx on public.tasks (stage_id, position);
create index tasks_project_id_idx on public.tasks (project_id);

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- tasks.done always mirrors the selected stage's is_done.
create function public.tasks_sync_done()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stage_done boolean;
begin
  -- FOR SHARE keeps the stage row stable while the task is written.
  select s.is_done into stage_done
  from public.project_stages s
  where s.id = new.stage_id
  for share;

  new.done := coalesce(stage_done, false);
  return new;
end;
$$;

-- When a stage's completion semantics change, realign its tasks.
create function public.project_stages_sync_tasks_done()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.tasks
  set done = new.is_done
  where stage_id = new.id
    and done is distinct from new.is_done;
  return null;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.tasks_sync_done() from public, anon, authenticated;
revoke all on function public.project_stages_sync_tasks_done() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create trigger tasks_sync_done
  before insert or update on public.tasks
  for each row execute function public.tasks_sync_done();

create trigger project_stages_sync_tasks_done
  after update of is_done on public.project_stages
  for each row
  when (old.is_done is distinct from new.is_done)
  execute function public.project_stages_sync_tasks_done();

-- ---------------------------------------------------------------------------
-- Grants: no anonymous access; authenticated users get column-limited writes.
-- ---------------------------------------------------------------------------

revoke all on public.projects, public.project_stages, public.tasks from public, anon;
revoke all on public.projects, public.project_stages, public.tasks from authenticated;

grant select, delete on public.projects, public.project_stages, public.tasks to authenticated;

grant insert (title, description, owner_id) on public.projects to authenticated;
grant update (title, description) on public.projects to authenticated;

grant insert (project_id, name, position, is_done) on public.project_stages to authenticated;
grant update (name, position, is_done) on public.project_stages to authenticated;

grant insert (project_id, stage_id, title, description, position) on public.tasks to authenticated;
grant update (stage_id, title, description, position) on public.tasks to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_stages enable row level security;
alter table public.tasks enable row level security;

-- projects: owner only
create policy projects_select_own on public.projects
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy projects_insert_own on public.projects
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy projects_update_own on public.projects
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy projects_delete_own on public.projects
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- project_stages: inherit from the owning project
create policy project_stages_select_own on public.project_stages
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_stages.project_id and p.owner_id = (select auth.uid())
  ));

create policy project_stages_insert_own on public.project_stages
  for insert to authenticated
  with check (exists (
    select 1 from public.projects p
    where p.id = project_stages.project_id and p.owner_id = (select auth.uid())
  ));

create policy project_stages_update_own on public.project_stages
  for update to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_stages.project_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_stages.project_id and p.owner_id = (select auth.uid())
  ));

create policy project_stages_delete_own on public.project_stages
  for delete to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_stages.project_id and p.owner_id = (select auth.uid())
  ));

-- tasks: inherit from the owning project
create policy tasks_select_own on public.tasks
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = tasks.project_id and p.owner_id = (select auth.uid())
  ));

create policy tasks_insert_own on public.tasks
  for insert to authenticated
  with check (exists (
    select 1 from public.projects p
    where p.id = tasks.project_id and p.owner_id = (select auth.uid())
  ));

create policy tasks_update_own on public.tasks
  for update to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = tasks.project_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = tasks.project_id and p.owner_id = (select auth.uid())
  ));

create policy tasks_delete_own on public.tasks
  for delete to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = tasks.project_id and p.owner_id = (select auth.uid())
  ));
