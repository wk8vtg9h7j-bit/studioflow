-- An audited, atomic admin-only reversal of a mistaken class checkout.
-- This reverses a Studioflow receipt, NOT a refund to a card/bank.
create table if not exists public.class_checkout_reversals (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null unique,
  booking_id uuid not null,
  customer_id uuid not null,
  kind text not null,
  amount_cents integer not null,
  currency text not null,
  payment_method text not null,
  original_collector uuid,
  purchase_id uuid,
  single_credit_ledger_id uuid,
  reversed_by uuid not null references public.profiles(id),
  reason text not null,
  reversed_at timestamptz not null default now()
);
alter table public.class_checkout_reversals enable row level security;
revoke all on public.class_checkout_reversals from public, anon, authenticated;
grant select, insert on public.class_checkout_reversals to service_role;

create or replace function public.undo_class_checkout(
  p_checkout uuid, p_admin uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_checkout public.class_checkouts%rowtype;
  v_grant uuid;
  v_source_spend uuid;
  v_delta integer;
begin
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin') then
    raise exception 'Only administrators can reverse payments';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 500 then
    raise exception 'A reason for the reversal is required';
  end if;

  select * into v_checkout from public.class_checkouts where id = p_checkout;
  if not found then raise exception 'Checkout was not found or already reversed'; end if;
  -- Use the same customer lock as record_class_checkout and credit spend paths.
  perform 1 from public.customers where id = v_checkout.customer_id for update;
  select * into v_checkout from public.class_checkouts where id = p_checkout for update;
  if not found then raise exception 'Checkout was already reversed'; end if;

  v_grant := case when v_checkout.kind = 'package'
                  then v_checkout.purchase_id else v_checkout.single_credit_ledger_id end;
  if v_grant is not null then
    select delta into v_delta from public.credit_ledger
      where id = v_grant and customer_id = v_checkout.customer_id
      for update;
    if not found then raise exception 'Linked credit grant is missing; contact support'; end if;

    -- Do not retract credits once a later booking/refund has consumed them,
    -- even if a subsequent purchase has replenished the current balance.
    select spend.id into v_source_spend
    from public.credit_ledger spend
    cross join lateral public.credit_spend_sources(spend.id) src
    where spend.customer_id = v_checkout.customer_id
      and spend.delta < 0 and src.source_grant_id = v_grant
    limit 1;
    if v_source_spend is not null then
      raise exception 'Cannot undo: credits from this payment have already been used. Correct the account manually.';
    end if;
  end if;

  insert into public.class_checkout_reversals
    (checkout_id,booking_id,customer_id,kind,amount_cents,currency,payment_method,
     original_collector,purchase_id,single_credit_ledger_id,reversed_by,reason)
  values
    (v_checkout.id,v_checkout.booking_id,v_checkout.customer_id,v_checkout.kind,
     v_checkout.amount_cents,v_checkout.currency,v_checkout.payment_method,
     v_checkout.sold_by,v_checkout.purchase_id,v_checkout.single_credit_ledger_id,
     p_admin,trim(p_reason));

  -- Delete receipt first to release restrictive FKs; all changes are one SQL transaction.
  delete from public.class_checkouts where id = v_checkout.id;
  if v_grant is not null then
    delete from public.credit_ledger
      where id = v_grant and customer_id = v_checkout.customer_id;
    if not found then raise exception 'Could not retract the linked credits'; end if;
  end if;

  return jsonb_build_object('ok',true,'customer_id',v_checkout.customer_id,
    'booking_id',v_checkout.booking_id,'checkout_id',v_checkout.id);
end;
$$;
revoke all on function public.undo_class_checkout(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.undo_class_checkout(uuid,uuid,text) to service_role;
