-- ============================================================================
-- Immutable package-sale accounting snapshots.
--
-- Historical revenue must never change when a package's current price changes.
-- Every purchase ledger row therefore carries the exact sale amount/currency
-- recorded at the moment of sale.
-- ============================================================================

alter table public.credit_ledger
  add column if not exists sale_amount_cents integer,
  add column if not exists sale_currency text;

update public.credit_ledger cl
set
  sale_amount_cents = coalesce(cl.sale_amount_cents, p.price_cents),
  sale_currency = coalesce(cl.sale_currency, p.currency)
from public.packages p
where cl.reason = 'purchase'
  and cl.package_id = p.id
  and (cl.sale_amount_cents is null or cl.sale_currency is null);

create or replace function public.snapshot_package_purchase_amount()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_price integer;
  v_currency text;
begin
  if new.reason <> 'purchase' then
    return new;
  end if;

  if new.sale_amount_cents is not null
     and new.sale_currency is not null
  then
    return new;
  end if;

  if new.package_id is null then
    raise exception 'Package purchase must reference a package';
  end if;

  select price_cents, currency
    into v_price, v_currency
  from public.packages
  where id = new.package_id;

  if not found then
    raise exception 'Package purchase references an unknown package';
  end if;

  new.sale_amount_cents := coalesce(new.sale_amount_cents, v_price);
  new.sale_currency := coalesce(new.sale_currency, v_currency);

  return new;
end;
$$;

drop trigger if exists trg_snapshot_package_purchase_amount
  on public.credit_ledger;

create trigger trg_snapshot_package_purchase_amount
before insert or update of reason, package_id, sale_amount_cents, sale_currency
on public.credit_ledger
for each row
execute function public.snapshot_package_purchase_amount();

do $$
begin
  alter table public.credit_ledger
    add constraint credit_ledger_sale_amount_nonnegative
    check (sale_amount_cents is null or sale_amount_cents >= 0);
exception when duplicate_object then null;
end $$;
