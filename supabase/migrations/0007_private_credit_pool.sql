-- ============================================================================
-- StudioFlow — separate credit pools.
--
-- Credits now belong to a "pool": 'regular' (default) or 'private'. Private
-- packages grant private credits; private class types consume private credits;
-- the two pools never mix. Existing rows default to 'regular', so nothing about
-- the current regular-class flow changes.
--
-- Replaces the pool-unaware credit_balance / book_session / cancel_booking
-- defined in 0002_functions_rls.sql.
-- ============================================================================
alter table credit_ledger add column if not exists pool text not null default 'regular';
alter table packages      add column if not exists pool text not null default 'regular';
alter table class_types   add column if not exists pool text not null default 'regular';

-- ----------------------------------------------------------------------------
-- Pool-aware balance (replaces the single-arg version). Treats NULL as regular.
-- ----------------------------------------------------------------------------
drop function if exists credit_balance(uuid);
create or replace function credit_balance(p_customer uuid, p_pool text default 'regular')
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int
  from credit_ledger
  where customer_id = p_customer
    and coalesce(pool, 'regular') = p_pool
    and (expires_at is null or expires_at > now());
$$;

-- ----------------------------------------------------------------------------
-- book_session — deduct from (and check) the class type's pool.
-- ----------------------------------------------------------------------------
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

  select count(*) into v_booked
  from bookings where session_id = p_session_id and status = 'booked';

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

-- ----------------------------------------------------------------------------
-- cancel_booking — refund into the class type's pool; promote waitlist in pool.
-- ----------------------------------------------------------------------------
create or replace function cancel_booking(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_booking  bookings%rowtype;
  v_session  sessions%rowtype;
  v_next     bookings%rowtype;
  v_cost     int;
  v_pool     text;
begin
  v_customer := my_customer_id();
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if v_booking.customer_id <> v_customer and not is_admin() then
    raise exception 'Not authorised to cancel this booking';
  end if;
  if v_booking.status in ('cancelled', 'attended', 'no_show') then
    raise exception 'Booking cannot be cancelled';
  end if;

  select * into v_session from sessions where id = v_booking.session_id;
  select coalesce(pool, 'regular') into v_pool
  from class_types where id = v_session.class_type_id;

  update bookings set status = 'cancelled', cancelled_at = now()
  where id = v_booking.id;

  if v_booking.credits_spent > 0 then
    insert into credit_ledger (customer_id, delta, reason, booking_id, pool)
    values (v_booking.customer_id, v_booking.credits_spent, 'refund', v_booking.id, v_pool);
  end if;

  if v_booking.status = 'booked' then
    select * into v_next from bookings
    where session_id = v_booking.session_id and status = 'waitlisted'
    order by booked_at asc limit 1 for update;

    if found then
      select credits_cost into v_cost from class_types where id = v_session.class_type_id;
      v_cost := coalesce(v_cost, 1);
      update bookings set status = 'booked', credits_spent = v_cost where id = v_next.id;
      insert into credit_ledger (customer_id, delta, reason, booking_id, pool)
      values (v_next.customer_id, -v_cost, 'booking', v_next.id, v_pool);
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $$;
