-- ============================================================================
-- Customer class reminders + optional personal Google Calendar connection.
--
-- Sensitive Google refresh tokens live in a service-role-only table. Customers
-- only expose a non-sensitive preference flag on their own customer row.
-- ============================================================================

alter table public.customers
  add column if not exists calendar_auto_add boolean not null default false,
  add column if not exists reminder_email_enabled boolean not null default true;

alter table public.bookings
  add column if not exists customer_google_event_id text,
  add column if not exists customer_calendar_sync_pending_at timestamptz;

create index if not exists idx_bookings_customer_calendar_pending
  on public.bookings (customer_calendar_sync_pending_at)
  where customer_calendar_sync_pending_at is not null;

create table if not exists public.customer_google_connections (
  customer_id uuid primary key
    references public.customers(id) on delete cascade,
  google_refresh_token text,
  google_calendar_id text not null default 'primary',
  google_account_email text,
  google_token_status google_token_status not null
    default 'disconnected'::google_token_status,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_google_connections enable row level security;
revoke all on table public.customer_google_connections from anon, authenticated;

create table if not exists public.booking_reminder_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null
    references public.bookings(id) on delete cascade,
  session_starts_at timestamptz not null,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, session_starts_at)
);

alter table public.booking_reminder_notifications enable row level security;
revoke all on table public.booking_reminder_notifications from anon, authenticated;

create index if not exists idx_booking_reminders_pending
  on public.booking_reminder_notifications (created_at)
  where sent_at is null;

create or replace function public.mark_customer_calendar_booking_pending()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.customer_calendar_sync_pending_at := now();
  return new;
end;
$$;

drop trigger if exists trg_customer_calendar_booking_pending
  on public.bookings;

create trigger trg_customer_calendar_booking_pending
before insert or update of status, session_id
on public.bookings
for each row
execute function public.mark_customer_calendar_booking_pending();

create or replace function public.mark_session_customer_calendars_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set customer_calendar_sync_pending_at = now()
  where session_id = new.id
    and (
      status in ('booked', 'waitlisted', 'attended', 'no_show')
      or customer_google_event_id is not null
    );

  return new;
end;
$$;

drop trigger if exists trg_mark_session_customer_calendars_pending
  on public.sessions;

create trigger trg_mark_session_customer_calendars_pending
after update of starts_at, ends_at, title, room, status, studio_id, class_type_id, instructor_id
on public.sessions
for each row
execute function public.mark_session_customer_calendars_pending();
