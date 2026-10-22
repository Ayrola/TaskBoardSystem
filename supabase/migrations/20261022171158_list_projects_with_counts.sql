-- Lists accessible projects with exact stage and task counts.
-- Each count is its own correlated subquery, so stages x tasks are never joined
-- together and counts cannot be multiplied. SECURITY INVOKER: RLS decides which
-- projects (and therefore which stages and tasks) the caller can see.
create function public.list_projects_with_counts()
returns table (
  id uuid,
  title text,
  description text,
  created_at timestamptz,
  stage_count bigint,
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
    p.id,
    p.title,
    p.description,
    p.created_at,
    (select count(*) from public.project_stages s where s.project_id = p.id),
    (select count(*) from public.tasks t where t.project_id = p.id and not t.done),
    (select count(*) from public.tasks t where t.project_id = p.id and t.done)
  from public.projects p
  order by p.created_at desc, p.id;
end;
$$;

revoke all on function public.list_projects_with_counts() from public, anon;
grant execute on function public.list_projects_with_counts() to authenticated;
