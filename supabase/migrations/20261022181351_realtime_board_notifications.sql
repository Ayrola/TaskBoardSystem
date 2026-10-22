-- Private Broadcast topic: project:<project uuid>:board
-- Only the owner or a current member may receive messages on a project's board topic.
create function public.can_receive_board_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^project:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:board$'
      then public.can_access_project(substr(p_topic, 9, 36)::uuid)
    else false
  end;
$$;
revoke all on function public.can_receive_board_topic(text) from public, anon, authenticated;
grant execute on function public.can_receive_board_topic(text) to authenticated;

-- Receive only. There is no INSERT policy for clients, so browsers cannot publish or forge notifications.
-- (realtime.messages already has RLS enabled and is owned by Supabase, so it is not altered here.)
create policy project_board_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_receive_board_topic((select realtime.topic()))
  );

-- Internal sender: the payload is only the project id. At most one message per project and event per
-- transaction, so one move_task call (several UPDATE statements) produces a single notification.
create function public.board_notify(p_project_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'taskboard.rt.' || p_event || '.' || p_project_id::text;
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

create function public.tasks_notify_board()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.board_notify(old.project_id, 'project_changed');
  else
    perform public.board_notify(new.project_id, 'project_changed');
  end if;
  return null;
end;
$$;
revoke all on function public.tasks_notify_board() from public, anon, authenticated;

create trigger tasks_notify_board_insert
  after insert on public.tasks
  for each row execute function public.tasks_notify_board();
create trigger tasks_notify_board_update
  after update on public.tasks
  for each row when (old.* is distinct from new.*)
  execute function public.tasks_notify_board();
create trigger tasks_notify_board_delete
  after delete on public.tasks
  for each row execute function public.tasks_notify_board();

-- Membership changes tell connected clients to re-check their access (the payload names no user).
create function public.project_members_notify_board()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.board_notify(old.project_id, 'access_changed');
  else
    perform public.board_notify(new.project_id, 'access_changed');
  end if;
  return null;
end;
$$;
revoke all on function public.project_members_notify_board() from public, anon, authenticated;

create trigger project_members_notify_board
  after insert or delete on public.project_members
  for each row execute function public.project_members_notify_board();
