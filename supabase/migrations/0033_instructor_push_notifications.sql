-- ============================================================================
-- Instructor phone push notifications.
--
-- Push subscriptions are stored server-side and tied to the authenticated
-- instructor row. Existing booking_email_notifications rows are reused as the
-- durable booking-event queue so every booking source (customer, admin,
-- waitlist promotion) follows the same notification path.
-- ============================================================================

create table if not exists public.instructor_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.instructor_push_subscriptions enable row level security;

-- Subscriptions contain device-specific push credentials. They are managed only
-- through authenticated server actions / cron with the service role and are
-- never exposed directly through the customer-facing Data API.
revoke all on table public.instructor_push_subscriptions from anon, authenticated;
grant select, insert, update, delete
  on table public.instructor_push_subscriptions
  to service_role;

create index if not exists idx_instructor_push_subscriptions_instructor
  on public.instructor_push_subscriptions(instructor_id);

drop trigger if exists trg_instructor_push_subscriptions_updated
  on public.instructor_push_subscriptions;

create trigger trg_instructor_push_subscriptions_updated
before update on public.instructor_push_subscriptions
for each row execute function public.set_updated_at();

alter table public.booking_email_notifications
  add column if not exists instructor_push_sent_at timestamptz,
  add column if not exists instructor_push_attempts integer not null default 0,
  add column if not exists instructor_push_last_error text;

do $$
begin
  alter table public.booking_email_notifications
    add constraint booking_email_notifications_push_attempts_nonnegative
    check (instructor_push_attempts >= 0);
exception when duplicate_object then null;
end $$;

-- Do not replay historical bookings when an instructor first enables push.
-- Booking queue rows created after this migration remain NULL and are eligible.
update public.booking_email_notifications
set instructor_push_sent_at = now()
where instructor_push_sent_at is null;

create index if not exists idx_booking_email_notifications_push_pending
  on public.booking_email_notifications(created_at)
  where booking_status = 'booked' and instructor_push_sent_at is null;
