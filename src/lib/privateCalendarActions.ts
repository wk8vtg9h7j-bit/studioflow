"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyInstructor } from "@/lib/instructorUpdates.server";

const TZ = "Asia/Ho_Chi_Minh";
function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}
function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T12:00:00Z")) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
}
function appointmentStart(form: FormData) {
  const day = field(form, "day");
  const hour = Number(field(form, "hour"));
  if (!validDay(day) || !Number.isInteger(hour) || hour < 7 || hour > 20)
    throw new Error("Choose a valid day and appointment time.");
  return fromZonedTime(day + "T" + String(hour).padStart(2, "0") + ":00:00", TZ).toISOString();
}
function target(form: FormData, teacher: boolean, result: string, message: string) {
  const day = field(form, "day");
  const studio = field(form, "studio_id");
  const instructor = field(form, "instructor_id");
  const params = new URLSearchParams();
  if (validDay(day)) params.set("day", day);
  if (/^[a-f0-9-]{36}$/i.test(studio)) params.set("studio", studio);
  if (!teacher && /^[a-f0-9-]{36}$/i.test(instructor)) params.set("instructor", instructor);
  params.set(result, message);
  return (teacher ? "/instructor/private" : "/private") + "?" + params.toString();
}
function refreshPrivate() {
  revalidatePath("/private");
  revalidatePath("/instructor/private");
  revalidatePath("/instructor");
  revalidatePath("/instructor/today");
  revalidatePath("/book");
  revalidatePath("/my-bookings");
}

export async function publishPrivateSlotAction(form: FormData) {
  await requireRole("instructor", "/instructor/private");
  let outcome: ["notice" | "error", string] = ["notice", "Time is now open for private bookings."];
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("private_publish_slot", {
      p_studio: field(form, "studio_id"), p_start: appointmentStart(form),
    });
    if (error) outcome = ["error", error.message];
    else refreshPrivate();
  } catch (error) {
    outcome = ["error", error instanceof Error ? error.message : "Could not open this time."];
  }
  redirect(target(form, true, ...outcome));
}

export async function closePrivateSlotAction(form: FormData) {
  await requireRole("instructor", "/instructor/private");
  const supabase = await createClient();
  const { error } = await supabase.rpc("private_close_slot", { p_slot: field(form, "slot_id") });
  if (!error) refreshPrivate();
  redirect(target(form, true, error ? "error" : "notice",
    error?.message || "Private time closed."));
}

export async function requestPrivateTimeAction(form: FormData) {
  await requireRole("customer", "/private");
  let message = "Request sent. The instructor can approve or decline it.";
  let result: "notice" | "error" = "notice";
  try {
    const supabase = await createClient();
    const instructorId = field(form, "instructor_id");
    const dateTime = appointmentStart(form);
    const { data, error } = await supabase.rpc("private_submit_request", {
      p_instructor: instructorId,
      p_studio: field(form, "studio_id"),
      p_start: dateTime,
      p_note: field(form, "note").slice(0, 301) || null,
    });
    if (error) {
      result = "error";
      message = error.message;
    } else {
      refreshPrivate();
      // A pending request is visible on the instructor dashboard even if
      // the device has notifications disabled.
      try {
        await notifyInstructor(
          instructorId,
          "Private class request",
          "A customer requested " +
          new Intl.DateTimeFormat("en-GB", {
            weekday: "short", day: "numeric", month: "short",
            hour: "2-digit", minute: "2-digit", timeZone: TZ,
          }).format(new Date(dateTime)) + ". Review your private calendar.",
          "/instructor/private?day=" + field(form, "day"),
          "private-request-" + data,
        );
      } catch {
        // Never cancel an otherwise successful request for push failures.
      }
    }
  } catch (error) {
    result = "error";
    message = error instanceof Error ? error.message : "Could not send request.";
  }
  redirect(target(form, false, result, message));
}

export async function respondPrivateRequestAction(form: FormData) {
  await requireRole("instructor", "/instructor/private");
  const response = field(form, "response");
  if (response !== "approve" && response !== "decline")
    redirect(target(form, true, "error", "Invalid response."));
  const supabase = await createClient();
  const { error } = await supabase.rpc("private_respond_request", {
    p_request: field(form, "request_id"), p_accept: response === "approve",
  });
  if (!error) refreshPrivate();
  redirect(target(form, true, error ? "error" : "notice",
    error?.message || (response === "approve"
      ? "Approved. This time is held for the customer until they confirm with a private credit."
      : "Request declined.")));
}

export async function cancelPrivateRequestAction(form: FormData) {
  await requireRole("customer", "/private");
  const supabase = await createClient();
  const { error } = await supabase.rpc("private_cancel_request", {
    p_request: field(form, "request_id"),
  });
  if (!error) refreshPrivate();
  redirect(target(form, false, error ? "error" : "notice",
    error?.message || "Request withdrawn."));
}

export async function bookPrivateSlotAction(form: FormData) {
  await requireRole("customer", "/private");
  const supabase = await createClient();
  const { error } = await supabase.rpc("private_book_slot", {
    p_slot: field(form, "slot_id"),
  });
  if (!error) refreshPrivate();
  redirect(target(form, false, error ? "error" : "notice",
    error?.message || "Private Pilates booked! Your private package credits have been used."));
}
