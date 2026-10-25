-- Existing rows receive Medium without modifying their content, positions, timestamps or history.
alter table public.tasks add column priority text not null default 'medium'
  constraint tasks_priority_valid check(priority in ('low','medium','high','urgent'));
grant insert(priority),update(priority) on public.tasks to authenticated;

drop trigger tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update of title,description,stage_id,due_at,priority on public.tasks
for each row execute function public.set_updated_at();

create function public.create_task_with_priority(p_project_id uuid,p_stage_id uuid,p_title text,p_description text default null,p_due_at timestamptz default null,p_priority text default 'medium')
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_position integer;v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_priority is null or p_priority not in ('low','medium','high','urgent') then raise exception 'Invalid task priority' using errcode='22023'; end if;
  if not public.lock_project_for_task_changes(p_project_id) then raise exception 'Project not found' using errcode='P0002'; end if;
  perform 1 from public.project_stages where id=p_stage_id and project_id=p_project_id;
  if not found then raise exception 'Stage not found' using errcode='P0002'; end if;
  select coalesce(max(position)+1,0) into v_position from public.tasks where stage_id=p_stage_id;
  insert into public.tasks(project_id,stage_id,title,description,position,due_at,priority)
  values(p_project_id,p_stage_id,p_title,p_description,v_position,p_due_at,p_priority) returning id into v_id;
  return v_id;
end;$$;
revoke all on function public.create_task_with_priority(uuid,uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.create_task_with_priority(uuid,uuid,text,text,timestamptz,text) to authenticated;

-- Reuse the established project lock, stage movement and deadline mutation paths.
-- Older RPCs stay compatible and preserve priority when no priority was submitted.
create function public.update_task_with_priority(p_task_id uuid,p_title text,p_description text,p_stage_id uuid,p_due_at timestamptz,p_priority text,p_preserve_deadline boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_priority is null or p_priority not in ('low','medium','high','urgent') then raise exception 'Invalid task priority' using errcode='22023'; end if;
  if p_preserve_deadline then perform public.update_task(p_task_id,p_title,p_description,p_stage_id);
  else perform public.update_task_with_deadline(p_task_id,p_title,p_description,p_stage_id,p_due_at); end if;
  update public.tasks set priority=p_priority where id=p_task_id and priority is distinct from p_priority;
end;$$;
revoke all on function public.update_task_with_priority(uuid,text,text,uuid,timestamptz,text,boolean) from public,anon,authenticated;
grant execute on function public.update_task_with_priority(uuid,text,text,uuid,timestamptz,text,boolean) to authenticated;

create or replace function public.save_task_form(
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
  if p_values ? 'priority' and (jsonb_typeof(p_values->'priority') is distinct from 'string' or p_values->>'priority' not in ('low','medium','high','urgent')) then raise exception 'Invalid task priority' using errcode='22023'; end if;
  v_stage:=(p_values->>'stage_id')::uuid;
  select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into v_labels from jsonb_array_elements_text(p_values->'label_ids') x;
  select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into v_assignees from jsonb_array_elements_text(p_values->'assignee_ids') x;
  if exists(select 1 from unnest(v_labels) x where not exists(select 1 from public.project_labels l where l.id=x and l.project_id=p_project_id)) then
    raise exception 'Label not found in this project' using errcode='23514';
  end if;
  if p_task_id is null then
    v_task:=public.create_task_with_priority(p_project_id,v_stage,btrim(p_values->>'title'),p_values->>'description',(p_values->>'due_at')::timestamptz,coalesce(p_values->>'priority','medium'));
  else
    v_task:=p_task_id;
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'text',c.text,'completed',c.completed) order by c.position,c.id),'[]'::jsonb)
      into v_current from public.task_checklist_items c where c.task_id=v_task;
    if p_expected_checklist is distinct from v_current then
      raise exception 'Checklist changed. Reopen the task before saving.' using errcode='40001';
    end if;
    perform public.update_task_with_priority(v_task,btrim(p_values->>'title'),p_values->>'description',v_stage,(p_values->>'due_at')::timestamptz,coalesce(p_values->>'priority',(select priority from public.tasks where id=v_task)));
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


