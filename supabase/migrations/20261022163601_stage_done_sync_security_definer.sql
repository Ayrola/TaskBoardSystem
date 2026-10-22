-- tasks.done is not writable by clients, so the stage -> tasks propagation must
-- run with the function owner's rights. It only updates tasks of the stage row
-- the caller was already allowed (by RLS) to update.
create or replace function public.project_stages_sync_tasks_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks
  set done = new.is_done
  where stage_id = new.id
    and project_id = new.project_id
    and done is distinct from new.is_done;
  return null;
end;
$$;

revoke all on function public.project_stages_sync_tasks_done() from public, anon, authenticated;
