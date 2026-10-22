-- Read-only dashboard aggregates over the projects the caller can access.
-- SECURITY INVOKER: RLS on projects/tasks defines "accessible", so when
-- membership is added later only the policies change, not this function.
create function public.get_dashboard_stats()
returns table (
  project_count bigint,
  total_tasks bigint,
  open_tasks bigint,
  done_tasks bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
  select
    (select count(*) from public.projects),
    count(*),
    count(*) filter (where not t.done),
    count(*) filter (where t.done)
  from public.tasks t;
end;
$$;

revoke all on function public.get_dashboard_stats() from public, anon;
grant execute on function public.get_dashboard_stats() to authenticated;
