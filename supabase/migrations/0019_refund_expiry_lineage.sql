-- ============================================================================
-- Preserve package expiry lineage on booking refunds.
--
-- A refund must return credits to the same expiry buckets that funded the
-- booking. This prevents a cancellation from turning an expiring package credit
-- into a permanent credit.
-- ============================================================================

create or replace function public.refund_booking_credits_preserving_expiry(
  p_booking_id uuid,
  p_customer uuid,
  p_pool text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spend record;
  v_row record;
  v_ids uuid[] := array[]::uuid[];
  v_remaining int[] := array[]::int[];
  v_expires timestamptz[] := array[]::timestamptz[];
  v_packages uuid[] := array[]::uuid[];
  v_count int;
  v_i int;
  v_owed int;
  v_take int;
  v_refunded int := 0;
begin
  -- A booking may be cancelled and later restored/rebooked. Refund only the
  -- most recent booking spend for the current booking cycle.
  select id, delta, created_at
    into v_spend
  from public.credit_ledger
  where booking_id = p_booking_id
    and customer_id = p_customer
    and reason = 'booking'
    and delta < 0
    and coalesce(pool, 'regular') = coalesce(p_pool, 'regular')
  order by created_at desc, id desc
  limit 1;

  if not found then
    return 0;
  end if;

  -- Reconstruct all credit buckets immediately BEFORE that spend. Positive
  -- rows are buckets; earlier negative rows consume the oldest bucket that was
  -- still valid at the moment of that spend.
  for v_row in
    select id, delta, expires_at, package_id, created_at
    from public.credit_ledger
    where customer_id = p_customer
      and coalesce(pool, 'regular') = coalesce(p_pool, 'regular')
      and (created_at, id) < (v_spend.created_at, v_spend.id)
    order by created_at asc, id asc
  loop
    if v_row.delta > 0 then
      v_ids := array_append(v_ids, v_row.id);
      v_remaining := array_append(v_remaining, v_row.delta);
      v_expires := array_append(v_expires, v_row.expires_at);
      v_packages := array_append(v_packages, v_row.package_id);

    elsif v_row.delta < 0 then
      v_owed := -v_row.delta;
      v_count := coalesce(array_length(v_remaining, 1), 0);

      if v_count > 0 then
        for v_i in 1..v_count loop
          exit when v_owed <= 0;

          if v_remaining[v_i] > 0
             and (
               v_expires[v_i] is null
               or v_expires[v_i] > v_row.created_at
             )
          then
            v_take := least(v_owed, v_remaining[v_i]);
            v_remaining[v_i] := v_remaining[v_i] - v_take;
            v_owed := v_owed - v_take;
          end if;
        end loop;
      end if;
    end if;
  end loop;

  -- Allocate THIS booking spend from those reconstructed FIFO buckets and
  -- return each portion with the exact source expiry/package lineage.
  v_owed := -v_spend.delta;
  v_count := coalesce(array_length(v_remaining, 1), 0);

  if v_count > 0 then
    for v_i in 1..v_count loop
      exit when v_owed <= 0;

      if v_remaining[v_i] > 0
         and (
           v_expires[v_i] is null
           or v_expires[v_i] > v_spend.created_at
         )
      then
        v_take := least(v_owed, v_remaining[v_i]);

        insert into public.credit_ledger (
          customer_id,
          delta,
          reason,
          package_id,
          booking_id,
          expires_at,
          pool
        )
        values (
          p_customer,
          v_take,
          'refund',
          v_packages[v_i],
          p_booking_id,
          v_expires[v_i],
          coalesce(p_pool, 'regular')
        );

        v_owed := v_owed - v_take;
        v_refunded := v_refunded + v_take;
      end if;
    end loop;
  end if;

  if v_owed > 0 then
    raise exception
      'Could not trace % booking credit(s) back to their source grant',
      v_owed;
  end if;

  return v_refunded;
end;
$$;

-- Keep helper server-side only.
revoke execute on function public.refund_booking_credits_preserving_expiry(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.refund_booking_credits_preserving_expiry(uuid, uuid, text)
  to service_role;

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
