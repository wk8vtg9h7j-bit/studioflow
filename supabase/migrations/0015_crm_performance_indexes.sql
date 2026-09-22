-- CRM/query performance indexes. Non-destructive; these only improve lookup paths.

create index if not exists idx_sessions_start
  on public.sessions (starts_at);

create index if not exists idx_sessions_class_type_start
  on public.sessions (class_type_id, starts_at);

create index if not exists idx_bookings_session_status
  on public.bookings (session_id, status);

create index if not exists idx_bookings_booked_at
  on public.bookings (booked_at desc);

create index if not exists idx_bookings_cancelled_at
  on public.bookings (cancelled_at desc)
  where cancelled_at is not null;

create index if not exists idx_customers_created_at
  on public.customers (created_at desc);

create index if not exists idx_credit_ledger_balance_lookup
  on public.credit_ledger (customer_id, (coalesce(pool, 'regular')), expires_at);
