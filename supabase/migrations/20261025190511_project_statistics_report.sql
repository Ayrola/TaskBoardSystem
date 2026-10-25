-- One read-only snapshot for full-project PDF statistics and a retained-task register.
create function public.project_statistics_report(
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
    with ts as materialized(select id,project_id,stage_id,title,done,created_at,due_at,position from public.tasks where project_id=p_project_id),
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
      'events',coalesce((select jsonb_agg(jsonb_build_object('id',h.id::text,'task_id',h.task_id,'event_type',h.event_type,'created_at',h.created_at,'completed',h.changes->'completed','stage',h.changes->'stage') order by h.created_at,h.id)
        from history h where h.created_at>=v_from and h.created_at<v_until),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.project_statistics_report(uuid,integer,date,date,text) from public,anon,authenticated;
grant execute on function public.project_statistics_report(uuid,integer,date,date,text) to authenticated;
