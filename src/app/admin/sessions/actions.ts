// ============================================================================
// Server actions for the Sessions section. A session is one scheduled class on
// the calendar: it pins a class type to a studio at a wall-clock time, with an
// optional instructor, room and capacity override. Customers book against it.
//
// Time handling is the subtle part. The form sends a *studio-local* wall-clock
// value from an <input type="datetime-local"> (no zone). We look up the studio's
// IANA timezone, convert that wall-clock to a real UTC instant with
// fromZonedTime, and store starts_at/ends_at as UTC timestamptz — so a 9:00 AM
// Sydney class is the same instant no matter where it's read.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SessionSchema = z.object({
  studio_id: z.string().uuid("Pick a studio"),
  class_type_id: z.string().uuid("Pick a class type"),
  // An empty <select> value means "no instructor assigned yet".
  instructor_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("")),
  title: z.string().trim().max(160).optional().or(z.literal("")),
  // "yyyy-MM-dd'T'HH:mm" from the datetime-local input — validated loosely here
  // and turned into a real instant below once we know the studio's zone.
  starts_at: z
    .string()
    .trim()
    .min(1, "Pick a date and time")
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Pick a valid date and time"),
  duration_min: z.coerce
    .number()
    .int()
    .min(5, "Too short")
    .max(480, "Too long"),
  capacity: z.coerce.number().int().min(1, "At least 1").max(200),
  room: z.string().trim().max(80).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type SessionActionState = { error?: string; ok?: boolean };

function parseForm(formData: FormData) {
  return SessionSchema.safeParse({
    studio_id: formData.get("studio_id"),
    class_type_id: formData.get("class_type_id"),
    instructor_id: formData.get("instructor_id"),
    title: formData.get("title"),
    starts_at: formData.get("starts_at"),
    duration_min: formData.get("duration_min"),
    capacity: formData.get("capacity"),
    room: formData.get("room"),
    notes: formData.get("notes"),
  });
}

