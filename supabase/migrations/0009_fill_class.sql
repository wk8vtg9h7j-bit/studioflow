-- ============================================================================
-- StudioFlow — fill a class (hold seats).
--
-- A class with two people booked often gets cancelled, and the two who did book
-- are the ones who suffer. Reception wants the opposite lever: mark a quiet
-- class as full so no more customers can join, and run it with who is there.
--
-- Seats are held with a counter on the session, not with placeholder bookings.
-- Fake booking rows would have to be invented per seat (bookings is unique on
-- (session_id, customer_id) and customer_id is not null), and every count in the
-- system — session_attendance() for payroll, the payments roster, the customer's
-- own list — would need to learn to exclude them. One missed exclusion and an
-- instructor gets paid for heads that were never in the room.
--
-- A counter cannot leak into any of that: it never enters bookings. It is read
-- in exactly two places, both of them customer-facing seat maths (the book page
-- and the public availability API), plus the capacity check below.
--
-- Replaces book_session from 0007_private_credit_pool.sql; the pool logic there
-- is carried over unchanged and only the capacity block differs.
-- ============================================================================
alter table sessions add column if not exists filler_seats int not null default 0;

-- ----------------------------------------------------------------------------
-- book_session — held seats count against capacity, and a held-full class is
-- closed rather than waitlisted.
--
-- The distinction matters: a class that filled up organically should still take
-- a waitlist, because a cancellation genuinely frees a seat. A class that was
-- held full has no queue to join — the seats are not coming back — so the
-- booking is refused outright and the customer sees it as full.
-- ----------------------------------------------------------------------------
create or replace function book_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_session  sessions%rowtype;
  v_cost     int;
  v_pool     text;
  v_filler   int;
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

  select count(*) into v_booked
  from bookings where session_id = p_session_id and status = 'booked';

  v_filler := coalesce(v_session.filler_seats, 0);

  if v_booked + v_filler < v_session.capacity then
    v_status := 'booked';
  elsif v_filler > 0 then
    raise exception 'This class is full';
  else
    v_status := 'waitlisted';
  end if;

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
