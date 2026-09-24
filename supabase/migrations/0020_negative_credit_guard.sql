-- ============================================================================
-- Database-level guarantee: a new negative ledger entry may never overspend
-- the customer's currently valid balance.
--
-- App/RPC paths already check this, but the trigger makes the invariant hold
-- even for future admin/server code that writes credit_ledger directly.
-- ============================================================================

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

  -- Serialize spends for one customer so two simultaneous bookings cannot both
  -- observe the same pre-spend balance.
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

drop trigger if exists trg_prevent_negative_credit_spend
  on public.credit_ledger;

create trigger trg_prevent_negative_credit_spend
before insert
on public.credit_ledger
for each row
when (new.delta < 0)
execute function public.prevent_negative_credit_spend();
