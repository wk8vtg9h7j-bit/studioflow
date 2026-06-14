# StudioFlow

A fully launchable Pilates studio management platform: **customer bookings**, **multi-studio Google Calendar sync**, a **CRM** for customer data, and **instructor salary tracking** with tiered pay by class attendance and a clip-card credit system.

Built with **Next.js (App Router)** + **Supabase (Postgres, Auth, RLS)**.

---

## Table of contents

1. [Features](#features)
2. [Roles & route map](#roles--route-map)
3. [How the core systems work](#how-the-core-systems-work)
4. [Tech stack](#tech-stack)
5. [Prerequisites](#prerequisites)
6. [Environment variables](#environment-variables)
7. [Database setup (migrations)](#database-setup-migrations)
8. [Seeding demo data](#seeding-demo-data)
9. [Google Calendar OAuth setup](#google-calendar-oauth-setup)
10. [Local development](#local-development)
11. [Production deployment](#production-deployment)
12. [Calendar sync cron](#calendar-sync-cron)
13. [Project scripts](#project-scripts)

---

## Features

- **Customer self-service booking** — browse upcoming sessions across studios, book with credits, and cancel (credits refunded).
- **CRM** — admin customer book with lifecycle status (lead / active / inactive), segmentation tags, internal notes, and a live credit balance per member.
- **Clip-card / credit packages** — sell credit packs to customers; credits are deducted per booking and refunded on cancellation. Credits expire after a configurable validity window.
- **Multi-studio Google Calendar sync** — each studio syncs its sessions to its own Google Calendar via OAuth.
- **Instructor portal** — instructors review and confirm their pay per session, with attendance logged after class.
- **Tiered salary engine** — admins define pay rules per studio / per instructor / per class type, including rates that vary by how many students attended (1, 2, 3, 4+). Rules resolve by specificity.
- **Admin console** — studios, class types, instructors, sessions, packages, customers, payroll, and pay rules.

---

## Roles & route map

The app has three roles. After login, users land on a role-appropriate home (`admin → /admin`, `instructor → /instructor`, `customer → /book`).

### Public / auth
- `/` — landing page
- `/login`, `/signup` — authentication (route group `(auth)`)
- `/dashboard` — post-login router

### Admin (`/admin/*`)
- `/admin` — overview
- `/admin/sessions` — schedule classes
- `/admin/studios` — studios (each with its own Google Calendar + timezone)
- `/admin/class-types` — class catalogue
- `/admin/instructors` — instructor records
- `/admin/customers` — CRM (status, tags, notes, credit balance, grant packages)
- `/admin/packages` — credit packs / memberships
- `/admin/payroll` — review & recalculate session pay
- `/admin/pay-rules` — tiered pay rules per studio / instructor / class type

### Instructor (`/instructor/*`)
- `/instructor` — portal home
- `/instructor/salary` — confirm pay per session based on logged attendance

### Customer (route group `(customer)`)
- `/book` — browse & book sessions
- `/my-bookings` — upcoming bookings + cancel

### API route handlers
- `GET /api/google/connect` — starts the Google OAuth flow for calendar sync
- `GET /api/google/callback` — OAuth redirect handler; stores the encrypted refresh token
- `POST /api/cron/sync-google` — `CRON_SECRET`-guarded endpoint that syncs each studio's sessions to its calendar

---

## How the core systems work

### Salary engine (tiered pay rules)

Pay is computed per session by `compute_pay`, using the most specific matching rule resolved by `resolve_pay_rule`. Rules support four models:

- **flat** — fixed amount per class
- **per_head** — amount × number of attendees
- **base_plus_per_head** — base + (per-head × attendees)
- **tiered** — amount chosen by attendance bracket, e.g. 1–2 students = £25, 3–5 = £40, 6+ = £55

Rules carry a `priority` and may be scoped to a `class_type_id`, `instructor_id`, or both — so an admin can set, for example, a studio-wide Reformer rate and override it for a specific instructor. Attendance is logged after class; instructors then confirm their pay on `/instructor/salary` via `confirm_payroll(p_payroll_id, p_attendance)`.

### Clip-card / credit system

Credits live in a single append-only ledger (`credit_ledger`) of signed deltas per customer:

- **Granting a package** writes one positive row (`delta = package.credits`, reason `purchase`, with an `expires_at` of `now() + validity_days`). Done from the CRM via the **Grant a clip-card** control on each customer.
- **Booking** (`book_session`) writes a negative delta for the class's credit cost.
- **Cancelling** (`cancel_booking`) refunds the credits.
- **Live balance** (`credit_balance`) sums non-expired deltas.

All credit writes are admin/RPC-gated by row-level security.

---

## Tech stack

- **Next.js 14.2** (App Router, Server Actions, Route Handlers) + **TypeScript 5.6**
- **Tailwind CSS 3.4**
- **Supabase** — Postgres, Auth, Row-Level Security, security-definer functions/RPCs (`@supabase/ssr`, `@supabase/supabase-js`)
- **googleapis** — Google Calendar sync
- **date-fns** / **date-fns-tz** — timezone-aware scheduling
- **zod** — server-action input validation
- **node:crypto** (AES-256-GCM) — encrypts stored Google refresh tokens

---

## Prerequisites

- **Node.js 18+** and npm
- A **Supabase** project (or the Supabase CLI for local development)
- A **Google Cloud** project with the Calendar API enabled (only needed for calendar sync)

---

## Environment variables

Copy the template and fill in the values:

```bash
cp .env.example .env.local
```

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Full public URL of the app (used for OAuth redirects + emails). Local: `http://localhost:3000` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (Project Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — **server only, never expose to the client.** Used by admin actions + calendar sync |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (Web) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Must equal `{NEXT_PUBLIC_APP_URL}/api/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | 32+ char secret to encrypt stored Google refresh tokens. Generate: `openssl rand -base64 32` |
| `CRON_SECRET` | Secret authorizing the calendar sync cron endpoint. Generate: `openssl rand -hex 32` |

---

## Database setup (migrations)

Three ordered migrations build the schema, security policies, and payroll engine:

- `supabase/migrations/0001_schema.sql` — tables (studios, class types, packages, instructors, customers, sessions, bookings, credit ledger, pay rules, payroll)
- `supabase/migrations/0002_functions_rls.sql` — helper RPCs (`book_session`, `cancel_booking`, `credit_balance`, `ensure_customer`, role helpers) + Row-Level Security
- `supabase/migrations/0003_payroll.sql` — salary engine (`resolve_pay_rule`, `compute_pay`, `session_attendance`, `recalc_payroll`, `confirm_payroll`)

Apply them to your linked project:

```bash
npm run db:push      # supabase db push
```

To wipe and rebuild a local database from scratch:

```bash
npm run db:reset     # supabase db reset
```

---

## Seeding demo data

`supabase/seed.sql` populates two demo studios, four class types, four packages, pay rules (one of each model), and sample upcoming sessions. Because Supabase Auth owns user creation, seeding is a two-step process:

1. **Create the demo auth users** in the Supabase dashboard (Auth → Users → Add user), each with the listed role metadata:

   | Email | Metadata |
   | --- | --- |
   | `admin@studioflow.test` | `{ "role": "admin", "full_name": "Aria Admin" }` |
   | `instructor@studioflow.test` | `{ "role": "instructor", "full_name": "Iris Instructor" }` |
   | `instructor2@studioflow.test` | `{ "role": "instructor", "full_name": "Noah Instructor" }` |
   | `customer@studioflow.test` | `{ "role": "customer", "full_name": "Cleo Customer" }` |

2. **Run the seed.** The `LINK DEMO ACCOUNTS` block at the bottom of `seed.sql` is idempotent — it links those users to instructor/customer records, sets roles, grants the demo customer 10 credits, and creates instructor-specific pay rules. Run the whole file via the Supabase SQL editor, or include it in `supabase db reset` (which runs `seed.sql` automatically).

---

## Google Calendar OAuth setup

1. In **Google Cloud Console → APIs & Services**, enable the **Google Calendar API**.
2. Create an **OAuth client ID** of type **Web application**.
3. Add the authorized redirect URI: `{NEXT_PUBLIC_APP_URL}/api/google/callback` (e.g. `http://localhost:3000/api/google/callback` for local dev).
4. Put the client ID/secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and set `GOOGLE_OAUTH_REDIRECT_URI` to the same redirect URI.
5. From the admin studio settings, connect each studio's calendar via the OAuth flow (`/api/google/connect`). The refresh token is encrypted with `TOKEN_ENCRYPTION_KEY` before storage.

---

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

Quality checks:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
```

---

## Production deployment

Recommended: **Vercel** (app) + **Supabase** (database/auth).

1. Create/point at your production Supabase project and apply migrations (`npm run db:push`).
2. Deploy the Next.js app to Vercel.
3. Set **all** environment variables from the table above in the Vercel project settings. Use the production app URL for `NEXT_PUBLIC_APP_URL` and update `GOOGLE_OAUTH_REDIRECT_URI` (and the Google Cloud authorized redirect URI) accordingly.
4. Keep `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, and `CRON_SECRET` as server-side secrets only.
5. Configure the calendar sync cron (below).

---

## Calendar sync cron

`POST /api/cron/sync-google` pushes each studio's sessions to its connected Google Calendar. The endpoint requires the `CRON_SECRET` (sent as a bearer/authorization header) so it can't be triggered anonymously.

On Vercel, schedule it with `vercel.json`, for example:

```json
{
  "crons": [
    { "path": "/api/cron/sync-google", "schedule": "*/15 * * * *" }
  ]
}
```

Any external scheduler works too, as long as it presents the `CRON_SECRET`.

---

## Project scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `npm run dev` | `next dev` | Start the dev server |
| `npm run build` | `next build` | Production build |
| `npm run start` | `next start` | Run the production build |
| `npm run lint` | `next lint` | Lint |
| `npm run typecheck` | `tsc --noEmit` | Type-check |
| `npm run db:push` | `supabase db push` | Apply migrations to the linked project |
| `npm run db:reset` | `supabase db reset` | Rebuild the local DB + run seed |