create or replace function private.record_task_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_task public.tasks%rowtype; v_actor uuid := auth.uid(); v_changes jsonb := '{}'::jsonb;
  v_event text; v_old_stage text; v_new_stage text;
begin
  if tg_op='DELETE' then v_task:=old; else v_task:=new; end if;
  -- Project deletion removes its history; do not recreate it during a cascade.
  if not exists(select 1 from public.projects where id=v_task.project_id) then return null; end if;
  if v_actor is not null and not public.can_access_project(v_task.project_id) then
    raise exception 'Project not found' using errcode='P0002';
  end if;
  if tg_op='UPDATE' then
    if old.title is distinct from new.title then
      v_changes:=v_changes || jsonb_build_object('title',jsonb_build_object('from',old.title,'to',new.title));
    end if;
    if old.priority is distinct from new.priority then
      v_changes:=v_changes || jsonb_build_object('priority',jsonb_build_object('from',old.priority,'to',new.priority));
    end if;
    if old.description is distinct from new.description then
      v_changes:=v_changes || jsonb_build_object('description_changed',true);
    end if;
    if old.stage_id is distinct from new.stage_id then
      select name into v_old_stage from public.project_stages where id=old.stage_id;
      select name into v_new_stage from public.project_stages where id=new.stage_id;
      v_changes:=v_changes || jsonb_build_object('stage',jsonb_build_object('from_id',old.stage_id,'from_name',v_old_stage,'to_id',new.stage_id,'to_name',v_new_stage));
    end if;
    if old.done is distinct from new.done then
      v_changes:=v_changes || jsonb_build_object('completed',jsonb_build_object('from',old.done,'to',new.done));
    end if;
    if old.position is distinct from new.position then
      if v_changes='{}'::jsonb and exists(select 1 from private.task_activity_context c
        where c.transaction_id=txid_current() and c.project_id=new.project_id and c.target_task_id is distinct from new.id) then
        return null;
      end if;
      v_changes:=v_changes || jsonb_build_object('position',jsonb_build_object('from',old.position,'to',new.position));
    end if;
    if v_changes='{}'::jsonb then return null; end if;
    v_event:='updated';
  else
    select name into v_new_stage from public.project_stages where id=v_task.stage_id;
    v_changes:=jsonb_build_object('stage',jsonb_build_object('id',v_task.stage_id,'name',v_new_stage),'position',v_task.position,'completed',v_task.done,'priority',v_task.priority);
    v_event:=case when tg_op='INSERT' then 'created' else 'deleted' end;
  end if;
  insert into public.task_activity(project_id,task_id,task_title,actor_id,event_type,changes)
  values(v_task.project_id,v_task.id,v_task.title,v_actor,v_event,v_changes);
  return null;
end;
$$;

