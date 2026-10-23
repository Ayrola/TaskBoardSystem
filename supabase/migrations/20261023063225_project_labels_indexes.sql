-- Reuse the existing tasks composite key and cover both assignment foreign keys.
alter table public.task_labels drop constraint task_labels_task_id_project_id_fkey;
alter table public.tasks drop constraint tasks_id_project_labels_key;
alter table public.task_labels add constraint task_labels_task_id_project_id_fkey
  foreign key (task_id, project_id) references public.tasks(id, project_id) on delete cascade;
create index task_labels_task_project_idx on public.task_labels(task_id, project_id);
