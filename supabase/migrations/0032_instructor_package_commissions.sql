-- ============================================================================
-- Instructor package-sale commissions.
--
-- Paid packages issued from the instructor customer screen earn 2.5% of the
-- actual amount charged. The seller, rate and amount are snapshotted on the
-- purchase ledger row so later package-price changes cannot rewrite history.
-- ============================================================================

alter table public.credit_ledger
  add column if not exists sold_by uuid references public.profiles(id) on delete set null,
  add column if not exists commission_rate_bps integer,
  add column if not exists commission_amount_cents integer;

create index if not exists idx_credit_ledger_sold_by_created_at
  on public.credit_ledger(sold_by, created_at desc)
  where sold_by is not null;

do $$
begin
  alter table public.credit_ledger
    add constraint credit_ledger_commission_rate_bps_chk
    check (commission_rate_bps is null or commission_rate_bps between 0 and 10000);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.credit_ledger
    add constraint credit_ledger_commission_amount_nonnegative_chk
    check (commission_amount_cents is null or commission_amount_cents >= 0);
exception when duplicate_object then null;
end $$;

create or replace function public.snapshot_instructor_package_commission()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reason = 'purchase'
     and new.sold_by is not null
     and exists (
       select 1
       from public.instructors i
       where i.profile_id = new.sold_by
     )
  then
    new.commission_rate_bps := 250;

    if new.sale_amount_cents is not null then
      new.commission_amount_cents :=
        round(new.sale_amount_cents::numeric * 250 / 10000)::integer;
    else
      new.commission_amount_cents := null;
    end if;
  else
    new.commission_rate_bps := null;
    new.commission_amount_cents := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_z_snapshot_instructor_package_commission
  on public.credit_ledger;

create trigger trg_z_snapshot_instructor_package_commission
before insert or update of reason, sold_by, sale_amount_cents, commission_rate_bps
on public.credit_ledger
for each row
execute function public.snapshot_instructor_package_commission();
