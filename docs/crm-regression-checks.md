# CRM regression checks

Run `npm ci --ignore-scripts`, `npm test` (Node 24), and `npm run typecheck`.
The GitHub Actions workflow runs these checks for pull requests and main pushes.

## Payment and booking coverage

The suite checks package exhaustion and one renewal reminder per customer/pool;
full-history consistency when opening a single class; reverse booking order;
cancellations and rebooking with the same booking ID; FIFO paid/manual provenance;
partial and repeated refunds; original refund expiry; multi-spot coverage;
separate customers and private/regular pools; explicit receipts and staff overrides;
pagination beyond 1,000 rows and customer batching; calendar refresh pagination;
and valid calendar dates including leap years.

It also checks 1,000 generated histories and replays 10,000 synthetic bookings.
These are deterministic regression and in-process volume checks, not concurrent
production load tests or a guarantee that the entire CRM is free of defects.

`tests/cancellation-guards.sql` verifies cancellation permissions and the
unauthenticated rejection path without calling any real booking. The migration
also enforces ownership with NULL-safe comparison and the same three-hour
customer cancellation window used by the application. Admin/service cancellation
and refund/waitlist behavior are retained.

## Payment meanings

- `package`: this class is covered. Renewal reminders do not turn it into debt.
- `payment_due`: this class lacks payment evidence or staff explicitly marked it due.
- `renewalDue`: the final scheduled covered class in a pool, with no unspent paid
  credits in that pool. The UI says `PAYMENT DUE · RENEWAL` and explains that the
  class is covered. Checkout and unpaid follow-ups do not collect for this label.
- `paymentReview`: a legacy record relying on the pre-12-October balance fallback.
  The UI says `PAYMENT HISTORY REVIEW`. Existing billing treatment is retained
  until staff verify actual payment evidence; no historical debt is automatically
  created. Explicit admin corrections take precedence.

Payment replay is read-only and does not rewrite receipts, credit balances,
commission, or revenue. It loads all related ledger/booking history with stable
pagination, independently of the selected class/day.

## Remaining verification and hardening

- Authenticated browser testing across admin, instructor and customer accounts
  is still needed; local build validation used placeholder credentials.
- True simultaneous booking, waitlist promotion, checkout and cancellation tests
  need an isolated database with test accounts, not live customer mutations.
- Renewal/calendar refresh on less common mutation paths (waitlist promotion,
  class-wide cancellation and instructor attendance reversal) needs broader
  integration coverage. Database booking triggers still queue their own sessions.
- The existing checkout SQL rejects mixed paid/unpaid multi-spot visits when any
  paid source is present; partial collection needs an explicit policy and tests.
- The production dependency audit reports advisories, including critical severity
  for the installed Next.js 14.2.15. The offered Next.js fix is a major upgrade;
  a framework migration and authentication regression pass remain necessary.
- Supabase advisors report additional function-execution/search-path warnings,
  disabled leaked-password protection, and performance suggestions. They require
  individual authorization review; this change does not relax RLS or grants to
  address them. See the [Supabase linter documentation](https://supabase.com/docs/guides/database/database-linter).
