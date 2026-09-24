-- ============================================================================
-- Explicit package-payment settlement.
--
-- A payment recorded after attendance may use one or more credits from the new
-- package to settle that already-attended booking. The settlement points at the
-- exact purchase grant so it never consumes some unrelated older package.
-- ============================================================================

alter table public.credit_ledger
  add column if not exists settlement_purchase_id uuid;

do $$
begin
  alter table public.credit_ledger
    add constraint credit_ledger_settlement_purchase_fkey
    foreign key (settlement_purchase_id)
    references public.credit_ledger(id)
    on delete cascade;
exception when duplicate_object then null;
end $$;

create unique index if not exists uq_credit_ledger_booking_payment_settlement
  on public.credit_ledger (booking_id)
  where reason = 'payment_settlement';

-- --------------------------------------------------------------------------
-- Balance: ordinary negative rows consume FIFO; a payment_settlement consumes
-- ONLY the purchase grant named by settlement_purchase_id.
-- --------------------------------------------------------------------------
create or replace function public.credit_balance(
  p_customer uuid,
  p_pool text default 'regular'
)
returns integer
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_row record;
  v_ids uuid[] := array[]::uuid[];
  v_remaining int[] := array[]::int[];
  v_expires timestamptz[] := array[]::timestamptz[];
  v_count int;
  v_i int;
  v_owed int;
  v_take int;
  v_total int := 0;
begin
  for v_row in
    select id, delta, expires_at, created_at, settlement_purchase_id
    from public.credit_ledger
    where customer_id = p_customer
      and coalesce(pool, 'regular') = coalesce(p_pool, 'regular')
    order by created_at asc, id asc
  loop
    if v_row.delta > 0 then
      v_ids := array_append(v_ids, v_row.id);
      v_remaining := array_append(v_remaining, v_row.delta);
      v_expires := array_append(v_expires, v_row.expires_at);

    elsif v_row.delta < 0 then
      v_owed := -v_row.delta;
      v_count := coalesce(array_length(v_remaining, 1), 0);

      if v_row.settlement_purchase_id is not null then
        if v_count > 0 then
          for v_i in 1..v_count loop
            if v_ids[v_i] = v_row.settlement_purchase_id
               and v_remaining[v_i] > 0
               and (
                 v_expires[v_i] is null
                 or v_expires[v_i] > v_row.created_at
               )
            then
              v_take := least(v_owed, v_remaining[v_i]);
              v_remaining[v_i] := v_remaining[v_i] - v_take;
              v_owed := v_owed - v_take;
              exit;
            end if;
          end loop;
        end if;
      else
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
    end if;
  end loop;

  v_count := coalesce(array_length(v_remaining, 1), 0);
  if v_count = 0 then
    return 0;
  end if;

  for v_i in 1..v_count loop
    if v_remaining[v_i] > 0
       and (
         v_expires[v_i] is null
         or v_expires[v_i] > now()
       )
    then
      v_total := v_total + v_remaining[v_i];
    end if;
  end loop;

  return greatest(v_total, 0);
end;
$$;

create or replace function public.credit_grant_remaining_at(
  p_grant uuid,
  p_at timestamptz
)
returns integer
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_pool text;
  v_row record;
  v_ids uuid[] := array[]::uuid[];
  v_remaining int[] := array[]::int[];
  v_expires timestamptz[] := array[]::timestamptz[];
  v_count int;
  v_i int;
  v_owed int;
  v_take int;
begin
  select customer_id, coalesce(pool, 'regular')
    into v_customer, v_pool
  from public.credit_ledger
  where id = p_grant
    and delta > 0;

  if not found then
    return 0;
  end if;

  for v_row in
    select id, delta, expires_at, created_at, settlement_purchase_id
    from public.credit_ledger
    where customer_id = v_customer
      and coalesce(pool, 'regular') = v_pool
      and created_at <= p_at
    order by created_at asc, id asc
  loop
    if v_row.delta > 0 then
      v_ids := array_append(v_ids, v_row.id);
      v_remaining := array_append(v_remaining, v_row.delta);
      v_expires := array_append(v_expires, v_row.expires_at);

    elsif v_row.delta < 0 then
      v_owed := -v_row.delta;
      v_count := coalesce(array_length(v_remaining, 1), 0);

      if v_row.settlement_purchase_id is not null then
        if v_count > 0 then
          for v_i in 1..v_count loop
            if v_ids[v_i] = v_row.settlement_purchase_id
               and v_remaining[v_i] > 0
               and (
                 v_expires[v_i] is null
                 or v_expires[v_i] > v_row.created_at
               )
            then
              v_take := least(v_owed, v_remaining[v_i]);
              v_remaining[v_i] := v_remaining[v_i] - v_take;
              v_owed := v_owed - v_take;
              exit;
            end if;
          end loop;
        end if;
      else
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
    end if;
  end loop;

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    return 0;
  end if;

  for v_i in 1..v_count loop
    if v_ids[v_i] = p_grant then
      return greatest(v_remaining[v_i], 0);
    end if;
  end loop;

  return 0;
