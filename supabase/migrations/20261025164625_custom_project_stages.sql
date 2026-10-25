-- Abort with a report rather than changing any pre-existing names.
do $$
declare v_duplicates jsonb;
begin
  select jsonb_agg(to_jsonb(d)) into v_duplicates from (
    select project_id, lower(regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g')) as name,
      array_agg(id order by position,id) as stage_ids
    from public.project_stages group by 1,2 having count(*) > 1
  ) d;
  if v_duplicates is not null then
    raise exception 'Duplicate stage names prevent uniqueness: %', v_duplicates using errcode='23505';
  end if;
end;
$$;

create unique index project_stages_project_name_unique
  on public.project_stages(project_id, lower(regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g')));

-- Validate future writes without rewriting legacy names.
alter table public.project_stages add constraint project_stages_name_whitespace
  check (name !~ '^[[:space:]]*$') not valid;

-- All insert paths allocate positions under the same project lock used by task/stage ordering.
-- SECURITY INVOKER: the existing INSERT/UPDATE policies remain the authorization boundary.
create function public.prepare_project_stage()
returns trigger language plpgsql set search_path='' as $$
begin
  new.name := regexp_replace(new.name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if new.name is null or char_length(new.name) not between 1 and 100 then
    raise exception 'Stage name must contain 1 to 100 characters' using errcode='23514';
  end if;
  if tg_op='INSERT' then
    if current_user in ('authenticated','anon') and
      ((select auth.uid()) is null or not public.can_manage_project(new.project_id)) then
      raise exception 'Only project owners and admins may create stages' using errcode='42501';
    end if;
    perform 1 from public.projects where id=new.project_id for no key update;
    if not found then raise exception 'Project not found' using errcode='P0002'; end if;
    select coalesce(max(position)::bigint+1,0)::integer into new.position
      from public.project_stages where project_id=new.project_id;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_project_stage() from public,anon,authenticated;
create trigger project_stages_prepare before insert or update of name on public.project_stages
  for each row execute function public.prepare_project_stage();

create function public.create_project_stage(p_project_id uuid,p_name text,p_is_done boolean default false)
returns uuid language plpgsql set search_path='' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'Only project owners and admins may create stages' using errcode='42501';
  end if;
  if not public.lock_project_for_task_changes(p_project_id) then
    raise exception 'Project not found' using errcode='P0002';
  end if;
  -- Recheck after waiting for the lock. RLS also checks the actual inserted project_id.
  if not public.can_manage_project(p_project_id) then
    raise exception 'Only project owners and admins may create stages' using errcode='42501';
  end if;
  insert into public.project_stages(project_id,name,position,is_done)
    values(p_project_id,p_name,0,coalesce(p_is_done,false)) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_project_stage(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.create_project_stage(uuid,text,boolean) to authenticated;

-- Reuse the private, transaction-deduplicated sender and project-only payload.
create trigger project_stages_notify_board_insert after insert on public.project_stages
  for each row execute function public.tasks_notify_board();