-- Read-only analytics: one consistent snapshot, full-project totals, existing RLS on every source.
create or replace function public.project_dashboard(p_project_id uuid,p_days integer default 30,p_timezone text default 'UTC')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_now timestamptz := statement_timestamp();
  v_today date;
  v_start timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_days is null or p_days not in (7,30,90) then raise exception 'Invalid period' using errcode='22023'; end if;
  if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Invalid timezone' using errcode='22023';
  end if;
  if not exists(select 1 from public.projects where id=p_project_id and public.can_access_project(id)) then
    raise exception 'Project not found' using errcode='P0002';
  end if;
  v_today := (v_now at time zone p_timezone)::date;
  v_start := (v_today-(p_days-1))::timestamp at time zone p_timezone;
  return (
    with project_tasks as materialized (
      select id,stage_id,title,done,due_at,created_at,priority from public.tasks where project_id=p_project_id
    ), assigned as materialized (
      select a.task_id,a.user_id from public.task_assignees a join project_tasks t on t.id=a.task_id
    ), totals as (
      select count(*) as total,count(*) filter(where not t.done) as open,
        count(*) filter(where t.done) as completed,
        count(*) filter(where not t.done and t.priority='high') as high_open,
        count(*) filter(where not t.done and t.priority='urgent') as urgent_open,
        count(*) filter(where not t.done and t.due_at<v_now) as overdue,
        count(*) filter(where not t.done and not exists(select 1 from assigned a where a.task_id=t.id)) as unassigned
      from project_tasks t
    ), stage_counts as (
      select s.id,s.name,s.position,s.is_done,count(t.id) as count
      from public.project_stages s left join project_tasks t on t.stage_id=s.id
      where s.project_id=p_project_id group by s.id,s.name,s.position,s.is_done
    ), creation_counts as (
      select (created_at at time zone p_timezone)::date as day,count(*) as count
      from project_tasks where created_at>=v_start and created_at<=v_now group by 1
    ), days as (
      select v_today - n as day from generate_series(0,p_days-1) n
    ), workload_counts as (
      select a.user_id,count(*) as count,(array_agg(t.id order by t.id))[1] as sample_task
      from assigned a join project_tasks t on t.id=a.task_id where not t.done group by a.user_id
    ), workload as (
      -- Reuse the existing permission-checked label directory, never read auth.users directly here.
      select w.user_id,coalesce(labels.label,'Unavailable user '||left(w.user_id::text,8)) as label,w.count
      from workload_counts w left join lateral (
        select a.label from public.list_task_assignees(array[w.sample_task]) a where a.user_id=w.user_id limit 1
      ) labels on true
    )
    select jsonb_build_object(
      'as_of',v_now,'timezone',p_timezone,'days',p_days,'period_start',v_start,
      'totals',(select to_jsonb(t) from totals t),
      'priorities',(select jsonb_agg(jsonb_build_object('priority',p.name,'count',(select count(*) from project_tasks t where t.priority=p.name),'open_count',(select count(*) from project_tasks t where t.priority=p.name and not t.done)) order by p.ord) from (values('low',1),('medium',2),('high',3),('urgent',4))p(name,ord)),
      'stages',coalesce((select jsonb_agg(to_jsonb(s) order by s.position,s.id) from stage_counts s),'[]'::jsonb),
      'creation',coalesce((select jsonb_agg(jsonb_build_object('day',d.day,'count',coalesce(c.count,0)) order by d.day)
        from days d left join creation_counts c using(day)),'[]'::jsonb),
      'workload',coalesce((select jsonb_agg(to_jsonb(w) order by w.count desc,lower(w.label),w.user_id) from workload w),'[]'::jsonb),
      'deadlines',jsonb_build_object(
        'overdue',coalesce((select jsonb_agg(to_jsonb(d) order by d.due_at,d.id) from (
          select id,title,due_at from project_tasks where not done and due_at<v_now order by due_at,id limit 5
        ) d),'[]'::jsonb),
        'upcoming',coalesce((select jsonb_agg(to_jsonb(d) order by d.due_at,d.id) from (
          select id,title,due_at from project_tasks where not done and due_at>=v_now order by due_at,id limit 5
        ) d),'[]'::jsonb)),
      'activity',coalesce((select jsonb_agg(to_jsonb(a)-'sequence' order by a.created_at desc,a.sequence desc) from (
        select a.id as sequence,a.id::text as id,a.task_id,a.task_title,a.event_type,a.changes,a.created_at,
          exists(select 1 from project_tasks t where t.id=a.task_id) as task_exists
        from public.task_activity a where a.project_id=p_project_id and a.created_at>=v_start and a.created_at<=v_now
        order by a.created_at desc,a.id desc limit 8
      ) a),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.project_dashboard(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.project_dashboard(uuid,integer,text) to authenticated;


-- One read-only snapshot for full-project PDF statistics and a retained-task register.
create or replace function public.project_statistics_report(
  p_project_id uuid,p_days integer default 30,p_start date default null,p_end date default null,p_timezone text default 'UTC'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_now timestamptz:=statement_timestamp(); v_today date; v_start date; v_end date; v_from timestamptz; v_until timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and public.can_access_project(id)) then
    raise exception 'Project not found' using errcode='P0002';
  end if;
  if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Invalid timezone' using errcode='22023';
  end if;
  v_today:=(v_now at time zone p_timezone)::date;
  if p_days is null then
    if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
      or p_start>p_end or p_end>v_today or p_end-p_start>365 then
      raise exception 'Choose a custom period of 1 to 366 calendar days ending no later than today' using errcode='22023';
    end if;
    v_start:=p_start;v_end:=p_end;
  else
    if p_days not in(7,30,90) or p_start is not null or p_end is not null then raise exception 'Invalid reporting period' using errcode='22023'; end if;
    v_start:=v_today-(p_days-1);v_end:=v_today;
  end if;
  v_from:=v_start::timestamp at time zone p_timezone;
  v_until:=least((v_end+1)::timestamp at time zone p_timezone,v_now);
  return (
    with ts as materialized(select id,project_id,stage_id,title,done,created_at,due_at,position,priority from public.tasks where project_id=p_project_id),
    assignments as materialized(select a.task_id,a.user_id from public.task_assignees a join ts on ts.id=a.task_id),
    people_ids as(select user_id,(array_agg(task_id order by task_id))[1] as sample_task from assignments group by user_id),
    people as materialized(
      select p.user_id,case when d.label is null or strpos(d.label,'@')>0 then 'User '||left(p.user_id::text,8) else d.label end as name
      from people_ids p left join lateral(select a.label from public.list_task_assignees(array[p.sample_task]) a where a.user_id=p.user_id limit 1)d on true
    ),
    labels as materialized(select id,name,colour from public.project_labels where project_id=p_project_id),
    links as materialized(select a.task_id,a.label_id from public.task_labels a join ts on ts.id=a.task_id join labels l on l.id=a.label_id where a.project_id=p_project_id),
    history as materialized(
      select a.id,a.task_id,a.event_type,a.created_at,a.changes from public.task_activity a
      where a.project_id=p_project_id and a.created_at<=v_now
        and (a.created_at>=v_from or (a.event_type='updated' and a.changes->'completed'->>'from'='false' and a.changes->'completed'->>'to'='true'))
    ),
    completions as(select task_id,max(created_at) as completed_at from history where event_type='updated' and changes->'completed'->>'from'='false' and changes->'completed'->>'to'='true' group by task_id)
    select jsonb_build_object(
      'project',(select jsonb_build_object('id',id,'title',title,'description',coalesce(description,'')) from public.projects where id=p_project_id),
      'meta',jsonb_build_object('as_of',v_now,'timezone',p_timezone,'start_date',v_start,'end_date',v_end,'start_at',v_from,'end_exclusive',v_until,'due_soon_before',v_now+interval '168 hours'),
      'stages',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'position',position,'is_done',is_done) order by position,id) from public.project_stages where project_id=p_project_id),'[]'::jsonb),
      'labels',coalesce((select jsonb_agg(to_jsonb(l) order by lower(l.name),l.id) from labels l),'[]'::jsonb),
      'people',coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.name),p.user_id) from people p),'[]'::jsonb),
      'tasks',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object(
        'assignee_ids',coalesce((select jsonb_agg(a.user_id order by a.user_id) from assignments a where a.task_id=t.id),'[]'::jsonb),
        'label_ids',coalesce((select jsonb_agg(a.label_id order by a.label_id) from links a where a.task_id=t.id),'[]'::jsonb),
        'completed_at',case when t.done then c.completed_at else null end)
        order by t.created_at,t.id) from ts t left join completions c on c.task_id=t.id),'[]'::jsonb),
      'events',coalesce((select jsonb_agg(jsonb_build_object('id',h.id::text,'task_id',h.task_id,'event_type',h.event_type,'created_at',h.created_at,'completed',h.changes->'completed','stage',h.changes->'stage','priority',h.changes->'priority') order by h.created_at,h.id)
        from history h where h.created_at>=v_from and h.created_at<v_until),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.project_statistics_report(uuid,integer,date,date,text) from public,anon,authenticated;
grant execute on function public.project_statistics_report(uuid,integer,date,date,text) to authenticated;
