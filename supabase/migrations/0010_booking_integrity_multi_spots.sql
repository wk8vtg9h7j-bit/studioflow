-- StudioFlow booking integrity + multi-spot bookings
alter table bookings
  add column if not exists spots_count int not null default 1;

do $$ begin
  alter table bookings
    add constraint bookings_spots_count_chk
    check (spots_count between 1 and 2);
exception when duplicate_object then null;
end $$;

-- Instructor overlap protection at the database layer.
create or replace function prevent_instructor_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.instructor_id is null or new.status <> 'scheduled' then
    return new;
  end if;

  if exists (
    select 1
    from sessions s
    where s.instructor_id = new.instructor_id
      and s.id <> new.id
      and s.status = 'scheduled'
      and s.starts_at < new.ends_at
      and s.ends_at > new.starts_at
  ) then
    raise exception 'Instructor is already assigned to an overlapping class';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_instructor_overlap on sessions;
create trigger trg_prevent_instructor_overlap
before insert or update of instructor_id, starts_at, ends_at, status
on sessions
for each row execute function prevent_instructor_overlap();

-- Attendance cannot be marked before a class begins.
create or replace function prevent_early_attendance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_start timestamptz;
begin
  if new.status in ('attended', 'no_show')
     and new.status is distinct from old.status then
    select starts_at into v_start
    from sessions
    where id = new.session_id;

    if v_start is not null and v_start > now() then
      raise exception 'Attendance can only be marked once the class has started';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_early_attendance on bookings;
create trigger trg_prevent_early_attendance
before update of status
on bookings
for each row execute function prevent_early_attendance();

-- Per-head attendance now sums spots rather than booking rows.
create or replace function session_attendance(p_session_id uuid)
returns int
language sql
stable security definer
set search_path = public
as $$
  select coalesce(sum(spots_count), 0)::int
  from bookings
  where session_id = p_session_id
    and status in ('booked', 'attended');
$$;

-- Core booking function with explicit spot count.
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
    select 1
    from bookings
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

  if v_occupied + p_spots <= v_session.capacity then
    v_status := 'booked';
  elsif v_occupied >= v_session.capacity then
    v_status := 'waitlisted';
  else
    raise exception 'Only % spot(s) remaining', v_session.capacity - v_occupied;
  end if;

  insert into bookings (
    session_id,
    customer_id,
    status,
    credits_spent,
    spots_count
  )
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
    insert into credit_ledger (
      customer_id,
      delta,
      reason,
      booking_id,
      pool
    )
    values (
      v_customer,
      -v_total_cost,
      'booking',
      v_booking.id,
      v_pool
    );
  end if;

  return to_jsonb(v_booking);
end;
$$;

-- Backwards-compatible single-spot RPC for older deployed clients.
create or replace function book_session(p_session_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select book_session(p_session_id, 1);
$$;

-- Cancellation refunds the total credits spent and promotes as many eligible
-- waitlisted spot-groups as fit into the newly available capacity.
create or replace function cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer    uuid;
  v_booking     bookings%rowtype;
  v_session     sessions%rowtype;
  v_next        bookings%rowtype;
  v_cost        int;
  v_total_cost  int;
  v_pool        text;
  v_occupied    int;
  v_available   int;
  v_next_balance int;
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
    insert into credit_ledger (
      customer_id,
      delta,
      reason,
      booking_id,
      pool
    )
    values (
      v_booking.customer_id,
      v_booking.credits_spent,
      'refund',
      v_booking.id,
      v_pool
    );
  end if;

  if v_booking.status in ('booked', 'attended') then
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

          insert into credit_ledger (
            customer_id,
            delta,
            reason,
            booking_id,
            pool
          )
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
