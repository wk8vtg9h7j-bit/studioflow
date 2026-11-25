-- ============================================================================
-- StudioFlow — guards for third-party (Google) sign-in.
--
-- WHY THIS EXISTS
-- ---------------
-- Until now every account was born inside signUpAction (src/app/(auth)/actions.ts),
-- which validates a phone number, pins role='customer' and records a preferred
-- studio *before* the auth user is created. An OAuth sign-in creates the auth
-- user itself, so signUpAction never runs: this trigger is the ONLY thing
-- standing behind a Google-created account.
--
--   => Any rule added to signUpAction that must hold for EVERY member has to be
--      mirrored here, or it will silently not apply to Google users.
--
-- That is the durable point of this migration. The behavioural change below is
-- deliberately tiny.
--
-- WHAT THIS CHANGES
-- -----------------
-- One thing only: the same person can no longer be granted the starter credit
-- twice.
--
-- Supabase attaches a Google identity to an existing user when that user's email
-- is already confirmed — and ours always are, because signUpAction creates users
-- with email_confirm: true. So in the correct configuration no second auth user
-- is ever created and this guard never fires.
--
-- If that linking is misconfigured, however, signing in with Google creates a
-- SECOND auth user for an address that already has an account. This trigger
-- would then create a second customers row and hand out a second 30-day starter
-- credit, splitting the member's booking history across two records. The guard
-- makes that failure cheap instead of expensive.
--
-- The condition is narrow on purpose: suppress the grant only when a customer
-- already exists with the same email AND is already attached to a different
-- login (profile_id is not null and <> new.id). Reception-created walk-ins have
-- profile_id null, so a walk-in who later registers still receives their starter
-- credit exactly as before. Nothing else about walk-ins changes.
--
-- WHAT IS CARRIED OVER UNCHANGED
-- ------------------------------
-- Everything else is verbatim from 0012_signup_phone.sql. In particular the
-- starter grant keeps its exact shape — delta 1, reason 'adjustment',
-- package_id null, expires_at now() + interval '30 days', written in the same
-- statement batch as the customers row — because eligible_starter_checkout() in
-- 0037_first_visit_checkout.sql matches on precisely that shape (delta = 1,
-- reason = 'adjustment', package_id is null, expires_at 29-31 days after
-- created_at, created_at within -1/+2 days of customers.created_at). Changing
-- any of those values would silently break first-visit checkout eligibility.
--
-- Safe to re-run: create or replace only. The on_auth_user_created trigger from
-- 0001_schema.sql is left alone and keeps pointing at this function.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        user_role;
  v_customer_id uuid;
  v_phone       text;
  v_name        text;
  v_linked_dup  boolean;
begin
  -- OAuth users arrive with no 'role' in metadata, so the coalesce default is
  -- what makes a Google sign-in a customer. Do not remove it.
  v_role  := coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer');
  -- Google supplies full_name but never a phone: v_phone is null for OAuth
  -- signups. Phone is collected by the app after first sign-in, not here.
  v_phone := nullif(trim(new.raw_user_meta_data->>'phone'), '');
  v_name  := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email);

  insert into public.profiles (id, email, full_name, phone, role)
  values (new.id, new.email, v_name, v_phone, v_role)
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(excluded.full_name, profiles.full_name),
        phone      = coalesce(excluded.phone, profiles.phone),
        updated_at = now();

  if v_role = 'customer'
     and not exists (select 1 from public.customers where profile_id = new.id)
  then
    -- Is this email already held by a customer who signs in as someone else?
    -- That means identity linking did not happen and this is a duplicate
    -- account, not a new member.
    select exists (
      select 1
      from public.customers c
      where c.profile_id is not null
        and c.profile_id <> new.id
        and lower(c.email) = lower(new.email)
    ) into v_linked_dup;

    insert into public.customers (
      profile_id,
      status,
      source,
      name,
      email,
      phone
    )
    values (
      new.id,
      'active',
      'signup',
      v_name,
      new.email,
      v_phone
    )
    returning id into v_customer_id;

    -- Shape must stay identical — see eligible_starter_checkout() in 0037.
    if not v_linked_dup then
      insert into public.credit_ledger (customer_id, delta, reason, expires_at)
      values (v_customer_id, 1, 'adjustment', now() + interval '30 days');
    end if;
  end if;

  return new;
end
$$;

-- ============================================================================
-- DIAGNOSTIC (read-only) — run this to find members who already have more than
-- one account on the same email address. Expect zero rows. Any row means a
-- split history that needs merging by hand, and that identity linking should be
-- checked in the Supabase dashboard before Google sign-in is opened up.
--
--   select lower(c.email)                as email,
--          count(*)                      as customer_rows,
--          count(distinct c.profile_id)   as logins,
--          sum(case when l.id is not null then 1 else 0 end) as starter_grants,
--          array_agg(c.id order by c.created_at)             as customer_ids
--   from public.customers c
--   left join public.credit_ledger l
--     on l.customer_id = c.id
--    and l.delta = 1
--    and l.reason = 'adjustment'
--    and l.package_id is null
--   where c.email is not null
--     and c.profile_id is not null
--   group by lower(c.email)
--   having count(distinct c.profile_id) > 1;
-- ============================================================================
