-- ============================================================================
-- Admin-filled empty group classes do not reserve instructor availability.
--
-- A session only releases its instructor when:
--   1) filler_seats fills the entire capacity, and
--   2) there are zero real booked/attended customers.
--
-- The trigger also fires when filler_seats/capacity change. Therefore, if an
-- instructor has since been assigned to an overlapping private class, Unfill
-- is rejected instead of silently creating a double-booking.
-- ============================================================================

create or replace function public.prevent_instructor_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new_released boolean := false;
begin
  if new.instructor_id is null or new.status <> 'scheduled' then
    return new;
  end if;

  v_new_released :=
    coalesce(new.filler_seats, 0) >= new.capacity
    and not exists (
      select 1
      from public.bookings b
      where b.session_id = new.id
        and b.status in ('booked', 'attended')
    );

  if v_new_released then
    return new;
  end if;

  if exists (
    select 1
    from public.sessions s
    where s.instructor_id = new.instructor_id
      and s.id <> new.id
      and s.status = 'scheduled'
      and s.starts_at < new.ends_at
      and s.ends_at > new.starts_at
      and not (
        coalesce(s.filler_seats, 0) >= s.capacity
        and not exists (
          select 1
          from public.bookings b
          where b.session_id = s.id
            and b.status in ('booked', 'attended')
        )
      )
  ) then
    raise exception 'Instructor is already assigned to an overlapping class';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_instructor_overlap
  on public.sessions;

create trigger trg_prevent_instructor_overlap
before insert or update of
  instructor_id,
  starts_at,
  ends_at,
  status,
  filler_seats,
  capacity
on public.sessions
for each row
execute function public.prevent_instructor_overlap();
