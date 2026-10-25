-- Support for the `admin-users` Edge Function. Both functions are executable by service_role only:
-- they take the target user as an argument, so no browser-facing role may call them.

-- Counts of everything that deleting the user would remove. Memberships and uploads are reported
-- separately because they belong to other people's projects.
create function public.admin_user_deletion_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with owned as (
    select id from public.projects where owner_id = p_user_id
  )
  select jsonb_build_object(
    'owned_projects', (select count(*) from owned),
    'stages', (select count(*) from public.project_stages s where s.project_id in (select id from owned)),
    'tasks', (select count(*) from public.tasks t where t.project_id in (select id from owned)),
    'attachments', (select count(*) from public.task_attachments a where a.project_id in (select id from owned)),
    'attachment_bytes', (select coalesce(sum(a.size_bytes), 0) from public.task_attachments a where a.project_id in (select id from owned)),
    'members_in_owned_projects', (select count(*) from public.project_members m where m.project_id in (select id from owned) and m.user_id <> p_user_id),
    'memberships_in_other_projects', (select count(*) from public.project_members m where m.user_id = p_user_id and m.project_id not in (select id from owned)),
    'uploads_in_other_projects', (select count(*) from public.task_attachments a where a.uploaded_by = p_user_id and a.project_id not in (select id from owned)),
    'pending_storage_cleanup', (select count(*) from public.attachment_cleanup_queue q where q.owner_id = p_user_id)
  );
$$;

-- Step 2 of the deletion sequence, in one transaction: removes the user's dependent rows and hands the
-- Storage paths of every removed attachment to the cleanup queue under the user's id. The Storage
-- objects themselves are removed afterwards through the Storage API, because storage.objects must not
-- be deleted from SQL. Running it again is harmless (nothing left to delete).
create function public.admin_delete_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
  v_projects integer;
  v_memberships integer;
  v_uploads integer;
begin
  select coalesce(array_agg(distinct a.storage_path), '{}')
    into v_paths
  from public.task_attachments a
  where a.uploaded_by = p_user_id
     or a.project_id in (select p.id from public.projects p where p.owner_id = p_user_id);

  -- Uploads in other people's projects are removed with their task context kept intact.
  delete from public.task_attachments where uploaded_by = p_user_id;
  get diagnostics v_uploads = row_count;

  -- Cascades to stages, tasks, attachments and members of the owned projects. Nothing is reassigned.
  delete from public.projects where owner_id = p_user_id;
  get diagnostics v_projects = row_count;

  delete from public.project_members where user_id = p_user_id;
  get diagnostics v_memberships = row_count;

  insert into public.attachment_cleanup_queue (storage_path, owner_id)
  select unnest(v_paths), p_user_id
  on conflict (storage_path) do update set owner_id = excluded.owner_id;

  return jsonb_build_object(
    'deleted_projects', v_projects,
    'deleted_memberships', v_memberships,
    'deleted_uploads', v_uploads,
    'queued_storage_paths', coalesce(array_length(v_paths, 1), 0)
  );
end;
$$;

revoke all on function public.admin_user_deletion_summary(uuid) from public, anon, authenticated;
revoke all on function public.admin_delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_deletion_summary(uuid) to service_role;
grant execute on function public.admin_delete_user_data(uuid) to service_role;
