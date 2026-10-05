-- ============================================================================
-- First-booking payment notice acknowledgement.
--
-- New customers receive one starter booking credit so they can reserve their
-- first regular class. It is not a complimentary class. This timestamp lets
-- the customer flow require a one-time acknowledgement before the first
-- successful booking/waitlist action.
--
-- Existing customers with prior real booking history are backfilled so they do
-- not suddenly see a "first booking" notice.
-- ============================================================================

alter table public.customers
  add column if not exists payment_notice_acknowledged_at timestamptz;

comment on column public.customers.payment_notice_acknowledged_at is
  'When the customer acknowledged that the starter booking credit is not a free class and payment may be due after class.';

update public.customers c
set payment_notice_acknowledged_at = coalesce(c.payment_notice_acknowledged_at, now())
where c.payment_notice_acknowledged_at is null
  and exists (
    select 1
    from public.bookings b
    where b.customer_id = c.id
      and b.status in ('booked','attended','no_show','cancelled')
  );
