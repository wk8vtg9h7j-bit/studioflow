-- ============================================================================
-- StudioFlow — align the capacity count in book_session with the register.
--
-- The register's check-in (attendBooking) counts a seat as taken when a booking
-- is either 'booked' OR 'attended'. book_session, however, only counted
-- 'booked' rows when deciding booked-vs-waitlisted — so a class with checked-in
-- (attended) walk-ins could be over-filled by an online booking. This recreates
-- book_session with the same 'booked' + 'attended' count, so both paths agree.
--
-- Only the capacity count line changes; the pool-aware credit logic from 0009
-- is preserved verbatim.
-- ============================================================================
create or replace function book_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_session  sessions%rowtype;
  v_cost     int;
  v_pool     text;
  v_booked   int;
  v_status   booking_status;
  v_balance  int;
  v_booking  bookings%rowtype;
begin
  v_customer := ensure_customer();

  select * into v_session from sessions where id = p_session_id for update;
  if not found then raise exception 'Session not found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'Session is not open for booking'; end if;
  if v_session.starts_at <= now() then raise exception 'Session has already started'; end if;

  if exists (
    select 1 from bookings
    where session_id = p_session_id and customer_id = v_customer
      and status in ('booked', 'waitlisted')
  ) then
    raise exception 'You already have a booking for this class';
  end if;

  select credits_cost, coalesce(pool, 'regular')
    into v_cost, v_pool
  from class_types where id = v_session.class_type_id;
  v_cost := coalesce(v_cost, 1);

  v_balance := credit_balance(v_customer, v_pool);
  if v_balance < v_cost then
    raise exception 'Not enough credits (need %, have %)', v_cost, v_balance;
  end if;

  -- Seats taken = booked OR already checked-in (attended), matching the register.
  select count(*) into v_booked
  from bookings where session_id = p_session_id and status in ('booked', 'attended');

  if v_booked < v_session.capacity then v_status := 'booked'; else v_status := 'waitlisted'; end if;

  insert into bookings (session_id, customer_id, status, credits_spent)
  values (p_session_id, v_customer, v_status, case when v_status = 'booked' then v_cost else 0 end)
  on conflict (session_id, customer_id) do update
    set status = excluded.status, credits_spent = excluded.credits_spent,
        cancelled_at = null, booked_at = now()
  returning * into v_booking;

  if v_status = 'booked' then
    insert into credit_ledger (customer_id, delta, reason, booking_id, pool)
    values (v_customer, -v_cost, 'booking', v_booking.id, v_pool);
  end if;

  return to_jsonb(v_booking);
end $$;
