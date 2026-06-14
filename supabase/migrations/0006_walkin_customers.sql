-- ============================================================================
-- StudioFlow — walk-in customers (manual add from admin).
--
-- Previously a customer always had to be tied to a profile/auth login. Reception
-- needs to add walk-ins who pay in studio without an account, and optionally
-- attach a login later. So profile_id becomes optional, and we store basic
-- contact details directly on the customer for the no-login case. When a profile
-- exists it remains the source of truth for name/email/phone.
-- ============================================================================
alter table customers alter column profile_id drop not null;

alter table customers add column if not exists name  text;
alter table customers add column if not exists email text;
alter table customers add column if not exists phone text;