end;
$$;

create or replace function public.credit_spend_sources(p_spend uuid)
returns table (
  source_grant_id uuid,
  credits integer,
  source_expires_at timestamptz,
  source_package_id uuid,
  source_created_at timestamptz
)
language plpgsql
stable security definer
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
  select id, customer_id, delta, created_at,
         coalesce(pool, 'regular') as pool,
         settlement_purchase_id
    into v_spend
  from public.credit_ledger
  where id = p_spend
    and delta < 0;

  if not found then
    return;
  end if;

  for v_row in
    select id, delta, expires_at, package_id, created_at,
           settlement_purchase_id
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

      if v_row.settlement_purchase_id is not null then
        if v_count > 0 then
          for v_i in 1..v_count loop
            if v_ids[v_i] = v_row.settlement_purchase_id
               and v_remaining[v_i] > 0
               and (
                 v_expires[v_i] is null
                 or v_expires[v_i] > v_row.created_at
               )
            then
              v_take := least(v_owed, v_remaining[v_i]);
              v_remaining[v_i] := v_remaining[v_i] - v_take;
              v_owed := v_owed - v_take;
              exit;
            end if;
          end loop;
        end if;
      else
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
    end if;
  end loop;

  v_owed := -v_spend.delta;
  v_count := coalesce(array_length(v_remaining, 1), 0);

  if v_spend.settlement_purchase_id is not null then
    if v_count > 0 then
      for v_i in 1..v_count loop
        if v_ids[v_i] = v_spend.settlement_purchase_id
           and v_remaining[v_i] > 0
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
          return;
        end if;
      end loop;
    end if;
    return;
  end if;

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

-- Targeted settlement rows must have enough remaining credits on the named
-- purchase grant. Ordinary spends keep the existing total-balance guard.
create or replace function public.prevent_negative_credit_spend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_pool text;
  v_target_remaining int;
begin
  if new.delta >= 0 then
    return new;
  end if;

  v_pool := coalesce(new.pool, 'regular');

  perform 1
  from public.customers
  where id = new.customer_id
  for update;

  if new.settlement_purchase_id is not null then
    v_target_remaining := public.credit_grant_remaining_at(
      new.settlement_purchase_id,
      coalesce(new.created_at, now())
    );

    if v_target_remaining < -new.delta then
      raise exception
        'Purchase does not have enough remaining credits to settle this attendance';
    end if;

    return new;
  end if;

  v_balance := public.credit_balance(new.customer_id, v_pool);

  if v_balance + new.delta < 0 then
    raise exception
      'Insufficient % credits (available %, attempted spend %)',
      v_pool,
      v_balance,
      -new.delta;
  end if;

  return new;
end;
$$;