// Convert a studio-local wall-clock string + duration into a pair of UTC ISO
// instants, using the studio's IANA timezone. Returns null if the zone lookup
// fails (e.g. the studio was deleted between page load and submit).
async function resolveInstants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studioId: string,
  startsAtLocal: string,
  durationMin: number,
): Promise<{ starts_at: string; ends_at: string } | { error: string }> {
  const { data: studio, error } = await supabase
    .from("studios")
    .select("timezone")
    .eq("id", studioId)
    .single();

  if (error || !studio) {
    return { error: "That studio could not be found." };
  }

  const tz = studio.timezone || "UTC";
  let start: Date;
  try {
    // fromZonedTime reads the wall-clock value *as if* it were in `tz` and
    // returns the matching UTC instant.
    start = fromZonedTime(startsAtLocal, tz);
  } catch {
    return { error: "Could not interpret that date in the studio's timezone." };
  }

  if (Number.isNaN(start.getTime())) {
    return { error: "Pick a valid date and time." };
  }

  const end = new Date(start.getTime() + durationMin * 60_000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

export async function createSessionAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const {
    studio_id,
    class_type_id,
    instructor_id,
    title,
    starts_at,
    duration_min,
    capacity,
    room,
    notes,
  } = parsed.data;

  const supabase = await createClient();
  const instants = await resolveInstants(
    supabase,
    studio_id,
    starts_at,
    duration_min,
  );
  if ("error" in instants) return { error: instants.error };

  const { error } = await supabase.from("sessions").insert({
    studio_id,
    class_type_id,
    instructor_id: instructor_id || null,
    title: title || null,
    starts_at: instants.starts_at,
    ends_at: instants.ends_at,
    capacity,
    status: "scheduled",
    room: room || null,
    notes: notes || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/sessions");
  return { ok: true };
}

export async function updateSessionAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing session id" };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const {
    studio_id,
    class_type_id,
    instructor_id,
    title,
    starts_at,
    duration_min,
    capacity,
    room,
    notes,
  } = parsed.data;

  const supabase = await createClient();
  const instants = await resolveInstants(
    supabase,
    studio_id,
    starts_at,
    duration_min,
  );
  if ("error" in instants) return { error: instants.error };

  const { error } = await supabase
    .from("sessions")
    .update({
      studio_id,
      class_type_id,
      instructor_id: instructor_id || null,
      title: title || null,
      starts_at: instants.starts_at,
      ends_at: instants.ends_at,
      capacity,
      room: room || null,
      notes: notes || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/sessions");
  return { ok: true };
}

// Sessions are referenced by bookings and payroll, so we never hard-delete from
// this screen. Cancelling flips status to 'cancelled' (hidden from booking but
// kept for history); restoring puts it back to 'scheduled'.
export async function setSessionStatusAction(formData: FormData) {
  await requireRole("admin", "/admin/sessions");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) return;
  if (status !== "scheduled" && status !== "cancelled") return;

  const supabase = await createClient();
  await supabase.from("sessions").update({ status }).eq("id", id);
  revalidatePath("/admin/sessions");
}

// ============================================================================
// Register (reception check-in) actions.
//
// The RegisterPanel on a session's detail page is the paper-register equivalent:
// it shows the roster, lets reception check members in (deducting a credit from
// the class type's pool), take door payments for walk-ins, mark attendance, tag
// each attendee's customer-type, and approve the class at end of day. All
// admin-guarded; all pool-aware (regular vs private) via the class type's pool.
// ============================================================================

export type RegisterCustomer = {
  id: string;
  name: string;
  phone?: string | null;
  credits: number;
};

export type RegisterData = {
  capacity: number;
  bookedCount: number;
  attendedCount: number;
  noShowCount: number;
  creditsUsed: number;
  classCost: number;
  pool: "regular" | "private";
  approvedAt: string | null;
  roster: Array<{
    id: string;
    name: string;
    status: "booked" | "attended" | "no_show" | "waitlisted";
    customerType?:
      | "new_single"
      | "new_package"
      | "existing_single"
      | "existing_package"
      | null;
  }>;
  packages: Array<{
    id: string;
    name: string;
    credits: number;
    price_cents: number;
    currency: string;
  }>;
};

// A booking row's customer name lives either on the walk-in customer record
// (customers.name) or, for members with a login, on their profile
// (profiles.full_name). This resolves whichever is present.
function resolveName(customer: unknown): string {
  const c = customer as
    | { name?: string | null; profile?: { full_name?: string | null } | null }
    | null;
  return c?.name || c?.profile?.full_name || "Member";
}

// Load everything the register needs for one session: capacity, live counts,
// the roster, the class cost/pool, and the packages sellable at the door.
export async function getRegisterDataAction(
  sessionId: string,
): Promise<RegisterData> {
  await requireRole("admin", "/admin/sessions");
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("capacity, class_type_id, attendance_approved_at")
    .eq("id", sessionId)
    .single();

  const capacity = session?.capacity ?? 0;

  const { data: classType } = await supabase
    .from("class_types")
    .select("credits_cost, pool")
    .eq("id", session?.class_type_id ?? "")
    .single();

  const classCost = classType?.credits_cost ?? 1;
  const pool: "regular" | "private" =
    classType?.pool === "private" ? "private" : "regular";

  const { data: bookingRows } = await supabase
    .from("bookings")
    .select(
      "id, status, customer_type, credits_spent, customer:customers(name, profile:profiles(full_name))",
    )
    .eq("session_id", sessionId)
    .neq("status", "cancelled")
    .order("booked_at", { ascending: true });

  const rows = bookingRows ?? [];

  let bookedCount = 0;
  let attendedCount = 0;
  let noShowCount = 0;
  let creditsUsed = 0;

  const roster = rows.map((r) => {
    const status = r.status as
      | "booked"
      | "attended"
      | "no_show"
      | "waitlisted";
    if (status === "booked" || status === "attended") bookedCount += 1;
    if (status === "attended") attendedCount += 1;
    if (status === "no_show") noShowCount += 1;
    creditsUsed += r.credits_spent ?? 0;
    return {
      id: r.id as string,
      name: resolveName(r.customer),
      status,
      customerType: (r.customer_type ?? null) as
        | "new_single"
        | "new_package"
        | "existing_single"
        | "existing_package"
        | null,
    };
  });

  const { data: packageRows } = await supabase
    .from("packages")
    .select("id, name, credits, price_cents, currency")
    .eq("active", true)
    .eq("pool", pool)
    .order("price_cents", { ascending: true });

  return {
    capacity,
    bookedCount,
    attendedCount,
    noShowCount,
    creditsUsed,
    classCost,
    pool,
    approvedAt: (session?.attendance_approved_at ?? null) as string | null,
    roster,
    packages: (packageRows ?? []) as RegisterData["packages"],
  };
}

// Search members by name or phone for the register's "find member" box. Matches
// walk-in records (customers.name/phone) and login members (profiles.full_name),
// returning each with their non-expired balance in the requested pool.
export async function searchRegisterCustomersAction(
  query: string,
  pool: "regular" | "private" = "regular",
): Promise<RegisterCustomer[]> {
  await requireRole("admin", "/admin/sessions");
  const q = query.trim();
  if (!q) return [];

  const supabase = await createClient();
  const like = `%${q}%`;
  const found = new Map<
    string,
    { id: string; name: string; phone: string | null }
  >();

  // Walk-in / on-record customers matched by name or phone.
  const { data: byCustomer } = await supabase
    .from("customers")
    .select("id, name, phone, profile:profiles(full_name)")
    .or(`name.ilike.${like},phone.ilike.${like}`)
    .limit(10);

  for (const c of byCustomer ?? []) {
    found.set(c.id as string, {
      id: c.id as string,
      name: resolveName(c),
      phone: (c.phone ?? null) as string | null,
    });
  }

  // Login members whose display name lives on their profile.
  const { data: byProfile } = await supabase
    .from("profiles")
    .select("full_name, customers:customers(id, name, phone)")
    .ilike("full_name", like)
    .limit(10);

  for (const p of byProfile ?? []) {
    const linked = (p.customers ?? []) as Array<{
      id: string;
      name: string | null;
      phone: string | null;
    }>;
    for (const c of linked) {
      if (found.has(c.id)) continue;
      found.set(c.id, {
        id: c.id,
        name: c.name || (p.full_name as string) || "Member",
        phone: c.phone ?? null,
      });
    }
  }

  const list = Array.from(found.values()).slice(0, 10);

  // Attach the pool balance for each match.
  const withCredits = await Promise.all(
    list.map(async (c) => {
      const { data: bal } = await supabase.rpc("credit_balance", {
        p_customer: c.id,
        p_pool: pool,
      });
      return { ...c, credits: (bal as number) ?? 0 };
    }),
  );

  return withCredits;
}

// Shared: load a session's class cost + pool, guarding against a missing/closed
// session. Returns an error string when the class is approved (locked).
async function loadSessionCost(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
): Promise<
  | {
      capacity: number;
      classCost: number;
      pool: "regular" | "private";
      approved: boolean;
    }
  | { error: string }
> {
  const { data: session, error } = await supabase
    .from("sessions")
    .select("capacity, class_type_id, attendance_approved_at, status")
    .eq("id", sessionId)
    .single();
  if (error || !session) return { error: "That class could not be found." };

  const { data: classType } = await supabase
    .from("class_types")
    .select("credits_cost, pool")
    .eq("id", session.class_type_id)
    .single();

  return {
    capacity: session.capacity ?? 0,
    classCost: classType?.credits_cost ?? 1,
    pool: classType?.pool === "private" ? "private" : "regular",
    approved: !!session.attendance_approved_at,
  };
}

// Check in an existing member: verify balance and capacity, mark them attended,
// deduct a credit from the class type's pool.
export async function registerExistingAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const sessionId = String(formData.get("session_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  if (!sessionId || !customerId) return { error: "Missing session or customer." };

  const supabase = await createClient();
  const info = await loadSessionCost(supabase, sessionId);
  if ("error" in info) return { error: info.error };
  if (info.approved) {
    return { error: "This class is approved. Reopen it to make changes." };
  }

  // Already on the roster?
  const { data: existing } = await supabase
    .from("bookings")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (existing && existing.status !== "cancelled") {
    return { error: "That member is already on the register." };
  }

  // Enough credits in the right pool?
  const { data: bal } = await supabase.rpc("credit_balance", {
    p_customer: customerId,
    p_pool: info.pool,
  });
  const balance = (bal as number) ?? 0;
  if (balance < info.classCost) {
    return {
      error: `Not enough ${info.pool === "private" ? "private " : ""}credits (need ${info.classCost}, have ${balance}).`,
    };
  }

  // Capacity (booked + attended count toward the seat count).
  const { count: seatCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .in("status", ["booked", "attended"]);
  if (info.capacity > 0 && (seatCount ?? 0) >= info.capacity) {
    return { error: "This class is full." };
  }

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .upsert(
      {
        session_id: sessionId,
        customer_id: customerId,
        status: "attended",
        credits_spent: info.classCost,
        checked_in_at: new Date().toISOString(),
        cancelled_at: null,
        booked_at: new Date().toISOString(),
      },
      { onConflict: "session_id,customer_id" },
    )
    .select("id")
    .single();
  if (bookErr || !booking) {
    return { error: bookErr?.message ?? "Could not check that member in." };
  }

  const { error: ledgerErr } = await supabase.from("credit_ledger").insert({
    customer_id: customerId,
    delta: -info.classCost,
    reason: "booking",
    booking_id: booking.id,
    pool: info.pool,
  });
  if (ledgerErr) return { error: ledgerErr.message };

  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  return { ok: true };
}

// Take a door payment for a brand-new walk-in: create the customer record and
// add balance (a single class credit or a package) to the class type's pool.
// This does not check them in — reception then finds them and checks in.
const WalkInRegisterSchema = z.object({
  session_id: z.string().uuid("Missing class."),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  plan: z.string().trim().min(1, "Pick a plan."),
  payment_method: z.enum(["qr", "card", "cash"], {
    errorMap: () => ({ message: "Pick a payment method." }),
  }),
});

export async function registerWalkInAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const parsed = WalkInRegisterSchema.safeParse({
    session_id: formData.get("session_id"),
    name: formData.get("name"),
    plan: formData.get("plan"),
    payment_method: formData.get("payment_method"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const { session_id, name, plan, payment_method } = parsed.data;

  const supabase = await createClient();
  const info = await loadSessionCost(supabase, session_id);
  if ("error" in info) return { error: info.error };

  // Create the walk-in customer (no login).
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .insert({ name, status: "active", source: "walk-in" })
    .select("id")
    .single();
  if (custErr || !customer) {
    return { error: custErr?.message ?? "Could not add the customer." };
  }

  if (plan === "single") {
    // A single drop-in: grant exactly the class cost in the session's pool.
    const { error } = await supabase.from("credit_ledger").insert({
      customer_id: customer.id,
      delta: info.classCost,
      reason: "purchase",
      package_id: null,
      booking_id: null,
      expires_at: null,
      payment_method,
      pool: info.pool,
    });
    if (error) return { error: error.message };
  } else {
    // A package: look it up, grant its credits with the package's validity/pool.
    const { data: pkg, error: pkgErr } = await supabase
      .from("packages")
      .select("credits, validity_days, active, pool")
      .eq("id", plan)
      .single();
    if (pkgErr || !pkg) return { error: "That package could not be found." };
    if (!pkg.active) return { error: "That package is no longer available." };

    const expiresAt = new Date(
      Date.now() + pkg.validity_days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error } = await supabase.from("credit_ledger").insert({
      customer_id: customer.id,
      delta: pkg.credits,
      reason: "purchase",
      package_id: plan,
      booking_id: null,
      expires_at: expiresAt,
      payment_method,
      pool: pkg.pool === "private" ? "private" : "regular",
    });
    if (error) return { error: error.message };
  }

  revalidatePath(`/admin/sessions/${session_id}`);
  return { ok: true };
}

// Change a roster row's attendance (booked / attended / no_show). Credits are
// left as spent — a no-show still consumed the seat and the clip.
export async function setBookingStatusAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const bookingId = String(formData.get("booking_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!bookingId) return { error: "Missing booking." };
  if (!["booked", "attended", "no_show"].includes(status)) {
    return { error: "Invalid status." };
  }

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("session_id")
    .eq("id", bookingId)
    .single();

  const { error } = await supabase
    .from("bookings")
    .update({
      status,
      checked_in_at:
        status === "attended" ? new Date().toISOString() : null,
    })
    .eq("id", bookingId);
  if (error) return { error: error.message };

  if (booking?.session_id) {
    revalidatePath(`/admin/sessions/${booking.session_id}`);
  }
  return { ok: true };
}

// Tag a roster row's customer-type (new/existing × single/package), mirroring
// the studio's paper tracker. Empty clears it.
export async function setBookingCustomerTypeAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const bookingId = String(formData.get("booking_id") ?? "");
  const raw = String(formData.get("customer_type") ?? "");
  if (!bookingId) return { error: "Missing booking." };

  const allowed = [
    "new_single",
    "new_package",
    "existing_single",
    "existing_package",
  ];
  const value = raw && allowed.includes(raw) ? raw : null;

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("session_id")
    .eq("id", bookingId)
    .single();

  const { error } = await supabase
    .from("bookings")
    .update({ customer_type: value })
    .eq("id", bookingId);
  if (error) return { error: error.message };

  if (booking?.session_id) {
    revalidatePath(`/admin/sessions/${booking.session_id}`);
  }
  return { ok: true };
}

// Approve (finalise) or reopen a class's attendance. Approving stamps
// attendance_approved_at, which locks the register UI.
export async function setClassApprovalAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const sessionId = String(formData.get("session_id") ?? "");
  const approved = String(formData.get("approved") ?? "") === "true";
  if (!sessionId) return { error: "Missing class." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sessions")
    .update({
      attendance_approved_at: approved ? new Date().toISOString() : null,
    })
    .eq("id", sessionId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Schedule a private (1:1) class: create the session assigned to the instructor,
// reserve the customer's seat (deducting one private credit), and record the
// instructor's pay for them to confirm on their Salary page.
// ----------------------------------------------------------------------------
const PrivateClassSchema = z.object({
  customer_id: z.string().uuid("Pick a customer."),
  studio_id: z.string().uuid("Pick a studio."),
  class_type_id: z.string().uuid("Pick a private class type."),
  instructor_id: z.string().uuid("Pick an instructor."),
  starts_at: z
    .string()
    .trim()
    .min(1, "Pick a date and time.")
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Pick a valid date and time."),
  duration_min: z.coerce.number().int().min(5, "Too short").max(480, "Too long"),
  instructor_pay: z.coerce
    .number()
    .int()
    .min(0, "Pay can't be negative")
    .max(100_000_000, "Too large"),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function schedulePrivateClassAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions/new");

  const parsed = PrivateClassSchema.safeParse({
    customer_id: formData.get("customer_id"),
    studio_id: formData.get("studio_id"),
    class_type_id: formData.get("class_type_id"),
    instructor_id: formData.get("instructor_id"),
    starts_at: formData.get("starts_at"),
    duration_min: formData.get("duration_min"),
    instructor_pay: formData.get("instructor_pay"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const {
    customer_id,
    studio_id,
    class_type_id,
    instructor_id,
    starts_at,
    duration_min,
    instructor_pay,
    notes,
  } = parsed.data;

  const supabase = await createClient();

  // Cost + pool for the chosen private class type.
  const { data: classType } = await supabase
    .from("class_types")
    .select("credits_cost, pool")
    .eq("id", class_type_id)
    .single();
  const classCost = classType?.credits_cost ?? 1;
  const pool: "regular" | "private" =
    classType?.pool === "private" ? "private" : "regular";

  // The customer needs a credit in that pool to hold the seat.
  const { data: bal } = await supabase.rpc("credit_balance", {
    p_customer: customer_id,
    p_pool: pool,
  });
  const balance = (bal as number) ?? 0;
  if (balance < classCost) {
    return {
      error: `Customer needs ${classCost} ${pool === "private" ? "private " : ""}credit${classCost === 1 ? "" : "s"} (has ${balance}). Add a package to them first.`,
    };
  }

  const instants = await resolveInstants(
    supabase,
    studio_id,
    starts_at,
    duration_min,
  );
  if ("error" in instants) return { error: instants.error };

  // Create the session, assigned to the instructor (capacity 1 = private).
  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .insert({
      studio_id,
      class_type_id,
      instructor_id,
      title: null,
      starts_at: instants.starts_at,
      ends_at: instants.ends_at,
      capacity: 1,
      status: "scheduled",
      notes: notes || null,
    })
    .select("id")
    .single();
  if (sessErr || !session) {
    return { error: sessErr?.message ?? "Could not create the class." };
  }

  // Reserve the customer's seat and deduct their private credit.
  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      session_id: session.id,
      customer_id,
      status: "booked",
      credits_spent: classCost,
      source: "web",
    })
    .select("id")
    .single();
  if (bookErr || !booking) {
    return { error: bookErr?.message ?? "Could not reserve the seat." };
  }

  const { error: ledgerErr } = await supabase.from("credit_ledger").insert({
    customer_id,
    delta: -classCost,
    reason: "booking",
    booking_id: booking.id,
    pool,
  });
  if (ledgerErr) return { error: ledgerErr.message };

  // Record the instructor's pay for this class, pending their confirmation.
  const { error: payErr } = await supabase.from("session_payroll").insert({
    session_id: session.id,
    instructor_id,
    pay_rule_id: null,
    attendance_count: 1,
    computed_amount: instructor_pay,
    currency: "VND",
    status: "pending",
    notes: notes || null,
  });
  if (payErr) return { error: payErr.message };

  revalidatePath("/admin/sessions");
  revalidatePath("/instructor");
  return { ok: true };
}
