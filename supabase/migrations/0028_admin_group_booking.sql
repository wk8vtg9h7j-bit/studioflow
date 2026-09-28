-- ============================================================================
-- Admin booking for group classes and quick customer creation.
--
-- Mirrors the customer-facing book_session rules, but accepts an explicit
-- customer id so reception can book on a member's behalf. A second helper
-- creates a no-login customer with the same +1 / 30-day starter credit as
-- public signup, then books that customer atomically.
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
  v_session    sessions%rowtype;
  v_cost       int;
  v_total_cost int;
  v_pool       text;
  v_occupied   int;
  v_status     booking_status;
  v_balance    int;
  v_booking    bookings%rowtype;
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
  if v_session.status <> 'scheduled' then
    raise exception 'Session is not open for booking';
  end if;
  if v_session.starts_at <= now() then
    raise exception 'Session has already started';
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

  if v_occupied + coalesce(v_session.filler_seats, 0) + p_spots <= v_session.capacity then
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
    source
  )
  values (
    p_session_id,
    p_customer_id,
    v_status,
    case when v_status = 'booked' then v_total_cost else 0 end,
    p_spots,
    'admin'
  )
  on conflict (session_id, customer_id) do update
    set status = excluded.status,
        credits_spent = excluded.credits_spent,
        spots_count = excluded.spots_count,
        source = 'admin',
        cancelled_at = null,
        checked_in_at = null,
        booked_at = now()
  returning * into v_booking;

  if v_status = 'booked' then
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

create or replace function public.admin_create_customer_and_book(
  p_session_id uuid,
  p_name text,
  p_email text default null,
  p_spots integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_booking jsonb;
  v_name text;
  v_email text;
begin
  v_name := nullif(trim(p_name), '');
  v_email := nullif(lower(trim(p_email)), '');

  if v_name is null then
    raise exception 'Enter the customer name';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Customer name is too long';
  end if;
  if v_email is not null and char_length(v_email) > 320 then
    raise exception 'Email is too long';
  end if;

  insert into customers (
    profile_id,
    name,
    email,
    status,
    source
  )
  values (
    null,
    v_name,
    v_email,
    'active',
    'admin-booking'
  )
  returning id into v_customer_id;

  -- Exactly the same starter-credit economics as public signup:
  -- +1 regular adjustment, expires after 30 days, never counted as revenue.
  insert into credit_ledger (
    customer_id,
    delta,
    reason,
    package_id,
    booking_id,
    pool,
    expires_at
  )
  values (
    v_customer_id,
    1,
    'adjustment',
    null,
    null,
    'regular',
    now() + interval '30 days'
  );

  v_booking := admin_book_customer(
    p_session_id,
    v_customer_id,
    p_spots
  );

  return jsonb_build_object(
    'customer_id', v_customer_id,
    'booking', v_booking
  );
end;
$$;

revoke all on function public.admin_book_customer(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.admin_book_customer(uuid, uuid, integer)
  to service_role;

revoke all on function public.admin_create_customer_and_book(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_create_customer_and_book(uuid, text, text, integer)
  to service_role;
