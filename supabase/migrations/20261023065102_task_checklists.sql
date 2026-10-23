create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  text text not null check (text=btrim(text) and char_length(text) between 1 and 500),
  completed boolean not null default false,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_checklist_items_task_position_key unique(task_id,position) deferrable initially deferred
);
-- The unique index also covers parent-task lookups, ordered reads and cascades.
alter table public.task_checklist_items enable row level security;
revoke all on public.task_checklist_items from public,anon,authenticated;
grant select,delete on public.task_checklist_items to authenticated;
grant insert(task_id,text,completed,position) on public.task_checklist_items to authenticated;
grant update(text,completed,position) on public.task_checklist_items to authenticated;
create policy task_checklist_select on public.task_checklist_items for select to authenticated
using(exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create policy task_checklist_insert on public.task_checklist_items for insert to authenticated
with check(exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create policy task_checklist_update on public.task_checklist_items for update to authenticated
using(exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)))
with check(exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create policy task_checklist_delete on public.task_checklist_items for delete to authenticated
using(exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create trigger task_checklist_set_updated_at before update on public.task_checklist_items
for each row execute function public.set_updated_at();

-- One RLS-protected snapshot, including empty checklists; JSON avoids API row-limit truncation.
create function public.get_task_checklist(p_task_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.tasks where id=p_task_id) then
    raise exception 'Task not found' using errcode='P0002';
  end if;
  return (select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(c) order by c.position,c.id),'[]'::jsonb),
    'total',count(*),'completed',count(*) filter(where c.completed)) from public.task_checklist_items c where c.task_id=p_task_id);
end;
$$;

-- All UI writes serialize on the same project lock as task moves/deletions.
-- Task and item access are rechecked after locking. Only checklist rows are changed.
create function public.write_task_checklist(
  p_task_id uuid, p_action text, p_item_id uuid default null, p_text text default null,
  p_completed boolean default null, p_order uuid[] default null, p_expected_order uuid[] default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_project uuid; v_current uuid[]; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select t.project_id into v_project from public.tasks t where t.id=p_task_id;
  if not found or not public.lock_project_for_task_changes(v_project) then
    raise exception 'Task not found' using errcode='P0002';
  end if;
  perform 1 from public.tasks where id=p_task_id and project_id=v_project for update;
  if not found then raise exception 'Task not found' using errcode='P0002'; end if;
  if p_action='add' then
    insert into public.task_checklist_items(task_id,text,position)
    select p_task_id,btrim(p_text),coalesce(max(c.position)+1,0) from public.task_checklist_items c where c.task_id=p_task_id
    returning id into v_id;
    return v_id;
  elsif p_action='edit' then
    update public.task_checklist_items set text=btrim(p_text) where id=p_item_id and task_id=p_task_id;
  elsif p_action='complete' then
    if p_completed is null then raise exception 'Completion is required' using errcode='22023'; end if;
    update public.task_checklist_items set completed=p_completed where id=p_item_id and task_id=p_task_id;
  elsif p_action='delete' then
    delete from public.task_checklist_items where id=p_item_id and task_id=p_task_id;
    if not found then raise exception 'Checklist item not found' using errcode='P0002'; end if;
    update public.task_checklist_items c set position=ordered.position
    from(select id,(row_number() over(order by position,id)-1)::integer as position
      from public.task_checklist_items where task_id=p_task_id) ordered
    where c.id=ordered.id and c.position<>ordered.position;
    return p_item_id;
  elsif p_action='reorder' then
    select coalesce(array_agg(id order by position,id),'{}'::uuid[]) into v_current
    from public.task_checklist_items where task_id=p_task_id;
    if p_expected_order is distinct from v_current then
      raise exception 'Checklist changed. Reload before reordering.' using errcode='40001';
    end if;
    if p_order is null or cardinality(p_order)<>cardinality(v_current)
      or array_position(p_order,null) is not null
      or (select count(distinct x) from unnest(p_order) x)<>cardinality(v_current)
      or not (p_order @> v_current and p_order <@ v_current) then
      raise exception 'Invalid checklist order' using errcode='22023';
    end if;
    update public.task_checklist_items c set position=ordered.position::integer-1
    from unnest(p_order) with ordinality ordered(id,position)
    where c.id=ordered.id and c.task_id=p_task_id and c.position<>ordered.position-1;
    return p_task_id;
  else
    raise exception 'Invalid checklist action' using errcode='22023';
  end if;
  if not found then raise exception 'Checklist item not found' using errcode='P0002'; end if;
  return p_item_id;
end;
$$;

create function public.task_checklist_progress(p_task_ids uuid[])
returns table(task_id uuid,total bigint,completed bigint)
language sql stable security invoker set search_path='' as $$
  select t.id,count(c.id),count(c.id) filter(where c.completed)
  from public.tasks t left join public.task_checklist_items c on c.task_id=t.id
  where t.id=any(p_task_ids[1:500]) group by t.id;
$$;
revoke all on function public.get_task_checklist(uuid) from public,anon,authenticated;
revoke all on function public.write_task_checklist(uuid,text,uuid,text,boolean,uuid[],uuid[]) from public,anon,authenticated;
revoke all on function public.task_checklist_progress(uuid[]) from public,anon,authenticated;
grant execute on function public.get_task_checklist(uuid) to authenticated;
grant execute on function public.write_task_checklist(uuid,text,uuid,text,boolean,uuid[],uuid[]) to authenticated;
grant execute on function public.task_checklist_progress(uuid[]) to authenticated;

create schema if not exists private;
create function private.task_checklist_notify_board() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_project uuid;
begin
  select t.project_id into v_project from public.tasks t
  where t.id=case when tg_op='DELETE' then old.task_id else new.task_id end;
  if auth.uid() is not null and v_project is not null and public.can_access_project(v_project) then
    perform public.board_notify(v_project,'project_changed');
  end if;
  return null;
end;
$$;
revoke all on function private.task_checklist_notify_board() from public,anon,authenticated;
create trigger task_checklist_notify_board after insert or update or delete on public.task_checklist_items
for each row execute function private.task_checklist_notify_board();
