-- Explicit, atomic class checkout. No historical data is changed.
-- This models money paid for a starter-credit booking separately from
-- the starter's earlier booking-credit deduction.
create table if not exists public.class_checkouts (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null unique references public.bookings(id) on delete restrict,
 customer_id uuid not null references public.customers(id) on delete restrict,
 kind text not null check (kind in ('single','package')),
 purchase_id uuid unique references public.credit_ledger(id) on delete restrict,
 amount_cents integer not null check (amount_cents > 0),
 currency text not null default 'VND',
 payment_method text not null check (payment_method in ('qr','card','cash')),
 sold_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 constraint checkout_purchase_kind_check check ((kind='package') = (purchase_id is not null))
);
create index if not exists idx_class_checkouts_customer_at on public.class_checkouts(customer_id,created_at desc);
create index if not exists idx_class_checkouts_created on public.class_checkouts(created_at desc);
alter table public.class_checkouts enable row level security;
revoke all on public.class_checkouts from public, anon, authenticated;
grant select, insert on public.class_checkouts to service_role;

-- True only when the customer's *first attended class* was funded by the
-- original 30-day signup starter grant. Manual goodwill credits do not qualify.
create or replace function public.eligible_starter_checkout(p_booking uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
 v_booking record;
 v_starter_spent integer;
begin
 select b.id,b.customer_id,b.status,b.credits_spent,b.booked_at,
        s.starts_at,c.created_at as customer_created
 into v_booking
 from public.bookings b
 join public.sessions s on s.id=b.session_id
 join public.customers c on c.id=b.customer_id
 where b.id=p_booking;
 if not found or v_booking.status <> 'attended' or v_booking.credits_spent <= 0 then return false; end if;
 if exists(select 1 from public.class_checkouts x where x.booking_id=p_booking) then return false; end if;
 if exists(
  select 1 from public.bookings prior
  join public.sessions ps on ps.id=prior.session_id
  where prior.customer_id=v_booking.customer_id
    and prior.status='attended'
    and prior.id <> p_booking
    and (ps.starts_at,prior.id) < (v_booking.starts_at,v_booking.id)
 ) then return false; end if;
 select coalesce(sum(src.credits),0) into v_starter_spent
 from public.credit_ledger spend
 cross join lateral public.credit_spend_sources(spend.id) src
 join public.credit_ledger grant_row on grant_row.id=src.source_grant_id
 where spend.booking_id=p_booking and spend.reason='booking' and spend.delta<0
   and grant_row.reason='adjustment' and grant_row.delta=1 and grant_row.package_id is null
   and grant_row.expires_at is not null
   and grant_row.expires_at between grant_row.created_at+interval '29 days'
                                and grant_row.created_at+interval '31 days'
   and grant_row.created_at between v_booking.customer_created-interval '1 day'
                                and v_booking.customer_created+interval '2 days';
 return v_starter_spent >= v_booking.credits_spent;
end; $$;
revoke all on function public.eligible_starter_checkout(uuid) from public, anon, authenticated;
grant execute on function public.eligible_starter_checkout(uuid) to service_role;

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
 v_credits integer := 0;
 v_pool text;
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
    and grant_row.reason='purchase'
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
 else
  if p_package is not null then raise exception 'Single-class payments cannot issue a package'; end if;
  v_pool := v_booking.pool;
  -- A single payment settles just this attendance. No new credit is granted.
 end if;

 insert into public.class_checkouts
  (booking_id,customer_id,kind,purchase_id,amount_cents,currency,payment_method,sold_by)
 values (p_booking,v_booking.customer_id,p_kind,v_purchase_id,p_amount_cents,
         case when p_kind='package' then v_pkg.currency else 'VND' end,
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
