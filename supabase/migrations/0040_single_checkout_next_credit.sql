-- Associate the new paid booking credit with the single-class receipt.
-- Amount paid is recorded once in class_checkouts, not again as a package sale.
alter table public.class_checkouts
  add column if not exists single_credit_ledger_id uuid unique references public.credit_ledger(id) on delete restrict;

-- Single-class payment settles attendance AND grants one paid credit for the next booking.
create or replace function public.record_class_checkout(
 p_booking uuid,
 p_kind text,
 p_package uuid,
 p_payment_method text,
 p_amount_cents integer,
 p_sold_by uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_booking record;
 v_pkg record;
 v_purchase_id uuid;
 v_checkout_id uuid;
 v_single_credit_id uuid;
 v_credits integer := 0;
 v_pool text;
 v_currency text := 'VND';
 v_amount integer;
begin
 if p_kind not in ('single','package') or p_payment_method not in ('qr','card','cash') then
  raise exception 'Invalid checkout or payment method';
 end if;
 if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
  raise exception 'Invalid amount paid';
 end if;
 if not exists (select 1 from public.profiles p where p.id=p_sold_by and p.role in ('admin','instructor')) then
  raise exception 'Staff identity is required';
 end if;
 select customer_id into v_booking from public.bookings where id=p_booking;
 if not found then raise exception 'Booking not found'; end if;
 -- Lock the customer before booking to serialize concurrent checkout attempts
 -- and prevent double issuance from simultaneous staff devices.
 perform 1 from public.customers where id=v_booking.customer_id for update;
 select b.id,b.customer_id,b.status,b.credits_spent,b.session_id,
        coalesce(ct.pool,'regular') as pool
 into v_booking
 from public.bookings b
 join public.sessions s on s.id=b.session_id
 join public.class_types ct on ct.id=s.class_type_id
 where b.id=p_booking for update of b;
 if v_booking.status <> 'attended' then
  raise exception 'Mark the visit as attended before collecting payment';
 end if;
 if exists(select 1 from public.class_checkouts where booking_id=p_booking) then
  raise exception 'This class has already been paid at checkout';
 end if;
 if exists(
  select 1 from public.credit_ledger spend
  cross join lateral public.credit_spend_sources(spend.id) source
  join public.credit_ledger grant_row on grant_row.id=source.source_grant_id
  where spend.booking_id=p_booking and spend.reason='booking'
    and grant_row.reason in ('purchase','single_class_credit')
 ) then raise exception 'This booking already used paid package credits'; end if;

 if p_kind='package' then
  if not public.eligible_starter_checkout(p_booking) then
   raise exception 'This visit is not eligible to be included in a starter package; collect a single-class payment instead';
  end if;
  select id,credits,validity_days,active,coalesce(pool,'regular') as pool,price_cents,currency
    into v_pkg from public.packages where id=p_package for share;
  if not found or not v_pkg.active or v_pkg.price_cents<=0 then raise exception 'Package is unavailable'; end if;
  if v_pkg.pool <> v_booking.pool then raise exception 'Package credit type does not match the class'; end if;
  if v_pkg.credits < v_booking.credits_spent then raise exception 'Package has fewer credits than the attended class'; end if;
  if p_amount_cents > v_pkg.price_cents then raise exception 'Charged amount exceeds listed package price'; end if;
  v_credits := v_pkg.credits - v_booking.credits_spent;
  insert into public.credit_ledger
   (customer_id,delta,reason,package_id,booking_id,expires_at,payment_method,pool,
    sale_amount_cents,sale_currency,sold_by)
  values
   (v_booking.customer_id,v_credits,'purchase',v_pkg.id,null,
    now()+make_interval(days=>v_pkg.validity_days),
    p_payment_method,v_pkg.pool,p_amount_cents,v_pkg.currency,p_sold_by)
  returning id into v_purchase_id;
  v_pool := v_pkg.pool;
  v_currency := v_pkg.currency;
 else
  if p_package is not null then raise exception 'Single-class payments cannot issue a package'; end if;
  v_pool := v_booking.pool;
  -- The starter credit paid for the reservation; the single payment covers
  -- the attended visit and issues ONE new paid booking credit for next time.
  -- Keep the new credit independent of revenue ledgers: the linked checkout
  -- receipt already stores the paid amount. No expiration until set by policy.
  v_credits := 1;
  insert into public.credit_ledger
    (customer_id,delta,reason,booking_id,expires_at,payment_method,pool,sold_by)
  values
    (v_booking.customer_id,1,'single_class_credit',null,null,
     p_payment_method,v_booking.pool,p_sold_by)
  returning id into v_single_credit_id;
 end if;

 insert into public.class_checkouts
  (booking_id,customer_id,kind,purchase_id,single_credit_ledger_id,amount_cents,currency,payment_method,sold_by)
 values (p_booking,v_booking.customer_id,p_kind,v_purchase_id,v_single_credit_id,p_amount_cents,
         v_currency,
         p_payment_method,p_sold_by)
 returning id into v_checkout_id;
 return jsonb_build_object(
   'ok',true,'checkout_id',v_checkout_id,'purchase_id',v_purchase_id,
   'kind',p_kind,'granted_credits',v_credits,
   'remaining_credits',public.credit_balance(v_booking.customer_id,v_pool)
 );
end; $$;
revoke all on function public.record_class_checkout(uuid,text,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.record_class_checkout(uuid,text,uuid,text,integer,uuid) to service_role;
