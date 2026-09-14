// ============================================================================
// StudioFlow — shared TypeScript types mirroring the Postgres schema.
// ============================================================================

export type UserRole = "admin" | "instructor" | "customer";
export type SessionStatus = "scheduled" | "cancelled" | "completed";
export type BookingStatus =
  | "booked"
  | "waitlisted"
  | "cancelled"
  | "attended"
  | "no_show";
export type PayModel = "flat" | "per_head" | "base_plus_per_head" | "tiered";
export type PayrollStatus =
  | "pending"
  | "instructor_confirmed"
  | "admin_approved"
  | "paid"
  | "disputed";
export type GoogleTokenStatus = "disconnected" | "connected" | "error";
export type CreditPool = "regular" | "private";

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Studio {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  timezone: string;
  brand_color: string | null;
  active: boolean;
  google_calendar_id: string | null;
  google_refresh_token: string | null;
  google_account_email: string | null;
  google_token_status: GoogleTokenStatus;
  google_last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassType {
  id: string;
  name: string;
  description: string | null;
  default_duration_min: number;
  default_capacity: number;
  credits_cost: number;
  color: string | null;
  pool: CreditPool;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Instructor {
  id: string;
  profile_id: string;
  display_name: string;
  bio: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  profile_id: string;
  status: string;
  tags: string[];
  notes: string | null;
  date_of_birth: string | null;
  emergency_contact: string | null;
  marketing_opt_in: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface Package {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  price_cents: number;
  currency: string;
  validity_days: number;
  pool: CreditPool;
  active: boolean;
  created_at: string;
}

export interface CreditLedgerEntry {
  id: string;
  customer_id: string;
  delta: number;
  reason: string;
  package_id: string | null;
  booking_id: string | null;
  pool: CreditPool;
  expires_at: string | null;
  payment_method: string | null;
  created_at: string;
}

export interface PayTier {
  min: number;
  max?: number;
  amount: number;
}

export interface PayRule {
  id: string;
  name: string;
  model: PayModel;
  base_amount: number;
  per_head_amount: number;
  currency: string;
  tiers: PayTier[];
  instructor_id: string | null;
  studio_id: string | null;
  class_type_id: string | null;
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  studio_id: string;
  class_type_id: string;
  instructor_id: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: SessionStatus;
  room: string | null;
  notes: string | null;
  google_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  session_id: string;
  customer_id: string;
  status: BookingStatus;
  booked_at: string;
  cancelled_at: string | null;
  checked_in_at: string | null;
  credits_spent: number;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface SessionPayroll {
  id: string;
  session_id: string;
  instructor_id: string;
  pay_rule_id: string | null;
  attendance_count: number;
  computed_amount: number;
  currency: string;
  status: PayrollStatus;
  instructor_confirmed_at: string | null;
  admin_approved_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleSyncLogEntry {
  id: string;
  studio_id: string | null;
  session_id: string | null;
  action: string;
  ok: boolean;
  message: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------------
// Convenience joined shapes returned by list queries.
// ----------------------------------------------------------------------------
export interface SessionWithRelations extends Session {
  studio?: Pick<Studio, "id" | "name" | "slug" | "brand_color" | "timezone">;
  class_type?: Pick<
    ClassType,
    "id" | "name" | "description" | "color" | "credits_cost" | "pool"
  >;
  instructor?: Pick<Instructor, "id" | "display_name"> | null;
}
