-- Attribute admin-confirmed class-package sales to the instructor who
-- actually teaches the linked class while retaining the admin as the
-- collector on class_checkouts.sold_by (audit history).
--
-- The existing credit_ledger snapshot trigger recalculates the 2.5% amount
-- when its sold_by field changes. Single-class checkouts remain unchanged.
create or replace function public.attribute_admin_checkout_to_instructor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_instructor_profile uuid;
begin
  if new.kind <> 'package' or new.purchase_id is null then
    return new;
  end if;

  select role::text into v_role
  from public.profiles
  where id = new.sold_by;

  if v_role <> 'admin' then
    return new;
  end if;

  select i.profile_id into v_instructor_profile
  from public.bookings b
  join public.sessions s on s.id = b.session_id
  join public.instructors i on i.id = s.instructor_id
  where b.id = new.booking_id;

  -- An unassigned class cannot earn teacher commission; never invent a seller.
  if v_instructor_profile is null then
    return new;
  end if;

  update public.credit_ledger
     set sold_by = v_instructor_profile
   where id = new.purchase_id
     and customer_id = new.customer_id
     and reason = 'purchase';

  if not found then
    raise exception 'Could not attribute package commission to the assigned instructor';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_attribute_admin_checkout_to_instructor on public.class_checkouts;
create trigger trg_attribute_admin_checkout_to_instructor
after insert on public.class_checkouts
for each row
execute function public.attribute_admin_checkout_to_instructor();
