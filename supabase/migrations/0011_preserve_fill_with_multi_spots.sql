-- Preserve class-fill holds alongside multi-spot bookings.
alter table sessions
  add column if not exists filler_seats int not null default 0;

do $$ begin
  alter table sessions
    add constraint sessions_filler_seats_chk
    check (filler_seats >= 0 and filler_seats <= capacity);
exception when duplicate_object then null;
end $$;

-- book_session now treats held seats + booked/attended spots as occupied.
create or replace function book_session(p_session_id uuid, p_spots int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer   uuid;
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

  v_customer := ensure_customer();

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
    select 1 from bookings
    where session_id = p_session_id
      and customer_id = v_customer
      and status in ('booked', 'waitlisted', 'attended')
  ) then
    raise exception 'You already have a booking for this class';
  end if;

  select credits_cost, coalesce(pool, 'regular')
    into v_cost, v_pool
  from class_types
  where id = v_session.class_type_id;

  v_cost := coalesce(v_cost, 1);
  v_total_cost := v_cost * p_spots;
  v_balance := credit_balance(v_customer, v_pool);

  if v_balance < v_total_cost then
    raise exception 'Not enough credits (need %, have %)', v_total_cost, v_balance;
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

  insert into bookings (session_id, customer_id, status, credits_spent, spots_count)
  values (
    p_session_id,
    v_customer,
    v_status,
    case when v_status = 'booked' then v_total_cost else 0 end,
    p_spots
  )
  on conflict (session_id, customer_id) do update
    set status = excluded.status,
        credits_spent = excluded.credits_spent,
        spots_count = excluded.spots_count,
        cancelled_at = null,
        checked_in_at = null,
        booked_at = now()
  returning * into v_booking;

  if v_status = 'booked' then
    insert into credit_ledger (customer_id, delta, reason, booking_id, pool)
    values (v_customer, -v_total_cost, 'booking', v_booking.id, v_pool);
  end if;

  return to_jsonb(v_booking);
end;
$$;

create or replace function cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer      uuid;
  v_booking       bookings%rowtype;
  v_session       sessions%rowtype;
  v_next          bookings%rowtype;
  v_cost          int;
  v_total_cost    int;
  v_pool          text;
  v_occupied      int;
  v_available     int;
  v_next_balance  int;
begin
  v_customer := my_customer_id();

  select * into v_booking
  from bookings
  where id = p_booking_id
  for update;

  if not found then raise exception 'Booking not found'; end if;

  if v_booking.customer_id <> v_customer and not is_admin() then
    raise exception 'Not authorised to cancel this booking';
  end if;

  if v_booking.status in ('cancelled', 'attended', 'no_show') then
    raise exception 'Booking cannot be cancelled';
  end if;

  select * into v_session
  from sessions
  where id = v_booking.session_id
  for update;

  select coalesce(credits_cost, 1), coalesce(pool, 'regular')
    into v_cost, v_pool
  from class_types
  where id = v_session.class_type_id;

  update bookings
  set status = 'cancelled',
      cancelled_at = now()
  where id = v_booking.id;

  if v_booking.credits_spent > 0 then
    insert into credit_ledger (customer_id, delta, reason, booking_id, pool)
    values (
      v_booking.customer_id,
      v_booking.credits_spent,
      'refund',
      v_booking.id,
      v_pool
    );
  end if;

  if v_booking.status in ('booked', 'attended')
     and coalesce(v_session.filler_seats, 0) = 0 then
    select coalesce(sum(spots_count), 0)::int
      into v_occupied
    from bookings
    where session_id = v_booking.session_id
      and status in ('booked', 'attended');

    v_available := greatest(v_session.capacity - v_occupied, 0);

    for v_next in
      select *
      from bookings
      where session_id = v_booking.session_id
        and status = 'waitlisted'
      order by booked_at asc
      for update
    loop
      exit when v_available <= 0;

      if v_next.spots_count <= v_available then
        v_total_cost := v_cost * v_next.spots_count;
        v_next_balance := credit_balance(v_next.customer_id, v_pool);

        if v_next_balance >= v_total_cost then
          update bookings
          set status = 'booked',
              credits_spent = v_total_cost
          where id = v_next.id;

          insert into credit_ledger (customer_id, delta, reason, booking_id, pool)
          values (
            v_next.customer_id,
            -v_total_cost,
            'booking',
            v_next.id,
            v_pool
          );

          v_available := v_available - v_next.spots_count;
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
