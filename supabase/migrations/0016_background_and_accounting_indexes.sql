create index if not exists idx_sessions_google_sync_pending
  on public.sessions (google_sync_pending_at)
  where google_sync_pending_at is not null;

create index if not exists idx_credit_ledger_purchase_created
  on public.credit_ledger (created_at desc)
  where reason = 'purchase';

create index if not exists idx_session_payroll_created
  on public.session_payroll (created_at desc);

create index if not exists idx_session_payroll_status
  on public.session_payroll (status);
