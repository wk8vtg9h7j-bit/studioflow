-- ============================================================================
-- Repair historical refund lineage safely.
--
-- Introduces a read-only allocator for one booking-spend ledger row, rewires
-- future refunds to use it, then repairs legacy refund rows only when the full
-- refund amount can be proven from the original source buckets.
-- ============================================================================

create or replace function public.credit_spend_sources(p_spend uuid)
returns table (
  source_grant_id uuid,
  credits int,
  source_expires_at timestamptz,
  source_package_id uuid,
  source_created_at timestamptz
)
language plpgsql
stable
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
  v_created timestamptz[] := array[]::timestamptz[];
  v_count int;
  v_i int;
  v_owed int;
  v_take int;
begin
  select id, customer_id, delta, created_at, coalesce(pool, 'regular') as pool
    into v_spend
  from public.credit_ledger
  where id = p_spend
    and delta < 0;

  if not found then
    return;
  end if;

  for v_row in
    select id, delta, expires_at, package_id, created_at
    from public.credit_ledger
    where customer_id = v_spend.customer_id
      and coalesce(pool, 'regular') = v_spend.pool
      and (created_at, id) < (v_spend.created_at, v_spend.id)
    order by created_at asc, id asc
  loop
    if v_row.delta > 0 then
      v_ids := array_append(v_ids, v_row.id);
      v_remaining := array_append(v_remaining, v_row.delta);
      v_expires := array_append(v_expires, v_row.expires_at);
      v_packages := array_append(v_packages, v_row.package_id);
      v_created := array_append(v_created, v_row.created_at);

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

        source_grant_id := v_ids[v_i];
        credits := v_take;
        source_expires_at := v_expires[v_i];
        source_package_id := v_packages[v_i];
        source_created_at := v_created[v_i];
        return next;

        v_owed := v_owed - v_take;
      end if;
    end loop;
  end if;

  return;
end;
$$;

revoke execute on function public.credit_spend_sources(uuid)
  from public, anon, authenticated;
grant execute on function public.credit_spend_sources(uuid)
  to service_role;

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
  v_source record;
  v_expected int;
  v_traced int := 0;
begin
  select id, delta
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

  v_expected := -v_spend.delta;

  select coalesce(sum(s.credits), 0)::int
    into v_traced
  from public.credit_spend_sources(v_spend.id) s;

  if v_traced <> v_expected then
    raise exception
      'Could not trace booking refund fully (expected %, traced %)',
      v_expected,
      v_traced;
  end if;

  for v_source in
    select *
    from public.credit_spend_sources(v_spend.id)
    order by source_created_at asc, source_grant_id asc
  loop
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
      v_source.credits,
      'refund',
      v_source.source_package_id,
      p_booking_id,
      v_source.source_expires_at,
      coalesce(p_pool, 'regular')
    );
  end loop;

  return v_traced;
end;
$$;

revoke execute on function public.refund_booking_credits_preserving_expiry(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.refund_booking_credits_preserving_expiry(uuid, uuid, text)
  to service_role;

-- Repair pre-fix refunds in chronological order. Earlier repaired refunds then
-- become correct source buckets for any later booking/rebooking cycle.
do $$
declare
  v_refund record;
  v_spend record;
  v_source record;
  v_traced int;
  v_part int;
  v_offset int;
begin
  for v_refund in
    select id, customer_id, delta, booking_id, created_at,
           coalesce(pool, 'regular') as pool
    from public.credit_ledger
    where reason = 'refund'
      and delta > 0
      and booking_id is not null
      and package_id is null
      and expires_at is null
    order by created_at asc, id asc
  loop
    select id, delta, created_at
      into v_spend
    from public.credit_ledger
    where booking_id = v_refund.booking_id
      and customer_id = v_refund.customer_id
      and reason = 'booking'
      and delta < 0
      and coalesce(pool, 'regular') = v_refund.pool
      and (created_at, id) < (v_refund.created_at, v_refund.id)
    order by created_at desc, id desc
    limit 1;

    if not found then
      continue;
    end if;

    select coalesce(sum(s.credits), 0)::int
      into v_traced
    from public.credit_spend_sources(v_spend.id) s;

    -- Never guess. Only replace the legacy refund if its entire amount maps
    -- exactly back to the spend's source buckets.
    if v_traced <> v_refund.delta then
      continue;
    end if;

    v_part := 0;
    v_offset := 0;

    for v_source in
      select *
      from public.credit_spend_sources(v_spend.id)
      order by source_created_at asc, source_grant_id asc
    loop
      v_part := v_part + 1;

      if v_part = 1 then
        update public.credit_ledger
        set delta = v_source.credits,
            package_id = v_source.source_package_id,
            expires_at = v_source.source_expires_at
        where id = v_refund.id;
      else
        v_offset := v_offset + 1;

        insert into public.credit_ledger (
          customer_id,
          delta,
          reason,
          package_id,
          booking_id,
          expires_at,
          pool,
          created_at
        )
        values (
          v_refund.customer_id,
          v_source.credits,
          'refund',
          v_source.source_package_id,
          v_refund.booking_id,
          v_source.source_expires_at,
          v_refund.pool,
          v_refund.created_at + (v_offset * interval '1 microsecond')
        );
      end if;
    end loop;
  end loop;
end;
$$;
