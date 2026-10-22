-- Creates a project and its default stages atomically.
-- SECURITY INVOKER: runs with the caller's rights, so existing grants and RLS
-- policies apply to every insert. No elevated privileges are needed.
create function public.create_project_with_default_stages(
  p_title text,
  p_description text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_project_id uuid;
begin
  if v_owner is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- The owner always comes from the JWT, never from caller input.
  insert into public.projects (title, description, owner_id)
  values (p_title, p_description, v_owner)
  returning id into v_project_id;

  insert into public.project_stages (project_id, name, position, is_done)
  values
    (v_project_id, 'Not Started', 0, false),
    (v_project_id, 'In Progress', 1, false),
    (v_project_id, 'Done',        2, true);

  return v_project_id;
end;
$$;

-- Supabase grants EXECUTE to anon by default on new functions; remove it.
revoke all on function public.create_project_with_default_stages(text, text) from public, anon;
grant execute on function public.create_project_with_default_stages(text, text) to authenticated;
