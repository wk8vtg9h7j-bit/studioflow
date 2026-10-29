-- Read-only regression checks after harden_booking_cancellation is applied.
-- No existing booking is called or modified.
do $$
begin
  if has_function_privilege('anon','public.cancel_booking(uuid)','execute') then
    raise exception 'Anonymous cancellation must be denied';
  end if;
  if not has_function_privilege('authenticated','public.cancel_booking(uuid)','execute') then
    raise exception 'Signed-in cancellation permission missing';
  end if;
  begin
    perform public.cancel_booking('00000000-0000-0000-0000-000000000000');
    raise exception 'Unauthenticated call unexpectedly passed';
  exception when raise_exception then
    if SQLERRM <> 'Authentication required' then raise; end if;
  end;
end $$;
