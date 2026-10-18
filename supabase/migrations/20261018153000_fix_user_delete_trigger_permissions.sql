-- Auth user deletion cascades through customer bookings. The booking sync
-- trigger must be able to flag affected sessions even when invoked by
-- Supabase Auth's restricted database role.
CREATE OR REPLACE FUNCTION public.mark_google_sync_pending_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_session_id uuid;
BEGIN
  v_session_id := COALESCE(NEW.session_id, OLD.session_id);
  UPDATE public.sessions
  SET google_sync_pending_at = now()
  WHERE id = v_session_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_google_sync_pending_from_booking() FROM PUBLIC, anon, authenticated;
