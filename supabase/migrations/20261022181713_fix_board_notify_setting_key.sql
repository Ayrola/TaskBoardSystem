-- Fix: custom settings may contain only one dot, so the per-transaction dedupe key is prefix.identifier.
create or replace function public.board_notify(p_project_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'taskboard.rt_' || p_event || '_' || replace(p_project_id::text, '-', '_');
begin
  if coalesce(current_setting(v_key, true), '') = '1' then
    return;
  end if;
  perform set_config(v_key, '1', true);
  perform realtime.send(
    jsonb_build_object('project_id', p_project_id),
    p_event,
    'project:' || p_project_id::text || ':board',
    true
  );
end;
$$;
revoke all on function public.board_notify(uuid, text) from public, anon, authenticated;
