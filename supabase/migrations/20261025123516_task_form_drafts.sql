-- Idempotency receipts contain references and a draft fingerprint, never task content or credentials.
-- A receipt survives task deletion so retrying a lost response cannot recreate a deleted task.
create table public.task_creation_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  draft_hash text not null,
  task_id uuid references public.tasks(id) on delete set null,
  primary key(actor_id,request_id)
);
create index task_creation_requests_project_idx on public.task_creation_requests(project_id);
create index task_creation_requests_task_idx on public.task_creation_requests(task_id);
alter table public.task_creation_requests enable row level security;
revoke all on public.task_creation_requests from public,anon,authenticated;
grant select on public.task_creation_requests to authenticated;
grant insert(actor_id,request_id,project_id,task_id,draft_hash) on public.task_creation_requests to authenticated;
create policy task_creation_requests_read on public.task_creation_requests for select to authenticated
using(actor_id=(select auth.uid()) and public.can_access_project(project_id));
create policy task_creation_requests_insert on public.task_creation_requests for insert to authenticated
with check(actor_id=(select auth.uid()) and public.can_access_project(project_id)
  and exists(select 1 from public.tasks t where t.id=task_creation_requests.task_id and t.project_id=task_creation_requests.project_id));

-- Invoker operation: all existing task, label, participant and checklist RLS/triggers still apply.
-- The project lock is the same lock used by create, move, delete and checklist operations.
create function public.save_task_form(
  p_project_id uuid, p_task_id uuid, p_request_id uuid, p_values jsonb,
  p_expected_checklist jsonb default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_task uuid; v_receipt public.task_creation_requests%rowtype; v_stage uuid;
  v_labels uuid[]; v_assignees uuid[]; v_item jsonb; v_id uuid; v_position integer:=0;
  v_current jsonb; v_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not public.lock_project_for_task_changes(p_project_id) then raise exception 'Project not found' using errcode='P0002'; end if;
  if p_task_id is null then
    if p_request_id is null then raise exception 'Creation request required' using errcode='22023'; end if;
    select * into v_receipt from public.task_creation_requests where actor_id=auth.uid() and request_id=p_request_id;
    if found then
      if v_receipt.project_id<>p_project_id or v_receipt.task_id is null then
        raise exception 'This creation request is no longer usable' using errcode='22023';
      end if;
      if v_receipt.draft_hash is distinct from md5(p_values::text) then
        raise exception 'An earlier attempt already created this task. Close this window and reopen it from the board before making more changes.' using errcode='40001';
      end if;
      return v_receipt.task_id;
    end if;
  else
    perform 1 from public.tasks where id=p_task_id and project_id=p_project_id for update;
    if not found then raise exception 'Task not found' using errcode='P0002'; end if;
  end if;
  if jsonb_typeof(p_values) is distinct from 'object'
    or jsonb_typeof(p_values->'label_ids') is distinct from 'array'
    or jsonb_typeof(p_values->'assignee_ids') is distinct from 'array'
    or jsonb_typeof(p_values->'checklist') is distinct from 'array' then
    raise exception 'Invalid task draft' using errcode='22023';
  end if;
  if jsonb_array_length(p_values->'label_ids')>500 or jsonb_array_length(p_values->'assignee_ids')>500
    or jsonb_array_length(p_values->'checklist')>200 then raise exception 'Task draft is too large' using errcode='22023'; end if;
  v_stage:=(p_values->>'stage_id')::uuid;
  select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into v_labels from jsonb_array_elements_text(p_values->'label_ids') x;
  select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into v_assignees from jsonb_array_elements_text(p_values->'assignee_ids') x;
  if exists(select 1 from unnest(v_labels) x where not exists(select 1 from public.project_labels l where l.id=x and l.project_id=p_project_id)) then
    raise exception 'Label not found in this project' using errcode='23514';
  end if;
  if p_task_id is null then
    v_task:=public.create_task_with_deadline(p_project_id,v_stage,btrim(p_values->>'title'),p_values->>'description',(p_values->>'due_at')::timestamptz);
  else
    v_task:=p_task_id;
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'text',c.text,'completed',c.completed) order by c.position,c.id),'[]'::jsonb)
      into v_current from public.task_checklist_items c where c.task_id=v_task;
    if p_expected_checklist is distinct from v_current then
      raise exception 'Checklist changed. Reopen the task before saving.' using errcode='40001';
    end if;
    perform public.update_task_with_deadline(v_task,btrim(p_values->>'title'),p_values->>'description',v_stage,(p_values->>'due_at')::timestamptz);
  end if;
  delete from public.task_labels where task_id=v_task and not(label_id=any(v_labels));
  insert into public.task_labels(task_id,label_id) select v_task,x from unnest(v_labels) x on conflict do nothing;
  delete from public.task_assignees where task_id=v_task and not(user_id=any(v_assignees));
  insert into public.task_assignees(task_id,user_id) select v_task,x from unnest(v_assignees) x on conflict do nothing;
  select coalesce(array_agg((x->>'id')::uuid) filter(where x->>'id' is not null),'{}'::uuid[]) into v_ids from jsonb_array_elements(p_values->'checklist') x;
  if exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.task_checklist_items c where c.id=x and c.task_id=v_task))
    or cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Invalid checklist references' using errcode='22023';
  end if;
  delete from public.task_checklist_items where task_id=v_task and not(id=any(v_ids));
  for v_item in select value from jsonb_array_elements(p_values->'checklist') loop
    if jsonb_typeof(v_item->'text') is distinct from 'string' or jsonb_typeof(v_item->'completed') is distinct from 'boolean' then
      raise exception 'Invalid checklist item' using errcode='22023';
    end if;
    v_id:=(v_item->>'id')::uuid;
    if v_id is null then
      insert into public.task_checklist_items(task_id,text,completed,position)
        values(v_task,btrim(v_item->>'text'),(v_item->>'completed')::boolean,v_position);
    else
      update public.task_checklist_items c set text=btrim(v_item->>'text'),completed=(v_item->>'completed')::boolean,position=v_position
        where c.id=v_id and c.task_id=v_task
          and (c.text,c.completed,c.position) is distinct from (btrim(v_item->>'text'),(v_item->>'completed')::boolean,v_position);
    end if;
    v_position:=v_position+1;
  end loop;
  if p_task_id is null then
    insert into public.task_creation_requests(actor_id,request_id,project_id,task_id,draft_hash) values(auth.uid(),p_request_id,p_project_id,v_task,md5(p_values::text));
  end if;
  return v_task;
end;
$$;
revoke all on function public.save_task_form(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_task_form(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
