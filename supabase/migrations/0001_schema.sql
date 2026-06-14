-- ============================================================================
-- StudioFlow — core schema
-- Pilates studio platform: bookings, multi-studio Google Calendar sync,
-- CRM, and instructor salary tracking driven by per-class attendance.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin', 'instructor', 'customer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_status as enum ('scheduled', 'cancelled', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  -- booked: holds a seat. waitlisted: queued. attended/no_show: post-class.
  create type booking_status as enum ('booked', 'waitlisted', 'cancelled', 'attended', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  -- How an instructor is paid for a class.
  --   flat              -> base_amount only
  --   per_head          -> per_head_amount * attendance
  --   base_plus_per_head-> base_amount + per_head_amount * attendance
  --   tiered            -> amount chosen from `tiers` jsonb by attendance bracket
  create type pay_model as enum ('flat', 'per_head', 'base_plus_per_head', 'tiered');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payroll_status as enum ('pending', 'instructor_confirmed', 'admin_approved', 'paid', 'disputed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type google_token_status as enum ('disconnected', 'connected', 'error');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Helper: updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null default 'customer',
  full_name   text,
  email       text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- Auto-create a profile row when a new auth user signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- studios  (each studio syncs to its OWN Google Calendar)
-- ----------------------------------------------------------------------------
create table if not exists studios (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null unique,
  address                text,
  timezone               text not null default 'Asia/Ho_Chi_Minh',
  brand_color            text default '#7c3aed',
  active                 boolean not null default true,
  -- Google Calendar integration (per studio)
  google_calendar_id     text,                         -- target calendar id
  google_refresh_token   text,                         -- encrypted at rest
  google_account_email   text,
  google_token_status    google_token_status not null default 'disconnected',
  google_last_synced_at  timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_studios_updated before update on studios
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- class_types  (e.g. Reformer, Mat, Tower, Prenatal)
-- ----------------------------------------------------------------------------
create table if not exists class_types (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  default_duration_min int not null default 50,
  default_capacity     int not null default 8,
  credits_cost         int not null default 1,   -- credits a customer spends to book
  color                text default '#8b5cf6',
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_class_types_updated before update on class_types
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- instructors  (instructor-specific profile data)
-- ----------------------------------------------------------------------------
create table if not exists instructors (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references profiles(id) on delete cascade,
  display_name text not null,
  bio         text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_instructors_updated before update on instructors
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- customers  (CRM record, 1:1 with a customer profile)
-- ----------------------------------------------------------------------------
create table if not exists customers (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null unique references profiles(id) on delete cascade,
  status            text not null default 'lead',     -- lead | active | inactive
  tags              text[] not null default '{}',
  notes             text,
  date_of_birth     date,
  emergency_contact text,
  marketing_opt_in  boolean not null default false,
  source            text,                             -- how they found us
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_customers_updated before update on customers
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- packages + credit ledger  (market-leader style class packs / memberships)
-- ----------------------------------------------------------------------------
create table if not exists packages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  credits       int not null,
  price_cents   int not null,
  currency      text not null default 'VND',
  validity_days int not null default 90,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Each row is a +/- movement of credits for a customer.
create table if not exists credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,
  delta         int not null,                          -- + purchase, - booking
  reason        text not null,                         -- purchase | booking | refund | adjustment
  package_id    uuid references packages(id),
  booking_id    uuid,                                  -- set on booking spends
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_credit_ledger_customer on credit_ledger(customer_id);

-- ----------------------------------------------------------------------------
-- pay_rules  (how much an instructor earns for a class)
-- Resolution: the most specific ACTIVE rule wins, ordered by `priority` desc.
-- Match on any combination of instructor_id / studio_id / class_type_id;
-- NULL means "applies to all".
-- ----------------------------------------------------------------------------
create table if not exists pay_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  model          pay_model not null default 'base_plus_per_head',
  base_amount    numeric(10,2) not null default 0,
  per_head_amount numeric(10,2) not null default 0,
  currency       text not null default 'VND',
  -- tiered model: [{ "min": 0, "max": 3, "amount": 25 }, { "min": 4, "amount": 35 }]
  tiers          jsonb not null default '[]',
  instructor_id  uuid references instructors(id) on delete cascade,
  studio_id      uuid references studios(id) on delete cascade,
  class_type_id  uuid references class_types(id) on delete cascade,
  priority       int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_pay_rules_updated before update on pay_rules
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- sessions  (a scheduled class instance)
-- ----------------------------------------------------------------------------
create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  studio_id       uuid not null references studios(id) on delete restrict,
  class_type_id   uuid not null references class_types(id) on delete restrict,
  instructor_id   uuid references instructors(id) on delete set null,
  title           text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  capacity        int not null default 8,
  status          session_status not null default 'scheduled',
  room            text,
  notes           text,
  google_event_id text,                                 -- id of the synced calendar event
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sessions_time_valid check (ends_at > starts_at)
);
create trigger trg_sessions_updated before update on sessions
  for each row execute function set_updated_at();
create index if not exists idx_sessions_studio_start on sessions(studio_id, starts_at);
create index if not exists idx_sessions_instructor on sessions(instructor_id, starts_at);

-- ----------------------------------------------------------------------------
-- bookings  (a customer's seat in a session)
-- ----------------------------------------------------------------------------
create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  customer_id   uuid not null references customers(id) on delete cascade,
  status        booking_status not null default 'booked',
  booked_at     timestamptz not null default now(),
  cancelled_at  timestamptz,
  checked_in_at timestamptz,
  credits_spent int not null default 0,
  source        text not null default 'web',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- a customer can only hold one active row per session
  unique (session_id, customer_id)
);
create trigger trg_bookings_updated before update on bookings
  for each row execute function set_updated_at();
create index if not exists idx_bookings_session on bookings(session_id);
create index if not exists idx_bookings_customer on bookings(customer_id);

-- ----------------------------------------------------------------------------
-- session_payroll  (the salary record per class, confirmed by the instructor)
-- One row per (session, instructor). attendance_count drives the amount.
-- ----------------------------------------------------------------------------
create table if not exists session_payroll (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references sessions(id) on delete cascade,
  instructor_id         uuid not null references instructors(id) on delete cascade,
  pay_rule_id           uuid references pay_rules(id) on delete set null,
  attendance_count      int not null default 0,        -- confirmed students in class
  computed_amount       numeric(10,2) not null default 0,
  currency              text not null default 'VND',
  status                payroll_status not null default 'pending',
  instructor_confirmed_at timestamptz,
  admin_approved_at     timestamptz,
  paid_at               timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (session_id, instructor_id)
);
create trigger trg_session_payroll_updated before update on session_payroll
  for each row execute function set_updated_at();
create index if not exists idx_payroll_instructor on session_payroll(instructor_id);
create index if not exists idx_payroll_status on session_payroll(status);

-- ----------------------------------------------------------------------------
-- google_sync_log  (audit of calendar pushes)
-- ----------------------------------------------------------------------------
create table if not exists google_sync_log (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid references studios(id) on delete cascade,
  session_id  uuid references sessions(id) on delete set null,
  action      text not null,                            -- create | update | delete | error
  ok          boolean not null default true,
  message     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sync_log_studio on google_sync_log(studio_id, created_at);
