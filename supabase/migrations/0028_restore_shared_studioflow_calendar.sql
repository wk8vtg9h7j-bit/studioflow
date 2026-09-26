
-- Restore StudioFlow Pilates to its shared booking calendar.
update public.studios
set google_calendar_id = 'c_a93c9c37518448c5d12cd215d66169dc33e3daa8bd20db21547cba87f713f8d4@group.calendar.google.com'
where slug in ('hideaway-pilates','downtown-pilates');

-- Reconcile only upcoming sessions that actually need Google booking events.
update public.sessions s
set google_sync_pending_at = now()
where s.starts_at >= now() - interval '1 day'
  and (
    coalesce(s.filler_seats,0) > 0
    or exists (
      select 1
      from public.bookings b
      where b.session_id=s.id
        and b.status in ('booked','attended','no_show','cancelled')
    )
  );
