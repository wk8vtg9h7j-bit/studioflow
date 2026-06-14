-- ============================================================================
-- StudioFlow — seed data  (SELF-CORRECTING / idempotent)
--
-- Running this file REPAIRS the database to the canonical VND / Da Nang state:
--   1. It DELETES any legacy English/GBP demo rows (old "StudioFlow — Shoreditch/
--      Notting Hill" studios, old English class types, and every non-VND pay rule).
--   2. It UPSERTS the real studios, class types, packages, and a default VND pay
--      rule — keyed on the live UUIDs, so it never duplicates or clobbers your
--      hand-built data. Run it as often as you like; the end state is the same.
--
-- So even if an older seed "sneaks in" GBP/London rows, the next run of THIS file
-- overwrites them back to VND/Da Nang.
--
-- Real accounts (create in Auth -> Users; roles are also enforced below):
--   info@rechargeddanang.com        admin
--   lukaspetrauskas@outlook.com     instructor (Violet)
--   teaching@rechargeddanang.com    customer
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CLEANUP — remove legacy English/GBP demo data
-- ----------------------------------------------------------------------------
-- Old demo studios (Shoreditch / Notting Hill) live at these fixed UUIDs.
delete from sessions
  where studio_id in ('11111111-1111-1111-1111-111111111111',
                      '22222222-2222-2222-2222-222222222222');
delete from studios
  where id in ('11111111-1111-1111-1111-111111111111',
               '22222222-2222-2222-2222-222222222222');

-- Old English class types (Reformer Flow / Mat / Tower / Prenatal).
delete from class_types
  where id in ('aaaaaaa1-0000-0000-0000-000000000001',
               'aaaaaaa1-0000-0000-0000-000000000002',
               'aaaaaaa1-0000-0000-0000-000000000003',
               'aaaaaaa1-0000-0000-0000-000000000004');

-- Pay rules are fully reconstructed below, so wipe them all (this also clears any
-- GBP rules an old seed introduced). session_payroll.pay_rule_id is ON DELETE
-- SET NULL, so existing payroll records keep their computed amounts.
delete from pay_rules;

-- ----------------------------------------------------------------------------
-- 2) Studios  (real Da Nang studios — keyed on their live UUIDs)
-- ----------------------------------------------------------------------------
insert into studios (id, name, slug, address, timezone, brand_color, active)
values
  ('29a71d53-effe-4343-8da2-f523d6f109f8', 'Hideaway Pilates', 'hideaway-pilates',
   '460 Trưng Nữ Vương', 'Asia/Ho_Chi_Minh', '#0ea5e9', true),
  ('3f017a73-cf60-4c97-a8c6-f683f4041c7c', 'Downtown Pilates', 'downtown-pilates',
   '89 Lê Thanh Nghị', 'Asia/Ho_Chi_Minh', '#7c3aed', true)
on conflict (id) do update set
  name = excluded.name, slug = excluded.slug, address = excluded.address,
  timezone = excluded.timezone, brand_color = excluded.brand_color, active = true;

-- ----------------------------------------------------------------------------
-- 3) Class types  (keyed on their live UUIDs)
-- ----------------------------------------------------------------------------
insert into class_types (id, name, description, default_duration_min, default_capacity, credits_cost, color, active)
values
  ('bd3b61ec-5fb1-4ddc-b80d-ec56bd9c82d5', 'Sunrise Sculpt',
   'Energising morning sculpt to start the day.', 50, 4, 1, '#f59e0b', true),
  ('ddaa8eb2-a764-4ede-8f36-3642a865a0a6', 'Foundation Flow',
   'Core fundamentals and controlled flow.', 50, 4, 1, '#8b5cf6', true),
  ('fc453174-9036-482b-b189-fbcb796d5f31', 'Core Revival',
   'Deep core strength and recovery.', 50, 4, 1, '#10b981', true),
  ('7fcf9859-6de3-4ce2-ab76-6e07061bfa14', 'Sunset Strength',
   'Full-body strength to close the day.', 50, 4, 2, '#ef4444', true)
on conflict (id) do update set
  name = excluded.name, description = excluded.description,
  default_duration_min = excluded.default_duration_min,
  default_capacity = excluded.default_capacity,
  credits_cost = excluded.credits_cost, color = excluded.color, active = true;

