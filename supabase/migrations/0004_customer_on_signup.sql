-- ============================================================================
-- StudioFlow — create the CRM customer record (and a starter credit) at signup
--
-- Fixes a chicken-and-egg gap: previously handle_new_user() created only a
-- `profiles` row. A `customers` row was only ever created lazily inside
-- book_session(), but booking with no credits raises and rolls that back — so
-- new members never appeared in the admin CRM and could never be granted
-- credits, and could never book.
--
-- Now, when a customer-role user signs up we also:
--   • create their `customers` CRM record, and
--   • grant 1 starter credit (reason 'adjustment' so it does NOT appear as
--     revenue on the Payments page), valid for 30 days.
-- ============================================================================

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_customer_id uuid;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer');

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    v_role
  )
  on conflict (id) do nothing;

  -- Every customer gets a CRM record + a single starter credit on signup.
  if v_role = 'customer'
     and not exists (select 1 from public.customers where profile_id = new.id)
  then
    insert into public.customers (profile_id, status, source)
    values (new.id, 'active', 'signup')
    returning id into v_customer_id;

    insert into public.credit_ledger (customer_id, delta, reason, expires_at)
    values (v_customer_id, 1, 'adjustment', now() + interval '30 days');
  end if;

  return new;
end $$;

-- ----------------------------------------------------------------------------
-- Backfill: any existing customer-role profile that has no CRM record gets one
-- (and, if it has no ledger history at all, a starter credit too). Idempotent.
-- ----------------------------------------------------------------------------
insert into public.customers (profile_id, status, source)
select p.id, 'active', 'signup'
from public.profiles p
where p.role = 'customer'
  and not exists (select 1 from public.customers c where c.profile_id = p.id);

insert into public.credit_ledger (customer_id, delta, reason, expires_at)
select c.id, 1, 'adjustment', now() + interval '30 days'
from public.customers c
where c.source = 'signup'
  and not exists (select 1 from public.credit_ledger l where l.customer_id = c.id);
