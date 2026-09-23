-- ============================================================================
-- Credit expiry correctness + notification queue.
--
-- The old balance function simply dropped expired positive grants while keeping
-- historic spends. That could make a customer's balance go negative or let an
-- expired package's old spends reduce a newer package. We now replay the ledger
-- FIFO, consuming only credit buckets that were live when each spend happened.
-- Unused package credits therefore disappear exactly at expires_at without
-- contaminating later packages.
-- ============================================================================

create index if not exists idx_credit_ledger_fifo
  on public.credit_ledger (customer_id, pool, created_at, id);

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

create table if not exists public.credit_expiry_notifications (
  purchase_ledger_id uuid primary key
    references public.credit_ledger(id) on delete cascade,
  customer_id uuid not null
    references public.customers(id) on delete cascade,
  expires_at timestamptz not null,
  expired_credits int not null default 0
    check (expired_credits >= 0),
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'sent',
        'no_balance',
        'no_email',
        'skipped_legacy',
        'failed'
      )
    ),
  email text,
  attempts int not null default 0,
  notified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.credit_expiry_notifications enable row level security;

create index if not exists idx_credit_expiry_notifications_pending
  on public.credit_expiry_notifications (status, expires_at)
  where status in ('pending', 'failed');

insert into public.credit_expiry_notifications (
  purchase_ledger_id,
  customer_id,
  expires_at,
  expired_credits,
  status,
  notified_at,
  last_error
)
select
  cl.id,
  cl.customer_id,
  cl.expires_at,
  0,
  'skipped_legacy',
  now(),
  'Expired before automatic expiry notifications were enabled.'
from public.credit_ledger cl
where cl.reason = 'purchase'
  and cl.delta > 0
  and cl.expires_at is not null
  and cl.expires_at <= now()
on conflict (purchase_ledger_id) do nothing;
