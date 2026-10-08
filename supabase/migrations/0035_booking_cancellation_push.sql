-- ============================================================================
-- Push notifications for booking cancellations.
--
-- Reuse the durable booking notification queue for cancellation push events,
-- while keeping cancellation rows out of the booking-confirmation email worker.
-- ============================================================================

alter table public.booking_email_notifications
  drop constraint if exists booking_email_notifications_booking_status_check;

alter table public.booking_email_notifications
  add constraint booking_email_notifications_booking_status_check
  check (booking_status in ('booked', 'waitlisted', 'cancelled'));

create or replace function public.queue_booking_email_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('booked', 'waitlisted', 'cancelled')
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

drop index if exists public.idx_booking_email_notifications_push_pending;

create index idx_booking_email_notifications_push_pending
  on public.booking_email_notifications(created_at)
  where booking_status in ('booked', 'cancelled')
    and instructor_push_sent_at is null;
