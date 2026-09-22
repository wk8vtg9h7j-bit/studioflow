-- Decouple user-facing booking/admin actions from Google Calendar latency.
-- Any booking/session change marks the session dirty; cron syncs it shortly after.

alter table public.sessions
  add column if not exists google_sync_pending_at timestamptz;

create or replace function public.mark_google_sync_pending_from_booking()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  v_session_id := coalesce(new.session_id, old.session_id);

  update public.sessions
  set google_sync_pending_at = now()
  where id = v_session_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_booking_google_sync_pending on public.bookings;
create trigger trg_booking_google_sync_pending
after insert or delete or update of status, spots_count, customer_id, session_id
on public.bookings
for each row
execute function public.mark_google_sync_pending_from_booking();

create or replace function public.mark_google_sync_pending_from_session()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.sessions
  set google_sync_pending_at = now()
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_session_google_sync_pending on public.sessions;
create trigger trg_session_google_sync_pending
after insert or update of
  title,
  starts_at,
  ends_at,
  room,
  notes,
  status,
  filler_seats,
  instructor_id,
  class_type_id
on public.sessions
for each row
execute function public.mark_google_sync_pending_from_session();

-- Seed only rows that still need Google cleanup/sync.
update public.sessions s
set google_sync_pending_at = now()
where s.starts_at > now()
  and (
    s.google_event_id is not null
    or coalesce(s.filler_seats, 0) > 0
    or exists (
      select 1
      from public.bookings b
      where b.session_id = s.id
        and b.status in ('booked','attended','no_show','cancelled')
    )
  );
