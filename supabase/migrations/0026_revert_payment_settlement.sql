-- ============================================================================
-- Revert payment-to-attendance settlement.
--
-- Business rule:
--   starter/existing credit -> booking consumes it
--   later package/single-class payment -> adds new credits for future use
--
-- Therefore payments must never be auto-consumed against already-attended
-- bookings.
-- ============================================================================

-- Remove the settlement deductions introduced by 0024. This restores the
-- purchased credits, including the converted 5-pack correction row.
delete from public.credit_ledger
where reason = 'payment_settlement';

-- Restore the original FIFO balance model with no targeted settlement concept.
create or replace function public.credit_balance(
  p_customer uuid,
  p_pool text default 'regular'
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_remaining int[] := array[]::int[];
  v_expires timestamptz[] := array[]::timestamptz[];
  v_count int;
  v_i int;
  v_owed int;
  v_take int;
  v_total int := 0;
begin
  for v_row in
    select delta, expires_at, created_at
    from public.credit_ledger
    where customer_id = p_customer
      and coalesce(pool, 'regular') = coalesce(p_pool, 'regular')
    order by created_at asc, id asc
  loop
    if v_row.delta > 0 then
      v_remaining := array_append(v_remaining, v_row.delta);
      v_expires := array_append(v_expires, v_row.expires_at);

    elsif v_row.delta < 0 then
      v_owed := -v_row.delta;
      v_count := coalesce(array_length(v_remaining, 1), 0);

      if v_count > 0 then
        for v_i in 1..v_count loop
          exit when v_owed <= 0;

          if v_remaining[v_i] > 0
             and (v_expires[v_i] is null or v_expires[v_i] > v_row.created_at)
          then
            v_take := least(v_owed, v_remaining[v_i]);
            v_remaining[v_i] := v_remaining[v_i] - v_take;
            v_owed := v_owed - v_take;
          end if;
        end loop;
      end if;
    end if;
  end loop;

  v_count := coalesce(array_length(v_remaining, 1), 0);
  if v_count = 0 then
    return 0;
  end if;

  for v_i in 1..v_count loop
    if v_remaining[v_i] > 0
       and (v_expires[v_i] is null or v_expires[v_i] > now())
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
returns int
language plpgsql
stable
security definer
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
    select id, delta, expires_at, created_at
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

      if v_count > 0 then
        for v_i in 1..v_count loop
          exit when v_owed <= 0;

          if v_remaining[v_i] > 0
             and (v_expires[v_i] is null or v_expires[v_i] > v_row.created_at)
          then
            v_take := least(v_owed, v_remaining[v_i]);
            v_remaining[v_i] := v_remaining[v_i] - v_take;
            v_owed := v_owed - v_take;
          end if;
        end loop;
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

create or replace function public.prevent_negative_credit_spend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_pool text;
begin
  if new.delta >= 0 then
    return new;
  end if;

  v_pool := coalesce(new.pool, 'regular');

  perform 1
  from public.customers
  where id = new.customer_id
  for update;

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

drop function if exists public.record_package_purchase(uuid, uuid, text, boolean);
drop function if exists public.settle_purchase_against_latest_attendance(uuid);
drop function if exists public.settle_purchase_against_booking(uuid, uuid);

drop index if exists public.uq_credit_ledger_booking_payment_settlement;

alter table public.credit_ledger
  drop constraint if exists credit_ledger_settlement_purchase_fkey;

alter table public.credit_ledger
  drop column if exists settlement_purchase_id;
