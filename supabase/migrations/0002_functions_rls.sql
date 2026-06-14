-- ============================================================================
-- StudioFlow — helper functions, business-logic RPCs, and RLS policies
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Role / identity helpers (security definer so they can read profiles freely)
-- ----------------------------------------------------------------------------
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function my_instructor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select i.id from instructors i where i.profile_id = auth.uid();
$$;

create or replace function my_customer_id()
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from customers c where c.profile_id = auth.uid();
$$;

-- Ensure a CRM customer row exists for the current user; returns its id.
create or replace function ensure_customer()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  select id into cid from customers where profile_id = auth.uid();
  if cid is null then
    insert into customers (profile_id, status) values (auth.uid(), 'active')
    returning id into cid;
  end if;
  return cid;
end $$;

-- Current confirmed credit balance for a customer.
create or replace function credit_balance(p_customer uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int
  from credit_ledger
  where customer_id = p_customer
    and (expires_at is null or expires_at > now());
$$;

-- ----------------------------------------------------------------------------
-- book_session — atomic booking with capacity + waitlist + credit spend
-- Returns the booking row as jsonb. Runs as caller's customer record.
-- ----------------------------------------------------------------------------
create or replace function book_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer  uuid;
  v_session   sessions%rowtype;
  v_cost      int;
  v_booked    int;
  v_status    booking_status;
  v_balance   int;
  v_booking   bookings%rowtype;
begin
  v_customer := ensure_customer();

  select * into v_session from sessions where id = p_session_id for update;
  if not found then raise exception 'Session not found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'Session is not open for booking'; end if;
  if v_session.starts_at <= now() then raise exception 'Session has already started'; end if;

  -- already have an active booking?
  if exists (
    select 1 from bookings
    where session_id = p_session_id and customer_id = v_customer
      and status in ('booked', 'waitlisted')
  ) then
    raise exception 'You already have a booking for this class';
  end if;

  select credits_cost into v_cost
  from class_types where id = v_session.class_type_id;
  v_cost := coalesce(v_cost, 1);

  v_balance := credit_balance(v_customer);
  if v_balance < v_cost then
    raise exception 'Not enough credits (need %, have %)', v_cost, v_balance;
  end if;

  -- seat or waitlist?
  select count(*) into v_booked
  from bookings where session_id = p_session_id and status = 'booked';

  if v_booked < v_session.capacity then
    v_status := 'booked';
  else
    v_status := 'waitlisted';
  end if;

  insert into bookings (session_id, customer_id, status, credits_spent)
  values (p_session_id, v_customer, v_status, case when v_status = 'booked' then v_cost else 0 end)
  on conflict (session_id, customer_id) do update
    set status = excluded.status, credits_spent = excluded.credits_spent,
        cancelled_at = null, booked_at = now()
  returning * into v_booking;

  -- spend credits only when an actual seat is taken
  if v_status = 'booked' then
    insert into credit_ledger (customer_id, delta, reason, booking_id)
    values (v_customer, -v_cost, 'booking', v_booking.id);
  end if;

  return to_jsonb(v_booking);
end $$;

-- ----------------------------------------------------------------------------
-- cancel_booking — release seat, refund credits, promote first waitlister
-- ----------------------------------------------------------------------------
create or replace function cancel_booking(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_booking  bookings%rowtype;
  v_session  sessions%rowtype;
  v_next     bookings%rowtype;
  v_cost     int;
begin
  v_customer := my_customer_id();
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  -- caller must own the booking unless admin
  if v_booking.customer_id <> v_customer and not is_admin() then
    raise exception 'Not authorised to cancel this booking';
  end if;
  if v_booking.status in ('cancelled', 'attended', 'no_show') then
    raise exception 'Booking cannot be cancelled';
  end if;

  select * into v_session from sessions where id = v_booking.session_id;

  update bookings set status = 'cancelled', cancelled_at = now()
  where id = v_booking.id;

  -- refund spent credits
  if v_booking.credits_spent > 0 then
    insert into credit_ledger (customer_id, delta, reason, booking_id)
    values (v_booking.customer_id, v_booking.credits_spent, 'refund', v_booking.id);
  end if;

  -- promote the oldest waitlisted booking into the freed seat
  if v_booking.status = 'booked' then
    select * into v_next from bookings
    where session_id = v_booking.session_id and status = 'waitlisted'
    order by booked_at asc limit 1 for update;

    if found then
      select credits_cost into v_cost from class_types where id = v_session.class_type_id;
      v_cost := coalesce(v_cost, 1);
      update bookings set status = 'booked', credits_spent = v_cost where id = v_next.id;
      insert into credit_ledger (customer_id, delta, reason, booking_id)
      values (v_next.customer_id, -v_cost, 'booking', v_next.id);
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table profiles        enable row level security;
alter table studios         enable row level security;
alter table class_types     enable row level security;
alter table instructors     enable row level security;
alter table customers       enable row level security;
alter table packages        enable row level security;
alter table credit_ledger   enable row level security;
alter table pay_rules       enable row level security;
alter table sessions        enable row level security;
alter table bookings        enable row level security;
alter table session_payroll enable row level security;
alter table google_sync_log enable row level security;

-- profiles -------------------------------------------------------------------
create policy "profiles self read"  on profiles for select using (id = auth.uid() or is_admin());
create policy "profiles self update" on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles admin all"  on profiles for all using (is_admin()) with check (is_admin());

-- studios: public can read active studios; admins manage ---------------------
create policy "studios public read" on studios for select using (active or is_admin());
create policy "studios admin write" on studios for all using (is_admin()) with check (is_admin());

-- class_types: public read active; admin manage -----------------------------
create policy "class_types public read" on class_types for select using (active or is_admin());
create policy "class_types admin write" on class_types for all using (is_admin()) with check (is_admin());

-- instructors: public read active; instructor reads self; admin manage ------
create policy "instructors public read" on instructors for select using (active or is_admin() or profile_id = auth.uid());
create policy "instructors admin write" on instructors for all using (is_admin()) with check (is_admin());

-- customers: owner + admin ---------------------------------------------------
create policy "customers owner read" on customers for select using (profile_id = auth.uid() or is_admin());
create policy "customers owner write" on customers for update using (profile_id = auth.uid() or is_admin()) with check (profile_id = auth.uid() or is_admin());
create policy "customers admin all" on customers for all using (is_admin()) with check (is_admin());

-- packages: public read active; admin manage --------------------------------
create policy "packages public read" on packages for select using (active or is_admin());
create policy "packages admin write" on packages for all using (is_admin()) with check (is_admin());

-- credit_ledger: customer reads own; admin all -------------------------------
create policy "credits owner read" on credit_ledger for select using (
  is_admin() or customer_id = my_customer_id()
);
create policy "credits admin write" on credit_ledger for all using (is_admin()) with check (is_admin());

-- pay_rules: admin only; instructor can read rules that target them ----------
create policy "pay_rules admin all" on pay_rules for all using (is_admin()) with check (is_admin());
create policy "pay_rules instructor read" on pay_rules for select using (
  is_admin() or instructor_id = my_instructor_id() or instructor_id is null
);

-- sessions: public read scheduled; instructor reads own; admin manage -------
create policy "sessions public read" on sessions for select using (
  status <> 'cancelled' or is_admin() or instructor_id = my_instructor_id()
);
create policy "sessions admin write" on sessions for all using (is_admin()) with check (is_admin());

-- bookings: customer owns; instructor sees roster of own sessions; admin all -
create policy "bookings customer read" on bookings for select using (
  is_admin()
  or customer_id = my_customer_id()
  or exists (
    select 1 from sessions s
    where s.id = bookings.session_id and s.instructor_id = my_instructor_id()
  )
);
create policy "bookings admin write" on bookings for all using (is_admin()) with check (is_admin());
-- (customers create/cancel via the book_session / cancel_booking RPCs)

-- session_payroll: instructor sees + confirms own; admin all -----------------
create policy "payroll instructor read" on session_payroll for select using (
  is_admin() or instructor_id = my_instructor_id()
);
create policy "payroll instructor confirm" on session_payroll for update using (
  instructor_id = my_instructor_id()
) with check (
  instructor_id = my_instructor_id()
);
create policy "payroll admin all" on session_payroll for all using (is_admin()) with check (is_admin());

-- google_sync_log: admin only ----------------------------------------------
create policy "sync log admin" on google_sync_log for all using (is_admin()) with check (is_admin());
