-- ============================================================================
-- Durable email notifications for customer bookings.
--
-- Every booking event is queued in Postgres so email delivery is retryable and
-- does not slow down or fail the booking transaction itself.
-- ============================================================================

create table if not exists public.booking_email_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null
    references public.bookings(id) on delete cascade,
  booked_at timestamptz not null,
  booking_status text not null
    check (booking_status in ('booked', 'waitlisted')),
  spots_count int not null default 1
    check (spots_count >= 1),
  customer_sent_at timestamptz,
  admin_sent_at timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique (booking_id, booked_at, booking_status)
);

alter table public.booking_email_notifications enable row level security;

create index if not exists idx_booking_email_notifications_pending
  on public.booking_email_notifications (created_at)
  where customer_sent_at is null or admin_sent_at is null;

create or replace function public.queue_booking_email_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('booked', 'waitlisted')
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.booked_at is distinct from new.booked_at
     )
  then
    insert into public.booking_email_notifications (
      booking_id,
      booked_at,
      booking_status,
      spots_count
    )
    values (
      new.id,
      new.booked_at,
      new.status::text,
      greatest(coalesce(new.spots_count, 1), 1)
    )
    on conflict (booking_id, booked_at, booking_status) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_queue_booking_email_notification
  on public.bookings;

create trigger trg_queue_booking_email_notification
after insert or update of status, booked_at
on public.bookings
for each row
execute function public.queue_booking_email_notification();
