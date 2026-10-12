-- One follow-up per customer / event / month. Never sends to non-opted-in customers.
create table if not exists public.customer_followup_log (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id) on delete cascade,
 event_key text not null unique,
 kind text not null check (kind in ('unpaid_first_visit','last_credit','inactive_30')),
 status text not null default 'claimed' check (status in ('claimed','sent','failed')),
 recipient_email text not null,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 last_error text
);
create index if not exists idx_customer_followup_log_created on public.customer_followup_log(created_at desc);
alter table public.customer_followup_log enable row level security;
revoke all on public.customer_followup_log from public,anon,authenticated;
grant select,insert,update on public.customer_followup_log to service_role;
