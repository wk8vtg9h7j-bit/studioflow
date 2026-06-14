-- ============================================================================
-- StudioFlow — record how a package was paid for (reception/admin sale).
--
-- Packages are sold at the studio (QR transfer, card, or cash). We record the
-- method on the purchase ledger row so the daily Payments report can break the
-- day's takings down by method. NULL = method not recorded (e.g. legacy rows or
-- the auto starter credit).
-- ============================================================================
alter table credit_ledger
  add column if not exists payment_method text;

do $$ begin
  alter table credit_ledger
    add constraint credit_ledger_payment_method_chk
    check (payment_method is null or payment_method in ('qr', 'card', 'cash'));
exception when duplicate_object then null; end $$;
