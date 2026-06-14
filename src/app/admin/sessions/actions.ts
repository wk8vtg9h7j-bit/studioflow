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
