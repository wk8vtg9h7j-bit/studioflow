-- Guarantee that a booked private session belongs to its original customer,
-- can never accept a third-party waitlist, and disappears if that booking is
-- cancelled. This keeps the separate private calendar consistent with /book.
create or replace function public.pin_private_booking_customer()
returns trigger language plpgsql set search_path=public as $$
declare v_customer uuid;
begin
 if new.booked_session_id is not null and new.status='booked' then
  select b.customer_id into v_customer from public.bookings b
  where b.session_id=new.booked_session_id and b.status in ('booked','attended')
  order by b.booked_at limit 1;
  if v_customer is null then raise exception 'A private booking must have a booked customer'; end if;
  if new.reserved_for_customer_id is not null
    and new.reserved_for_customer_id<>v_customer then
   raise exception 'Private slot reserved for another customer';
  end if;
  new.reserved_for_customer_id:=v_customer;
 end if;
 return new;
end $$;
drop trigger if exists trg_pin_private_booking_customer on public.private_slots;
create trigger trg_pin_private_booking_customer
before update of booked_session_id on public.private_slots
for each row execute function public.pin_private_booking_customer();

create or replace function public.block_other_customers_from_private_booking()
returns trigger language plpgsql set search_path=public as $$
declare v_owner uuid;
begin
 if new.status in ('booked','waitlisted','attended') then
  select p.reserved_for_customer_id into v_owner
  from public.private_slots p
  where p.booked_session_id=new.session_id and p.status='booked';
  if found and (v_owner is null or v_owner<>new.customer_id) then
   raise exception 'This private class belongs to another customer';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists trg_private_booking_customer_guard on public.bookings;
create trigger trg_private_booking_customer_guard
before insert or update of customer_id,session_id,status on public.bookings
for each row execute function public.block_other_customers_from_private_booking();

create or replace function public.close_private_after_booking_cancel()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status
 and exists(select 1 from public.private_slots p
            where p.booked_session_id=new.session_id and p.status='booked')
 and not exists(select 1 from public.bookings b
  where b.session_id=new.session_id and b.status in ('booked','attended')
 ) then
  update public.private_slots set status='closed' where booked_session_id=new.session_id;
  update public.private_requests r set status='cancelled',responded_at=now()
  from public.private_slots p
  where p.booked_session_id=new.session_id and r.slot_id=p.id and r.status='booked';
  update public.sessions set status='cancelled'
  where id=new.session_id and status='scheduled';
 end if;
 return new;
end $$;
drop trigger if exists trg_close_private_after_cancel on public.bookings;
create trigger trg_close_private_after_cancel
after update of status on public.bookings
for each row execute function public.close_private_after_booking_cancel();
