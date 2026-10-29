-- Enforce authentication, ownership and the existing three-hour customer rule
-- at the database boundary as well as in the customer application.
create or replace function public.cancel_booking(p_booking_id uuid)
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
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authentication required';
  end if;
  v_customer := my_customer_id();

  select * into v_booking
  from bookings
  where id = p_booking_id
  for update;

  if not found then raise exception 'Booking not found'; end if;

  if v_booking.customer_id is distinct from v_customer
     and not coalesce(is_admin(), false)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorised to cancel this booking';
  end if;

  if v_booking.status in ('cancelled', 'attended', 'no_show') then
    raise exception 'Booking cannot be cancelled';
  end if;

  select * into v_session
  from sessions
  where id = v_booking.session_id
  for update;

  if not coalesce(is_admin(), false)
     and coalesce(auth.role(), '') <> 'service_role'
     and v_session.starts_at <= now() + interval '3 hours' then
    raise exception 'This class starts within 3 hours, so it can no longer be cancelled and the credit stays used.';
  end if;

  select coalesce(credits_cost, 1), coalesce(pool, 'regular')
    into v_cost, v_pool
  from class_types
  where id = v_session.class_type_id;

  -- Trace and create the refund BEFORE flipping the booking status. If lineage
  -- cannot be reconstructed, the whole transaction aborts instead of granting
  -- an incorrect permanent credit.
  if v_booking.credits_spent > 0 then
    perform public.refund_booking_credits_preserving_expiry(
      v_booking.id,
      v_booking.customer_id,
      v_pool
    );
  end if;

  update bookings
  set status = 'cancelled',
      cancelled_at = now()
  where id = v_booking.id;

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

revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated, service_role;
