-- An admin "Fill" closes an otherwise empty group class and frees its
-- teacher for private appointments. Change both fields atomically: booking
-- RPCs lock the same session row, so a real booking cannot race the fill.
-- "Unfill" removes the hold but does NOT silently reassign the previous teacher:
-- they may already have accepted a private appointment in the meantime.
create or replace function public.admin_fill_class_and_release_instructor(
  p_session_id uuid,
  p_fill boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_pool text;
  v_live_bookings integer;
  v_previous_instructor uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can fill classes';
  end if;

  if p_fill is null then
    raise exception 'Choose Fill or Unfill';
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Class not found';
  end if;

  if v_session.status <> 'scheduled' then
    raise exception 'Cancelled classes cannot be filled or reopened';
  end if;

  select coalesce(pool, 'regular') into v_pool
  from public.class_types
  where id = v_session.class_type_id;

  if coalesce(v_pool,'') <> 'regular' then
    raise exception 'This action is only for group classes';
  end if;

  if p_fill then
    if v_session.starts_at <= now() then
      raise exception 'Past or started classes cannot be manually filled';
    end if;

    -- Never release the instructor if anyone is booked, attended, or waiting.
    -- Fake held seats are not bookings and do not affect payroll.
    select count(*) into v_live_bookings
    from public.bookings
    where session_id = p_session_id
      and status in ('booked','attended','waitlisted');

    if v_live_bookings > 0 then
      raise exception 'This class has customer bookings or a waitlist. Cancel or reassign those bookings before releasing the instructor.';
    end if;

    v_previous_instructor := v_session.instructor_id;

    update public.sessions
    set filler_seats = capacity,
        instructor_id = null
    where id = p_session_id;

    return jsonb_build_object(
      'filled', true,
      'released_instructor_id', v_previous_instructor
    );
  end if;

  update public.sessions
  set filler_seats = 0
  where id = p_session_id;

  return jsonb_build_object('filled', false, 'released_instructor_id', null);
end;
$$;

revoke all on function public.admin_fill_class_and_release_instructor(uuid,boolean)
  from public, anon;
grant execute on function public.admin_fill_class_and_release_instructor(uuid,boolean)
  to authenticated;
