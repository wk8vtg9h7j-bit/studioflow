-- ============================================================================
-- Admin phone push subscriptions.
--
-- Admin devices are managed only through admin-authenticated server actions and
-- the service-role delivery worker. Every active admin with an enabled device
-- receives every new confirmed booking.
-- ============================================================================

create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_push_subscriptions enable row level security;

revoke all on table public.admin_push_subscriptions from anon, authenticated;
grant select, insert, update, delete
  on table public.admin_push_subscriptions
  to service_role;

create index if not exists idx_admin_push_subscriptions_profile
  on public.admin_push_subscriptions(profile_id);

drop trigger if exists trg_admin_push_subscriptions_updated
  on public.admin_push_subscriptions;

create trigger trg_admin_push_subscriptions_updated
before update on public.admin_push_subscriptions
for each row execute function public.set_updated_at();
