-- ============================================================================
-- StudioFlow — per-attendee "Customer Type" on the class register, mirroring the
-- studio's paper/spreadsheet tracker: New vs Existing × single vs package.
-- Reception sets it per booking from the register roster. NULL = not set.
-- ============================================================================
alter table bookings add column if not exists customer_type text;

do $$ begin
  alter table bookings
    add constraint bookings_customer_type_chk
    check (
      customer_type is null
      or customer_type in (
        'new_single', 'new_package', 'existing_single', 'existing_package'
      )
    );
exception when duplicate_object then null; end $$;
