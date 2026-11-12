-- Prevent a new full package grant from silently leaving an unpaid starter visit
-- outside the package. Do not change historical credits or legitimate renewals.
create or replace function public.guard_unsettled_starter_package_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credits integer;
begin
  if new.reason <> 'purchase' or new.package_id is null or new.delta <= 0 then
    return new;
  end if;

  select p.credits into v_credits
  from public.packages p where p.id = new.package_id;

  -- First-visit checkout correctly grants (package size - attended credits).
  -- Only a FULL package grant without first-visit settlement needs protection.
  if v_credits is null or new.delta <> v_credits then
    return new;
  end if;

  if exists (
    select 1
    from public.bookings b
    join public.sessions s on s.id = b.session_id
    join public.class_types ct on ct.id = s.class_type_id
    where b.customer_id = new.customer_id
      and b.status = 'attended'
      and coalesce(ct.pool, 'regular') = coalesce(new.pool, 'regular')
      and s.starts_at <= now()
      and s.starts_at >= now() - interval '14 days'
      and public.eligible_starter_checkout(b.id)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Unsettled first visit: use Collect payment > Package (today included) on the attended booking before issuing a full package. Do not grant full credits for a class already attended.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_unsettled_starter_package_purchase on public.credit_ledger;
create trigger trg_guard_unsettled_starter_package_purchase
before insert on public.credit_ledger
for each row execute function public.guard_unsettled_starter_package_purchase();

revoke all on function public.guard_unsettled_starter_package_purchase()
from public, anon, authenticated;
