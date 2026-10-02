-- ============================================================================
-- Allow reception/admin to register walk-ins after a class has started.
--
-- Customer self-booking stays unchanged. Admin bookings into historical classes
-- are recorded as attended immediately, consume the normal class credit, and do
-- not enter the waitlist or queue a late booking-confirmation email.
-- ============================================================================

create or replace function public.admin_book_customer(
  p_session_id uuid,
  p_customer_id uuid,
  p_spots integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session     sessions%rowtype;
  v_cost        int;
  v_total_cost  int;
  v_pool        text;
  v_occupied    int;
  v_status      booking_status;
  v_balance     int;
  v_booking     bookings%rowtype;
  v_has_started boolean;
begin
  if p_spots not in (1, 2) then
    raise exception 'Choose 1 or 2 spots';
  end if;

  if not exists (select 1 from customers where id = p_customer_id) then
    raise exception 'Customer not found';
  end if;

  select * into v_session
  from sessions
  where id = p_session_id
  for update;

  if not found then raise exception 'Session not found'; end if;
  if v_session.status not in ('scheduled', 'completed') then
    raise exception 'Session is not open for admin registration';
  end if;

  v_has_started := v_session.starts_at <= now();

  -- Future admin bookings still follow the normal scheduled-session rules.
  -- Completed is accepted only for historical walk-in registration.
  if not v_has_started and v_session.status <> 'scheduled' then
    raise exception 'Session is not open for booking';
  end if;

  if exists (
    select 1
    from bookings
    where session_id = p_session_id
      and customer_id = p_customer_id
      and status in ('booked', 'waitlisted', 'attended')
  ) then
    raise exception 'This customer already has a booking for this class';
  end if;

  select credits_cost, coalesce(pool, 'regular')
    into v_cost, v_pool
  from class_types
  where id = v_session.class_type_id;

  v_cost := coalesce(v_cost, 1);
  v_total_cost := v_cost * p_spots;
  v_balance := credit_balance(p_customer_id, v_pool);

  if v_balance < v_total_cost then
    raise exception 'Not enough % credits (need %, have %)', v_pool, v_total_cost, v_balance;
  end if;

  select coalesce(sum(spots_count), 0)::int
    into v_occupied
  from bookings
  where session_id = p_session_id
    and status in ('booked', 'attended');

  if v_has_started then
    -- A historical admin registration represents someone who actually attended.
    -- Filler seats are not real attendees, so they do not block a walk-in.
    if v_occupied + p_spots > v_session.capacity then
      raise exception 'Only % real spot(s) available for walk-in registration',
        greatest(v_session.capacity - v_occupied, 0);
    end if;
    v_status := 'attended';
  elsif v_occupied + coalesce(v_session.filler_seats, 0) + p_spots <= v_session.capacity then
    v_status := 'booked';
  elsif coalesce(v_session.filler_seats, 0) > 0 then
    raise exception 'This class is full';
  elsif v_occupied >= v_session.capacity then
    v_status := 'waitlisted';
  else
    raise exception 'Only % spot(s) remaining',
      greatest(v_session.capacity - v_occupied, 0);
  end if;

  insert into bookings (
    session_id,
    customer_id,
    status,
    credits_spent,
    spots_count,
    source,
    checked_in_at
  )
  values (
    p_session_id,
    p_customer_id,
    v_status,
    case when v_status in ('booked', 'attended') then v_total_cost else 0 end,
    p_spots,
    'admin',
    case when v_status = 'attended' then now() else null end
  )
  on conflict (session_id, customer_id) do update
    set status = excluded.status,
        credits_spent = excluded.credits_spent,
        spots_count = excluded.spots_count,
        source = 'admin',
        cancelled_at = null,
        checked_in_at = excluded.checked_in_at,
        booked_at = now()
  returning * into v_booking;

  if v_status in ('booked', 'attended') then
    insert into credit_ledger (
      customer_id, delta, reason, booking_id, pool
    )
    values (
      p_customer_id, -v_total_cost, 'booking', v_booking.id, v_pool
    );
  end if;

  return to_jsonb(v_booking);
end;
$$;

revoke all on function public.admin_book_customer(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.admin_book_customer(uuid, uuid, integer)
  to service_role;
