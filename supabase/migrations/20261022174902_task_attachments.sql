-- Task attachments: private Storage bucket, metadata table and access rules.
--
-- Access follows the parent project (owner only for now). Storage policies are limited to the
-- 'task-attachments' bucket and decide access from the real task/project, never from path text alone.
-- Object paths are generated as {project_id}/{task_id}/{attachment_id}; the original filename
-- is metadata only, so it can never overwrite or address another object.
--
-- Storage objects are not removed by database cascades, and storage.objects must not be deleted
-- from SQL. Instead, removing a task_attachments row (directly or by cascade from task/project
-- deletion) queues its path in attachment_cleanup_queue; the client then calls the Storage API
-- remove() for the queued paths and clears them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false, 10485760,
  array[
    'image/png','image/jpeg','image/gif','image/webp',
    'application/pdf','text/plain','text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table public.tasks add constraint tasks_id_project_key unique (id, project_id);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  project_id uuid not null,
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint task_attachments_task_project_fkey
    foreign key (task_id, project_id) references public.tasks (id, project_id) on delete cascade,
  constraint task_attachments_path_format
    check (storage_path = project_id::text || '/' || task_id::text || '/' || id::text),
  constraint task_attachments_filename_not_blank check (btrim(original_filename) <> ''),
  constraint task_attachments_filename_length check (char_length(original_filename) <= 255),
  constraint task_attachments_size_range check (size_bytes between 1 and 10485760),
  constraint task_attachments_mime_allowed check (mime_type in (
    'image/png','image/jpeg','image/gif','image/webp',
    'application/pdf','text/plain','text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ))
);

create index task_attachments_task_idx on public.task_attachments (task_id, created_at);
create index task_attachments_project_idx on public.task_attachments (project_id);
create index task_attachments_uploaded_by_idx on public.task_attachments (uploaded_by);

create table public.attachment_cleanup_queue (
  storage_path text primary key,
  owner_id uuid,
  queued_at timestamptz not null default now()
);

alter table public.task_attachments enable row level security;
alter table public.attachment_cleanup_queue enable row level security;

revoke all on public.task_attachments from public, anon, authenticated;
revoke all on public.attachment_cleanup_queue from public, anon, authenticated;
grant select, delete on public.task_attachments to authenticated;
grant insert (id, task_id, project_id, storage_path, original_filename, mime_type, size_bytes)
  on public.task_attachments to authenticated;
grant select, delete on public.attachment_cleanup_queue to authenticated;

create policy task_attachments_select_own on public.task_attachments
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = task_attachments.project_id and p.owner_id = (select auth.uid())
  ));

-- A row may only describe an object that was really uploaded, with the size the Storage API recorded.
create policy task_attachments_insert_own on public.task_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = task_attachments.project_id and p.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'task-attachments'
        and o.name = task_attachments.storage_path
        and (o.metadata ->> 'size')::bigint = task_attachments.size_bytes
    )
  );

create policy task_attachments_delete_own on public.task_attachments
  for delete to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = task_attachments.project_id and p.owner_id = (select auth.uid())
  ));

create policy attachment_cleanup_select_own on public.attachment_cleanup_queue
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attachment_cleanup_delete_own on public.attachment_cleanup_queue
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Queues the object for removal whenever a row disappears, including cascades from task/project deletion.
create function public.task_attachments_queue_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attachment_cleanup_queue (storage_path, owner_id)
  values (old.storage_path, coalesce(auth.uid(), old.uploaded_by))
  on conflict (storage_path) do nothing;
  return old;
end;
$$;
revoke all on function public.task_attachments_queue_cleanup() from public, anon, authenticated;

create trigger task_attachments_queue_cleanup
  after delete on public.task_attachments
  for each row execute function public.task_attachments_queue_cleanup();

-- Path shape is project_id/task_id/attachment_id; access is decided by the real task and project, not the text.
create function public.attachment_path_accessible(p_path text)
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
      join public.projects p on p.id = t.project_id
      where t.project_id::text = split_part(p_path, '/', 1)
        and t.id::text = split_part(p_path, '/', 2)
        and p.owner_id = (select auth.uid())
    );
$$;
revoke all on function public.attachment_path_accessible(text) from public, anon;
grant execute on function public.attachment_path_accessible(text) to authenticated;

-- Queued paths remain removable after their task or project is gone.
create policy task_attachments_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-attachments'
    and (
      public.attachment_path_accessible(name)
      or exists (
        select 1 from public.attachment_cleanup_queue q
        where q.storage_path = name and q.owner_id = (select auth.uid())
      )
    )
  );

create policy task_attachments_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-attachments' and public.attachment_path_accessible(name));

create policy task_attachments_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and (
      public.attachment_path_accessible(name)
      or exists (
        select 1 from public.attachment_cleanup_queue q
        where q.storage_path = name and q.owner_id = (select auth.uid())
      )
    )
  );
