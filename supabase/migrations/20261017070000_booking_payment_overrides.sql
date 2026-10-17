-- Admin-reviewed payment status overrides are separate from receipts and credit ledger.
-- No customer or instructor has direct access; server actions enforce admin role.
create table if not exists public.booking_payment_overrides (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status text not null check (status in ('package','payment_due')),
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists booking_payment_overrides_customer_idx on public.booking_payment_overrides(customer_id);
alter table public.booking_payment_overrides enable row level security;
revoke all on public.booking_payment_overrides from anon, authenticated;
comment on table public.booking_payment_overrides is 'Admin-only manual adjudications; not payment receipts. Must not alter credits or revenue.';
