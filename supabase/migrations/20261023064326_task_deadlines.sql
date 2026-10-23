alter table public.tasks add column due_at timestamptz;
alter table public.tasks add constraint tasks_due_at_finite check (due_at is null or isfinite(due_at));
grant insert (due_at), update (due_at) on public.tasks to authenticated;
create index tasks_open_due_idx on public.tasks(due_at, id) where not done and due_at is not null;
create index tasks_project_open_due_idx on public.tasks(project_id, due_at, id) where not done and due_at is not null;

-- Deadline edits are content changes; position-only updates remain invisible to updated_at.
drop trigger tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update of title, description, stage_id, due_at on public.tasks
for each row execute function public.set_updated_at();

-- Delegate ordering, locking and stage validation to the existing task RPCs.
-- Both content and deadline changes commit or roll back together under the caller's RLS.
create function public.create_task_with_deadline(
  p_project_id uuid, p_stage_id uuid, p_title text, p_description text default null, p_due_at timestamptz default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  v_id := public.create_task(p_project_id, p_stage_id, p_title, p_description);
  if p_due_at is not null then
    update public.tasks set due_at = p_due_at where id = v_id;
    if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;
create function public.update_task_with_deadline(
  p_task_id uuid, p_title text, p_description text, p_stage_id uuid, p_due_at timestamptz
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.update_task(p_task_id, p_title, p_description, p_stage_id);
  update public.tasks set due_at = p_due_at where id = p_task_id;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.create_task_with_deadline(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.update_task_with_deadline(uuid,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.create_task_with_deadline(uuid,uuid,text,text,timestamptz) to authenticated;
grant execute on function public.update_task_with_deadline(uuid,text,text,uuid,timestamptz) to authenticated;

create function public.deadlines_page(
  p_bucket text default 'overdue', p_timezone text default 'UTC', p_project_id uuid default null,
  p_limit integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_now timestamptz := statement_timestamp();
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_lower timestamptz;
  v_upper timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_bucket is null or p_bucket not in ('overdue','today','upcoming') then
    raise exception 'Invalid deadline category' using errcode = '22023';
  end if;
  if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Invalid display timezone' using errcode = '22023';
  end if;
  v_date := (v_now at time zone p_timezone)::date;
  -- Convert each midnight independently: a local day can contain 23 or 25 hours.
  v_start := v_date::timestamp at time zone p_timezone;
  v_end := (v_date + 1)::timestamp at time zone p_timezone;
  v_lower := case p_bucket when 'today' then v_start when 'upcoming' then v_end else '-infinity'::timestamptz end;
  v_upper := case p_bucket when 'overdue' then v_now when 'today' then v_end else 'infinity'::timestamptz end;
  select jsonb_build_object(
    'now', v_now, 'day_start', v_start, 'day_end', v_end, 'timezone', p_timezone,
    'total', (select count(*) from public.tasks t where not t.done and t.due_at is not null
      and t.due_at >= v_lower and t.due_at < v_upper and (p_project_id is null or t.project_id=p_project_id)),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.due_at,page.id) from (
      select t.id,t.project_id,t.stage_id,t.title,t.due_at,(t.due_at < v_now) as overdue,p.title as project_title
      from public.tasks t join public.projects p on p.id=t.project_id
      where not t.done and t.due_at is not null and t.due_at >= v_lower and t.due_at < v_upper
        and (p_project_id is null or t.project_id=p_project_id)
      order by t.due_at,t.id limit least(greatest(coalesce(p_limit,20),1),100) offset greatest(coalesce(p_offset,0),0)
    ) page),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.deadlines_page(text,text,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.deadlines_page(text,text,uuid,integer,integer) to authenticated;
