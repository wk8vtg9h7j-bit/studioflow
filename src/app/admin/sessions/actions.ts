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
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/types";
import { syncSessionById } from "@/lib/google/sync";

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

export type SessionActionState = {
  error?: string;
  ok?: boolean;
  message?: string;
};

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

  const { data: created, error } = await supabase
    .from("sessions")
    .insert({
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
    })
    .select("id")
    .single();

  if (error || !created) {
    return { error: error?.message ?? "Could not create this class." };
  }

  const calendarSync = await syncSessionById(created.id);

  revalidatePath("/admin/sessions");
  return {
    ok: true,
    message: calendarSync.ok
      ? "Class created and synced to Google Calendar."
      : `Class created, but Google Calendar sync failed: ${calendarSync.message ?? "sync failed"}`,
  };
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

  const calendarSync = await syncSessionById(id);

  revalidatePath("/admin/sessions");
  return {
    ok: true,
    message: calendarSync.ok
      ? "Class updated in Google Calendar."
      : `Class updated, but Google Calendar sync failed: ${calendarSync.message ?? "sync failed"}`,
  };
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
  const { error } = await supabase.from("sessions").update({ status }).eq("id", id);
  if (error) return;

  await syncSessionById(id);
  revalidatePath("/admin/sessions");
}

// "Fill" a quiet class: reception holds the remaining seats so the class reads as
// full to customers and book_session refuses new bookings outright (no waitlist —
// there is no real seat to free up). Held seats are a counter on the session, never
// rows in bookings, so attendance, payroll and revenue are untouched. Passing 0
// releases the hold.
export async function setFillerSeatsAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const id = String(formData.get("id") ?? "");
  const seats = Number(formData.get("seats") ?? "");
  if (!id) return { error: "Missing session id." };
  if (!Number.isInteger(seats) || seats < 0) {
    return { error: "Invalid number of seats to hold." };
  }

  const supabase = await createClient();

  // Never hold more seats than the class has: the customer-side tally counts
  // held + booked as taken, so an oversized hold would only distort the numbers.
  const { data: row, error: readError } = await supabase
    .from("sessions")
    .select("capacity,starts_at")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { error: readError.message };
  if (!row) return { error: "That session could not be found." };

  const capacity = (row as { capacity: number }).capacity;
  const nextHeldSeats = Math.min(seats, capacity);
  const { error: updateError } = await supabase
    .from("sessions")
    .update({ filler_seats: nextHeldSeats })
    .eq("id", id);

  if (updateError) return { error: updateError.message };

  const calendarSync = await syncSessionById(id);

  revalidatePath("/admin/sessions");

  if (!calendarSync.ok) {
    return {
      ok: true,
      message:
        nextHeldSeats > 0
          ? `Class filled, but Google Calendar could not be updated: ${calendarSync.message ?? "sync failed"}`
          : `Class reopened, but Google Calendar could not be updated: ${calendarSync.message ?? "sync failed"}`,
    };
  }

  return {
    ok: true,
    message:
      nextHeldSeats > 0
        ? "Class filled and Google Calendar updated."
        : "Class reopened and Google Calendar updated.",
  };
}

