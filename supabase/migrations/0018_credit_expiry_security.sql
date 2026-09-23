-- Keep the expiry helper private to trusted server-side processing.
revoke execute on function public.credit_grant_remaining_at(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.credit_grant_remaining_at(uuid, timestamptz)
  to service_role;

create index if not exists idx_credit_expiry_notifications_customer
  on public.credit_expiry_notifications (customer_id);
