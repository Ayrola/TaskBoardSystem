-- project_id on task_labels is derived internally and used by composite foreign keys.
-- This guarantees project consistency even during concurrent writes or privileged parent updates.
create table public.project_labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  colour text not null default '#2563eb' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  unique (id, project_id)
);
create unique index project_labels_project_name_idx on public.project_labels(project_id, lower(name));
alter table public.tasks add constraint tasks_id_project_labels_key unique (id, project_id);
create table public.task_labels (
  task_id uuid not null,
  label_id uuid not null,
  project_id uuid not null,
  primary key (task_id, label_id),
  foreign key (task_id, project_id) references public.tasks(id, project_id) on delete cascade,
  foreign key (label_id, project_id) references public.project_labels(id, project_id) on delete cascade
);
create index task_labels_label_project_idx on public.task_labels(label_id, project_id, task_id);
create index task_labels_project_idx on public.task_labels(project_id);

create function public.task_labels_set_project() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  select t.project_id into new.project_id from public.tasks t where t.id = new.task_id;
  if new.project_id is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
create trigger task_labels_set_project before insert or update on public.task_labels
for each row execute function public.task_labels_set_project();
revoke all on function public.task_labels_set_project() from public, anon, authenticated;

alter table public.project_labels enable row level security;
alter table public.task_labels enable row level security;
revoke all on public.project_labels, public.task_labels from public, anon, authenticated;
grant select, delete on public.project_labels, public.task_labels to authenticated;
grant insert (project_id, name, colour) on public.project_labels to authenticated;
grant update (name, colour) on public.project_labels to authenticated;
grant insert (task_id, label_id) on public.task_labels to authenticated;

create policy project_labels_select on public.project_labels for select to authenticated
using (public.can_access_project(project_id));
create policy project_labels_insert on public.project_labels for insert to authenticated
with check (public.can_manage_project(project_id));
create policy project_labels_update on public.project_labels for update to authenticated
using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy project_labels_delete on public.project_labels for delete to authenticated
using (public.can_manage_project(project_id));
create policy task_labels_select on public.task_labels for select to authenticated
using (public.can_access_project(project_id));
create policy task_labels_insert on public.task_labels for insert to authenticated
with check (public.can_access_project(project_id));
create policy task_labels_delete on public.task_labels for delete to authenticated
using (public.can_access_project(project_id));

-- Invoker RPC: RLS applies independently to tasks, assignments and labels.
create function public.label_tasks_page(p_label_id uuid, p_limit integer default 20, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', (select count(*) from public.tasks t join public.task_labels a on a.task_id = t.id where a.label_id = p_label_id),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id) from (
      select t.id, t.project_id, t.stage_id, t.title, t.done, t.created_at
      from public.tasks t join public.task_labels a on a.task_id = t.id
      where a.label_id = p_label_id
      order by t.created_at desc, t.id
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      offset greatest(coalesce(p_offset, 0), 0)
    ) page), '[]'::jsonb)
  );
$$;
revoke all on function public.label_tasks_page(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.label_tasks_page(uuid, integer, integer) to authenticated;

-- Reuse the existing board notifier, including its transaction-level deduplication.
create schema if not exists private;
create function private.labels_notify_board() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_project uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
begin
  if auth.uid() is not null and public.can_access_project(v_project) then
    perform public.board_notify(v_project, 'project_changed');
  end if;
  return null;
end;
$$;
revoke all on function private.labels_notify_board() from public, anon, authenticated;
create trigger project_labels_notify_board after insert or update or delete on public.project_labels
for each row execute function private.labels_notify_board();
create trigger task_labels_notify_board after insert or delete on public.task_labels
for each row execute function private.labels_notify_board();
