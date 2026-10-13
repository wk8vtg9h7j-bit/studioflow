-- Allow a newly created PRIVATE customer whose first attended class was
-- funded by a reception-issued provisional credit to include that class in
-- their first paid private package. Previously only the auto-issued 30-day
-- signup credit qualified; reception private customers receive non-expiring
-- manual adjustments instead. Keep normal group-class eligibility unchanged.
-- Actual payment/credit issuance remains atomic in record_class_checkout().
create or replace function public.eligible_starter_checkout(p_booking uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
 v_booking record;
 v_starter_spent integer;
begin
 select b.id,b.customer_id,b.status,b.credits_spent,b.booked_at,
        s.starts_at,c.created_at as customer_created,
        coalesce(ct.pool,'regular') as pool
 into v_booking
 from public.bookings b
 join public.sessions s on s.id=b.session_id
 join public.class_types ct on ct.id=s.class_type_id
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
   and grant_row.reason='adjustment' and grant_row.delta=1
   and grant_row.package_id is null
   and coalesce(grant_row.pool,'regular')=v_booking.pool
   and grant_row.created_at between v_booking.customer_created-interval '1 day'
                                and v_booking.customer_created+interval '2 days'
   and (
     -- Existing 30-day signup starter credits (all class types).
     (grant_row.expires_at is not null
      and grant_row.expires_at between grant_row.created_at+interval '29 days'
                                   and grant_row.created_at+interval '31 days')
     -- Non-expiring provisional credits given to newly registered private
     -- students; require their first visit within the original 30-day window.
     or (v_booking.pool='private' and grant_row.expires_at is null
         and v_booking.starts_at >= v_booking.customer_created-interval '1 day'
         and v_booking.starts_at <= v_booking.customer_created+interval '30 days')
   );
 return v_starter_spent >= v_booking.credits_spent;
end;
$$;
revoke all on function public.eligible_starter_checkout(uuid) from public, anon, authenticated;
grant execute on function public.eligible_starter_checkout(uuid) to service_role;
