-- ============================================================================
-- StudioFlow — end-of-day class approval. After a class, the admin reviews the
-- roster (who attended / no-showed) and approves it. We stamp the approval time
-- on the session; a non-null value means the attendance is finalised.
-- ============================================================================
alter table sessions add column if not exists attendance_approved_at timestamptz;