-- ----------------------------------------------------------------------------
-- 4) Packages  (current VND pricing, flat across both studios)
-- ----------------------------------------------------------------------------
insert into packages (id, name, description, credits, price_cents, currency, validity_days, active)
values
  ('bbbbbbb1-0000-0000-0000-000000000004', 'Single Class',
   'Pay-as-you-go single credit.', 1, 400000, 'VND', 30, true),
  ('bbbbbbb1-0000-0000-0000-000000000001', '5 Class Pack',
   'Five credits.', 5, 1700000, 'VND', 90, true),
  ('bbbbbbb1-0000-0000-0000-000000000002', '10 Class Pack',
   'Ten credits — best value for regulars.', 10, 3200000, 'VND', 120, true),
  ('bbbbbbb1-0000-0000-0000-000000000003', '20 Class Pack',
   'Twenty credits.', 20, 5600000, 'VND', 180, true)
on conflict (id) do update set
  name = excluded.name, description = excluded.description, credits = excluded.credits,
  price_cents = excluded.price_cents, currency = excluded.currency,
  validity_days = excluded.validity_days, active = true;

-- ----------------------------------------------------------------------------
-- 5) Default pay rule  (global VND fallback)
-- ----------------------------------------------------------------------------
insert into pay_rules (id, name, model, base_amount, per_head_amount, currency, priority, active)
values ('eeeeeee2-0000-0000-0000-000000000001', 'Default rate',
        'base_plus_per_head', 200000, 30000, 'VND', 0, true)
on conflict (id) do update set
  name = excluded.name, model = excluded.model, base_amount = excluded.base_amount,
  per_head_amount = excluded.per_head_amount, currency = 'VND',
  priority = excluded.priority, active = true;

-- ============================================================================
-- 6) LINK REAL ACCOUNTS  (idempotent; safe to run before the users exist)
-- Re-establishes roles, the Violet instructor link + her premium rule + her
-- session assignments, and the customer record — so they survive auth re-creates.
-- ============================================================================
do $$
declare
  v_admin    uuid;
  v_violet   uuid;
  v_inst_id  uuid;
  v_customer uuid;
  v_cust_id  uuid;
  v_hideaway uuid := '29a71d53-effe-4343-8da2-f523d6f109f8';
  v_downtown uuid := '3f017a73-cf60-4c97-a8c6-f683f4041c7c';
begin
  select id into v_admin    from auth.users where email = 'info@rechargeddanang.com';
  select id into v_violet   from auth.users where email = 'lukaspetrauskas@outlook.com';
  select id into v_customer from auth.users where email = 'teaching@rechargeddanang.com';

  -- Admin
  if v_admin is not null then
    update profiles set role = 'admin' where id = v_admin;
  end if;

  -- Instructor: Violet
  if v_violet is not null then
    update profiles set role = 'instructor', full_name = 'Violet' where id = v_violet;
    insert into instructors (profile_id, display_name, active)
    values (v_violet, 'Violet', true)
    on conflict (profile_id) do update set display_name = 'Violet', active = true
    returning id into v_inst_id;
    if v_inst_id is null then
      select id into v_inst_id from instructors where profile_id = v_violet;
    end if;

    -- Violet premium rate (instructor-specific, wins over the default).
    insert into pay_rules (id, name, model, base_amount, per_head_amount, currency, instructor_id, priority, active)
    values ('eeeeeee2-0000-0000-0000-000000000002', 'Violet premium',
            'base_plus_per_head', 250000, 50000, 'VND', v_inst_id, 10, true)
    on conflict (id) do update set
      base_amount = 250000, per_head_amount = 50000, currency = 'VND',
      instructor_id = v_inst_id, priority = 10, active = true;

    -- Assign Violet to every class in both studios.
    update sessions set instructor_id = v_inst_id
      where studio_id in (v_hideaway, v_downtown);
  end if;

  -- Customer
  if v_customer is not null then
    update profiles set role = 'customer' where id = v_customer;
    insert into customers (profile_id, status, source)
    values (v_customer, 'active', 'signup')
    on conflict (profile_id) do update set status = 'active'
    returning id into v_cust_id;
    if v_cust_id is null then
      select id into v_cust_id from customers where profile_id = v_customer;
    end if;

    -- One starter credit if they have no ledger history yet.
    if v_cust_id is not null and not exists (select 1 from credit_ledger where customer_id = v_cust_id) then
      insert into credit_ledger (customer_id, delta, reason, expires_at)
      values (v_cust_id, 1, 'adjustment', now() + interval '30 days');
    end if;
  end if;
end $$;