create or replace function public.settle_purchase_against_booking(
  p_purchase uuid,
  p_booking uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase record;
  v_booking record;
  v_pool text;
  v_needed int;
  v_remaining int;
begin
  select id, customer_id, delta, package_id, created_at,
         coalesce(pool, 'regular') as pool
    into v_purchase
  from public.credit_ledger
  where id = p_purchase
    and reason = 'purchase'
    and delta > 0
  for update;

  if not found then
    raise exception 'Purchase not found';
  end if;

  select b.id, b.customer_id, b.status, b.credits_spent,
         s.class_type_id
    into v_booking
  from public.bookings b
  join public.sessions s on s.id = b.session_id
  where b.id = p_booking
  for update of b;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_booking.customer_id <> v_purchase.customer_id then
    raise exception 'Purchase and booking belong to different customers';
  end if;

  if v_booking.status <> 'attended' then
    raise exception 'Only attended bookings can be settled';
  end if;

  select coalesce(pool, 'regular')
    into v_pool
  from public.class_types
  where id = v_booking.class_type_id;

  if coalesce(v_pool, 'regular') <> v_purchase.pool then
    raise exception 'Purchase credit type does not match this class';
  end if;

  if exists (
    select 1
    from public.credit_ledger
    where booking_id = p_booking
      and reason = 'payment_settlement'
  ) then
    return 0;
  end if;

  v_needed := greatest(coalesce(v_booking.credits_spent, 0), 0);
  if v_needed = 0 then
    return 0;
  end if;

  v_remaining := public.credit_grant_remaining_at(p_purchase, now());
  if v_remaining < v_needed then
    raise exception
      'Purchase has only % remaining credits but attendance needs %',
      v_remaining,
      v_needed;
  end if;

  insert into public.credit_ledger (
    customer_id,
    delta,
    reason,
    package_id,
    booking_id,
    expires_at,
    pool,
    settlement_purchase_id
  )
  values (
    v_purchase.customer_id,
    -v_needed,
    'payment_settlement',
    v_purchase.package_id,
    p_booking,
    null,
    v_purchase.pool,
    p_purchase
  );

  return v_needed;
end;
$$;

revoke execute on function public.settle_purchase_against_booking(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_purchase_against_booking(uuid, uuid)
  to service_role;

create or replace function public.settle_purchase_against_latest_attendance(
  p_purchase uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase record;
  v_candidate uuid;
  v_settled int;
begin
  select id, customer_id, coalesce(pool, 'regular') as pool
    into v_purchase
  from public.credit_ledger
  where id = p_purchase
    and reason = 'purchase'
    and delta > 0;

  if not found then
    raise exception 'Purchase not found';
  end if;

  select b.id
    into v_candidate
  from public.bookings b
  join public.sessions s on s.id = b.session_id
  join public.studios st on st.id = s.studio_id
  join public.class_types ct on ct.id = s.class_type_id
  where b.customer_id = v_purchase.customer_id
    and b.status = 'attended'
    and coalesce(ct.pool, 'regular') = v_purchase.pool
    and (s.starts_at at time zone coalesce(st.timezone, 'Asia/Ho_Chi_Minh'))::date
        = (now() at time zone coalesce(st.timezone, 'Asia/Ho_Chi_Minh'))::date
    and not exists (
      select 1
      from public.credit_ledger x
      where x.booking_id = b.id
        and x.reason = 'payment_settlement'
    )
  order by s.starts_at desc, b.checked_in_at desc nulls last
  limit 1;

  if v_candidate is null then
    return jsonb_build_object('settled', false);
  end if;

  v_settled := public.settle_purchase_against_booking(
    p_purchase,
    v_candidate
  );

  return jsonb_build_object(
    'settled', v_settled > 0,
    'booking_id', v_candidate,
    'credits', v_settled
  );
end;
$$;

revoke execute on function public.settle_purchase_against_latest_attendance(uuid)
  from public, anon, authenticated;
grant execute on function public.settle_purchase_against_latest_attendance(uuid)
  to service_role;

-- --------------------------------------------------------------------------
-- Repair 2026-09-24 payments confirmed by admin as payments for that day's
-- attended classes. All nine purchase grants were verified fully unused.
-- --------------------------------------------------------------------------
select public.settle_purchase_against_booking(
  '3e36be51-4766-4ade-b5d5-f855a736a243',
  'a0d0a53f-5cd1-4d94-9ec4-039fcdb146ca'
);
select public.settle_purchase_against_booking(
  '6a03bd76-c220-4e3b-bc29-09c37f5d6a07',
  'fe7e3842-fd3e-4c9f-85fe-77ad3f67e802'
);
select public.settle_purchase_against_booking(
  'df28afe6-c020-4642-9fa6-bf73d0a2fd9c',
  'ede147e9-5c16-4763-af2c-eb1351526d01'
);
select public.settle_purchase_against_booking(
  '70bd73cc-09f1-467e-8506-17e810cb9e26',
  '9b92f199-01e1-4639-8d2c-68fdd7fff594'
);
select public.settle_purchase_against_booking(
  '5c60b4d3-2318-42d8-a0c9-879b85fcf181',
  'd7adf39b-876b-4849-9e2c-9334a2fa8c7a'
);
select public.settle_purchase_against_booking(
  '5d1670d5-8e26-4933-8f82-35f70b9fe062',
  'c2041e2f-3620-4ab4-bf18-1c0c51729b84'
);
select public.settle_purchase_against_booking(
  'd8deee39-a083-488e-9cf2-8f36455da4ec',
  '105b9acd-18ea-4442-a62d-fa543dabba4d'
);
select public.settle_purchase_against_booking(
  'd351b912-d0bb-4725-a173-7ff02b386d13',
  'fe71c54e-4cdb-4558-9c2c-7631e2de398e'
);
select public.settle_purchase_against_booking(
  'ecbcd049-f9d8-45d8-af8b-329e9c78feb4',
  'a60cd3ac-7727-41e8-ab3d-e7d9692405ae'
);

-- The 5-class payment already had a manual -1 correction. Convert that existing
-- row into an explicit targeted settlement without changing the balance.
update public.credit_ledger
set reason = 'payment_settlement',
    booking_id = 'aa5e6ad2-2291-435a-b1cc-3aeab466f852',
    settlement_purchase_id = '8eec315c-b900-4ab1-9b88-721767e2973f',
    package_id = (
      select package_id
      from public.credit_ledger
      where id = '8eec315c-b900-4ab1-9b88-721767e2973f'
    )
where id = '54e761cf-6b01-4382-8301-fe2566cc8971'
  and delta = -1;
