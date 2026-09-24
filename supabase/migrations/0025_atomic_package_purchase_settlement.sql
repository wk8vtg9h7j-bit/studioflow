-- ============================================================================
-- Atomic package sale + optional same-day attendance settlement.
-- ============================================================================

create or replace function public.record_package_purchase(
  p_customer uuid,
  p_package uuid,
  p_payment_method text,
  p_settle_latest_attendance boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg record;
  v_purchase_id uuid;
  v_expires timestamptz;
  v_settlement jsonb := jsonb_build_object('settled', false);
begin
  if p_payment_method not in ('qr','card','cash') then
    raise exception 'Invalid payment method';
  end if;

  select id, credits, validity_days, active, coalesce(pool,'regular') as pool,
         price_cents, coalesce(currency,'VND') as currency
    into v_pkg
  from public.packages
  where id = p_package
  for share;

  if not found then
    raise exception 'Package not found';
  end if;

  if not v_pkg.active then
    raise exception 'Package is no longer available';
  end if;

  perform 1
  from public.customers
  where id = p_customer
  for update;

  if not found then
    raise exception 'Customer not found';
  end if;

  v_expires := now() + make_interval(days => v_pkg.validity_days);

  insert into public.credit_ledger (
    customer_id,
    delta,
    reason,
    package_id,
    booking_id,
    expires_at,
    payment_method,
    pool,
    sale_amount_cents,
    sale_currency
  )
  values (
    p_customer,
    v_pkg.credits,
    'purchase',
    p_package,
    null,
    v_expires,
    p_payment_method,
    v_pkg.pool,
    v_pkg.price_cents,
    v_pkg.currency
  )
  returning id into v_purchase_id;

  if p_settle_latest_attendance then
    v_settlement := public.settle_purchase_against_latest_attendance(
      v_purchase_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase_id,
    'settlement', v_settlement
  );
end;
$$;

revoke execute on function public.record_package_purchase(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_package_purchase(uuid, uuid, text, boolean)
  to service_role;
