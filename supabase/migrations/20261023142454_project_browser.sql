-- Search and ordering are applied BEFORE pagination, under the caller's existing RLS.
-- Keep list_projects_page unchanged for sidebar and older clients.
create function public.browse_projects_page(
  p_limit integer default 20, p_offset integer default 0,
  p_search text default '', p_sort text default 'created', p_role text default 'all'
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,20),1),50);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_search text := lower(left(btrim(coalesce(p_search,'')),200));
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_sort is null or p_sort not in ('name','updated','created') or p_role is null or p_role not in ('all','owned','member') then
    raise exception 'Invalid project filters' using errcode = '22023';
  end if;
  return (
    with visible as materialized (
      select p.id,p.title,p.description,p.created_at,p.updated_at,
        p.owner_id = (select auth.uid()) as is_owner,
        exists(select 1 from public.project_members m where m.project_id=p.id and m.user_id=(select auth.uid())) as is_member
      from public.projects p where public.can_access_project(p.id)
    ), filtered as (
      select * from visible
      where (v_search='' or strpos(lower(title),v_search)>0 or strpos(lower(coalesce(description,'')),v_search)>0)
        and (p_role='all' or (p_role='owned' and is_owner) or (p_role='member' and is_member))
    ), ranked as (
      select *, row_number() over(order by
        case when p_sort='name' then lower(title) end asc,
        case when p_sort='updated' then updated_at end desc,
        case when p_sort='created' then created_at end desc, id asc) as ordinal
      from filtered
    ), page as (select * from ranked order by ordinal limit v_limit offset v_offset)
    select jsonb_build_object(
      'accessible_total',(select count(*) from visible), 'total',(select count(*) from filtered),
      'rows',coalesce((select jsonb_agg(jsonb_build_object(
        'id',g.id,'title',g.title,'description',g.description,'created_at',g.created_at,'updated_at',g.updated_at,
        'is_owner',g.is_owner,'is_member',g.is_member,'can_manage',public.can_manage_project(g.id),
        'stage_count',(select count(*) from public.project_stages s where s.project_id=g.id),
        'open_tasks',(select count(*) from public.tasks t where t.project_id=g.id and not t.done),
        'done_tasks',(select count(*) from public.tasks t where t.project_id=g.id and t.done)
      ) order by g.ordinal) from page g),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.browse_projects_page(integer,integer,text,text,text) from public,anon;
grant execute on function public.browse_projects_page(integer,integer,text,text,text) to authenticated;