// ----------------------------------------------------------------------------
// Admin booking for a private class.
//
// Creates a real booking for an existing customer and spends private credits.
// Admin authorization is checked before the service-role client is used.
// ----------------------------------------------------------------------------
export async function adminBookPrivateCustomerAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const sessionId = String(formData.get("session_id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  if (!sessionId) return { error: "Could not identify the private class." };
  if (!customerId) return { error: "Choose a customer." };

  const svc = createServiceClient();

  const { data: session, error: sessionError } = await svc
    .from("sessions")
    .select("id,status,starts_at,capacity,class_type_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) return { error: sessionError.message };
  if (!session) return { error: "That private class could not be found." };
  if (session.status !== "scheduled") {
    return { error: "This class is not open for booking." };
  }
  if (new Date(session.starts_at).getTime() <= Date.now()) {
    return { error: "This class has already started." };
  }

  const { data: classType, error: typeError } = await svc
    .from("class_types")
    .select("credits_cost,pool")
    .eq("id", session.class_type_id)
    .maybeSingle();

  if (typeError) return { error: typeError.message };
  if (!classType || classType.pool !== "private") {
    return { error: "Customers can only be assigned here for private classes." };
  }

  const { data: customer, error: customerError } = await svc
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) return { error: customerError.message };
  if (!customer) return { error: "That customer could not be found." };

  const { data: existing, error: existingError } = await svc
    .from("bookings")
    .select("id,status,booked_at,cancelled_at,credits_spent,source")
    .eq("session_id", sessionId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (existingError) return { error: existingError.message };
  if (existing && existing.status !== "cancelled") {
    return { error: "This customer is already booked into this class." };
  }

  const { data: occupiedRows, error: countError } = await svc
    .from("bookings")
    .select("spots_count")
    .eq("session_id", sessionId)
    .in("status", ["booked", "attended"]);

  if (countError) return { error: countError.message };
  const occupied = (occupiedRows ?? []).reduce(
    (sum, row) =>
      sum + ((row as { spots_count: number | null }).spots_count ?? 1),
    0,
  );
  if (occupied >= session.capacity) {
    return { error: "This private class is already full." };
  }

  const cost = classType.credits_cost ?? 1;
  const { data: balance, error: balanceError } = await svc.rpc(
    "credit_balance",
    {
      p_customer: customerId,
      p_pool: "private",
    },
  );

  if (balanceError) return { error: balanceError.message };
  const privateBalance = typeof balance === "number" ? balance : 0;

  if (privateBalance < cost) {
    return {
      error: `This customer needs ${cost} private credit${cost === 1 ? "" : "s"} but has ${privateBalance}.`,
    };
  }

  let bookingId = "";
  let createdNew = false;

  if (existing) {
    const { data: restored, error: restoreError } = await svc
      .from("bookings")
      .update({
        status: "booked",
        booked_at: new Date().toISOString(),
        cancelled_at: null,
        checked_in_at: null,
        credits_spent: cost,
        source: "admin",
      })
      .eq("id", existing.id)
      .select("id")
      .single();

    if (restoreError || !restored) {
      return { error: restoreError?.message ?? "Could not restore this booking." };
    }
    bookingId = restored.id;
  } else {
    const { data: created, error: createError } = await svc
      .from("bookings")
      .insert({
        session_id: sessionId,
        customer_id: customerId,
        status: "booked",
        credits_spent: cost,
        source: "admin",
      })
      .select("id")
      .single();

    if (createError || !created) {
      return { error: createError?.message ?? "Could not create this booking." };
    }
    bookingId = created.id;
    createdNew = true;
  }

  const { error: ledgerError } = await svc.from("credit_ledger").insert({
    customer_id: customerId,
    delta: -cost,
    reason: "booking",
    booking_id: bookingId,
    package_id: null,
    expires_at: null,
    pool: "private",
  });

  if (ledgerError) {
    if (createdNew) {
      await svc.from("bookings").delete().eq("id", bookingId);
    } else if (existing) {
      await svc
        .from("bookings")
        .update({
          status: existing.status,
          booked_at: existing.booked_at,
          cancelled_at: existing.cancelled_at,
          credits_spent: existing.credits_spent,
          source: existing.source,
        })
        .eq("id", bookingId);
    }
    return { error: ledgerError.message };
  }

  const calendarSync = await syncSessionById(sessionId);

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/notifications");
  revalidatePath("/book");
  revalidatePath("/my-bookings");

  return {
    ok: true,
    message: calendarSync.ok
      ? "Customer booked and Google Calendar updated."
      : `Customer booked, but Google Calendar sync failed: ${calendarSync.message ?? "sync failed"}`,
  };
}

// ----------------------------------------------------------------------------
// Admin booking for private sessions.
//
// Lets reception/admin place an existing customer directly into a private class.
// It uses the customer's private credit pool, refuses duplicates/full sessions,
// and records a normal booking + ledger spend so registers/accounting stay
// consistent with a customer-made booking.
// ----------------------------------------------------------------------------
const AdminPrivateBookingSchema = z.object({
  session_id: z.string().uuid("Could not identify the private session."),
  customer_id: z.string().uuid("Choose a customer."),
});

export async function bookCustomerIntoPrivateSessionAction(
  _prev: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  await requireRole("admin", "/admin/sessions");

  const parsed = AdminPrivateBookingSchema.safeParse({
    session_id: formData.get("session_id"),
    customer_id: formData.get("customer_id"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the booking." };
  }

  const { session_id, customer_id } = parsed.data;
  const svc = createServiceClient();

  const { data: session, error: sessionError } = await svc
    .from("sessions")
    .select(
      "id,capacity,status,starts_at,class_type:class_types(credits_cost,pool)",
    )
    .eq("id", session_id)
    .maybeSingle();

  if (sessionError) return { error: sessionError.message };
  if (!session) return { error: "That session could not be found." };

  const s = session as unknown as {
    capacity: number;
    status: string;
    starts_at: string;
    class_type: { credits_cost: number | null; pool: string | null } | null;
  };

  if (s.status !== "scheduled") {
    return { error: "Only scheduled sessions can be booked." };
  }
  if (s.class_type?.pool !== "private") {
    return { error: "This action is only available for private classes." };
  }
  if (new Date(s.starts_at).getTime() <= Date.now()) {
    return { error: "This private session has already started." };
  }

  const { data: customer, error: customerError } = await svc
    .from("customers")
    .select("id")
    .eq("id", customer_id)
    .maybeSingle();

  if (customerError) return { error: customerError.message };
  if (!customer) return { error: "That customer could not be found." };

  const { data: existing, error: existingError } = await svc
    .from("bookings")
    .select("id,status")
    .eq("session_id", session_id)
    .eq("customer_id", customer_id)
    .maybeSingle();

  if (existingError) return { error: existingError.message };
  if (existing && existing.status !== "cancelled") {
    return { error: "This customer is already booked into this class." };
  }

  const { count: occupied, error: countError } = await svc
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session_id)
    .in("status", ["booked", "attended"]);

  if (countError) return { error: countError.message };
  if ((occupied ?? 0) >= s.capacity) {
    return { error: "This private session is already full." };
  }

  const cost = s.class_type?.credits_cost ?? 1;
  const { data: balance, error: balanceError } = await svc.rpc(
    "credit_balance",
    {
      p_customer: customer_id,
      p_pool: "private",
    },
  );

  if (balanceError) return { error: balanceError.message };
  const privateBalance = typeof balance === "number" ? balance : 0;
  if (privateBalance < cost) {
    return {
      error: `Customer needs ${cost} private credit${cost === 1 ? "" : "s"} but has ${privateBalance}.`,
    };
  }

  const bookedAt = new Date().toISOString();
  let bookingId: string;
  let restoredCancelled = false;

  if (existing) {
    const { data: updated, error: updateError } = await svc
      .from("bookings")
      .update({
        status: "booked",
        credits_spent: cost,
        cancelled_at: null,
        checked_in_at: null,
        booked_at: bookedAt,
        source: "admin",
      })
      .eq("id", existing.id)
      .select("id")
      .single();

    if (updateError || !updated) {
      return { error: updateError?.message ?? "Could not restore booking." };
    }
    bookingId = updated.id;
    restoredCancelled = true;
  } else {
    const { data: created, error: createError } = await svc
      .from("bookings")
      .insert({
        session_id,
        customer_id,
        status: "booked",
        credits_spent: cost,
        source: "admin",
      })
      .select("id")
      .single();

    if (createError || !created) {
      return { error: createError?.message ?? "Could not create booking." };
    }
    bookingId = created.id;
  }

  const { error: ledgerError } = await svc.from("credit_ledger").insert({
    customer_id,
    delta: -cost,
    reason: "booking",
    package_id: null,
    booking_id: bookingId,
    pool: "private",
    expires_at: null,
  });

  if (ledgerError) {
    // Best-effort rollback so a failed credit spend never leaves a free booking.
    if (restoredCancelled) {
      await svc
        .from("bookings")
        .update({
          status: "cancelled",
          credits_spent: 0,
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", bookingId);
    } else {
      await svc.from("bookings").delete().eq("id", bookingId);
    }
    return { error: ledgerError.message };
  }

  await syncSessionById(session_id);

  revalidatePath("/admin/sessions");
  revalidatePath("/book");
  revalidatePath("/my-bookings");
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Class register — who actually turned up. Attendance is recorded per booking,
// and it feeds payroll: session_attendance() counts 'booked' and 'attended'
// heads, so marking someone a no-show removes a head and changes what the
// instructor is owed. Credits are never returned — a no-show still consumed the
// seat and the clip.
// ----------------------------------------------------------------------------

export type RegisterRow = {
  id: string;
  name: string;
  status: BookingStatus;
  credits_spent: number;
  spots_count: number;
};

export type RegisterData = {
  capacity: number;
  bookedCount: number;
  attendedCount: number;
  noShowCount: number;
  creditsUsed: number;
  canMarkAttendance: boolean;
  roster: RegisterRow[];
};

// Walk-ins created at reception carry a name on the customer row; members get
// theirs from the linked profile. Either can be missing, so fall back to a label
// rather than rendering an empty cell.
function resolveName(customer: unknown): string {
  const c = customer as
    | { name?: string | null; profile?: { full_name?: string | null } | null }
    | null;
  return c?.name || c?.profile?.full_name || "Member";
}

export async function getRegisterDataAction(
  sessionId: string,
): Promise<RegisterData> {
  await requireRole("admin", "/admin/sessions");
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("capacity,starts_at")
    .eq("id", sessionId)
    .maybeSingle();

  // A cancelled booking gave its seat back, so it is not part of the register.
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select(
      "id, status, credits_spent, spots_count, customer:customers(name, profile:profiles(full_name))",
    )
    .eq("session_id", sessionId)
    .neq("status", "cancelled")
    .order("booked_at", { ascending: true });

  const rows = (bookingRows ?? []) as unknown as {
    id: string;
    status: BookingStatus;
    credits_spent: number | null;
    spots_count: number | null;
    customer: unknown;
  }[];

  const roster: RegisterRow[] = rows.map((r) => ({
    id: r.id,
    name: resolveName(r.customer),
    status: r.status,
    credits_spent: r.credits_spent ?? 0,
    spots_count: r.spots_count ?? 1,
  }));

  const sessionInfo = session as
    | { capacity: number; starts_at: string }
    | null;

  return {
    capacity: sessionInfo?.capacity ?? 0,
    bookedCount: roster
      .filter((r) => r.status === "booked" || r.status === "attended")
      .reduce((sum, r) => sum + r.spots_count, 0),
    attendedCount: roster
      .filter((r) => r.status === "attended")
      .reduce((sum, r) => sum + r.spots_count, 0),
    noShowCount: roster
      .filter((r) => r.status === "no_show")
      .reduce((sum, r) => sum + r.spots_count, 0),
    creditsUsed: roster.reduce((sum, r) => sum + r.credits_spent, 0),
    canMarkAttendance: sessionInfo
      ? Date.parse(sessionInfo.starts_at) <= Date.now()
      : false,
    roster,
  };
}

// Change a roster row's attendance (booked / attended / no_show). Marking is
// reversible — passing 'booked' clears the mark — which matters because the
// cancel RPCs treat 'attended' and 'no_show' as terminal states.
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
    .select("session:sessions(id,starts_at)")
    .eq("id", bookingId)
    .maybeSingle();

  const row = booking as unknown as
    | { session: { id: string; starts_at: string } | null }
    | null;

  if (
    (status === "attended" || status === "no_show") &&
    row?.session &&
    Date.parse(row.session.starts_at) > Date.now()
  ) {
    return { error: "Attendance can only be marked once the class has started." };
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      status,
      // Only an attended booking has a real check-in moment; clearing the mark
      // clears the timestamp with it.
      checked_in_at: status === "attended" ? new Date().toISOString() : null,
    })
    .eq("id", bookingId);
  if (error) return { error: error.message };

  if (row?.session?.id) {
    await syncSessionById(row.session.id);
  }

  revalidatePath("/admin/sessions");
  return { ok: true };
}
