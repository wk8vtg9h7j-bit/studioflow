-- Correct active private package definitions so future grants enter the
-- private credit pool. Historical purchase ledger rows keep their original pool
-- because those credits may already have been consumed by past bookings.
update public.packages
set pool = 'private'
where id in (
  '3be97f0b-e84f-487f-a452-1121e80af28d',
  'a25f560a-f015-451c-9d5c-e1e80bf08bd5'
)
  and pool <> 'private';
