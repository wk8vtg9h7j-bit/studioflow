-- Track one Google Calendar event per booked/filler spot.
alter table public.bookings
  add column if not exists google_event_ids text[];

alter table public.sessions
  add column if not exists google_filler_event_ids text[];
