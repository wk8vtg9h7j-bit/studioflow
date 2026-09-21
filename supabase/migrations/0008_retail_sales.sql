-- ============================================================================
-- StudioFlow — retail sales (socks, grip gloves, water, merch).
--
-- Until now the only sellable thing was a package, and the only record of a sale
-- was a credit_ledger row — which by definition grants credits. Retail goods
-- grant no credits, so they could not be recorded without corrupting balances.
--
-- Retail therefore lives in its own tables and never touches credit_ledger.
-- Line items snapshot the product name and unit price at the moment of sale, so
-- editing a product's price later never rewrites past takings. The payment
-- method vocabulary matches credit_ledger (0005) so the daily Payments report
-- can break both revenue streams down by the same buckets.
--
-- A sale may have no customer: reception sells to walk-ins who have no account,
-- the same case that made customers.profile_id optional in 0006.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- products — the price list. Mirrors packages: no stock tracking, no updated_at.
-- ----------------------------------------------------------------------------
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  sku         text,                                  -- optional shelf/barcode ref
  price_cents int not null,                          -- minor units, as packages
  currency    text not null default 'VND',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_products_active on products(active);

-- ----------------------------------------------------------------------------
-- sales — one transaction at the counter.
--
-- total_cents is the amount actually charged, stored rather than derived so the
-- figure in the accounts can never drift when a product is later re-priced.
-- ----------------------------------------------------------------------------
create table if not exists sales (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references customers(id) on delete set null,  -- null = walk-in
  studio_id      uuid references studios(id),
  total_cents    int not null,
  currency       text not null default 'VND',
  payment_method text,                               -- qr | card | cash | null
  notes          text,
  sold_by        uuid references profiles(id),       -- staff member who rang it up
  created_at     timestamptz not null default now()
);
create index if not exists idx_sales_created_at on sales(created_at);
create index if not exists idx_sales_customer   on sales(customer_id);

do $$ begin
  alter table sales
    add constraint sales_payment_method_chk
    check (payment_method is null or payment_method in ('qr', 'card', 'cash'));
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- sale_items — the lines on the receipt.
--
-- name and unit_price_cents are copies taken at sale time, not joins. product_id
-- is kept for reporting but is nullable: deleting a product must never destroy
-- the history of what was sold.
-- ----------------------------------------------------------------------------
create table if not exists sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references sales(id) on delete cascade,
  product_id       uuid references products(id) on delete set null,
  name             text not null,                    -- snapshot
  unit_price_cents int not null,                     -- snapshot
  qty              int not null default 1,
  line_total_cents int not null,                     -- unit_price_cents * qty
  created_at       timestamptz not null default now()
);
create index if not exists idx_sale_items_sale on sale_items(sale_id);

do $$ begin
  alter table sale_items add constraint sale_items_qty_chk check (qty > 0);
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table products   enable row level security;
alter table sales      enable row level security;
alter table sale_items enable row level security;

-- products: public read active; admin manage --------------------------------
create policy "products public read" on products for select using (active or is_admin());
create policy "products admin write" on products for all using (is_admin()) with check (is_admin());

-- sales: customer reads own; admin all ---------------------------------------
create policy "sales owner read" on sales for select using (
  is_admin() or customer_id = my_customer_id()
);
create policy "sales admin write" on sales for all using (is_admin()) with check (is_admin());

-- sale_items: visible with the parent sale; admin all ------------------------
create policy "sale_items owner read" on sale_items for select using (
  is_admin() or exists (
    select 1 from sales s
    where s.id = sale_items.sale_id and s.customer_id = my_customer_id()
  )
);
create policy "sale_items admin write" on sale_items for all using (is_admin()) with check (is_admin());
