-- Read-only analytics: one consistent snapshot, full-project totals, existing RLS on every source.
create function public.project_dashboard(p_project_id uuid,p_days integer default 30,p_timezone text default 'UTC')
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
      select id,stage_id,title,done,due_at,created_at from public.tasks where project_id=p_project_id
    ), assigned as materialized (
      select a.task_id,a.user_id from public.task_assignees a join project_tasks t on t.id=a.task_id
    ), totals as (
      select count(*) as total,count(*) filter(where not t.done) as open,
        count(*) filter(where t.done) as completed,
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
