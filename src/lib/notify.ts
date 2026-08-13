// ============================================================================
// Booking notifications — emails all admins and the class's instructor when a
// booking is made. Uses Resend (transactional email).
//
// Safe by design: if RESEND_API_KEY isn't configured it silently no-ops, and any
// send failure is swallowed, so a notification problem can never block or break
// a booking. Add RESEND_API_KEY (and optionally NOTIFY_FROM_EMAIL) to switch it on.
// ============================================================================
import { formatInTimeZone } from "date-fns-tz";
import { createServiceClient } from "@/lib/supabase/server";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type BookingEvent = "booked" | "waitlisted" | "cancelled";

export async function notifyBookingMade(
  sessionId: string,
  opts?: { customerName?: string; waitlisted?: boolean },
): Promise<void> {
  return notifyBooking(
    sessionId,
    opts?.waitlisted ? "waitlisted" : "booked",
    opts?.customerName,
  );
}

export async function notifyBookingCancelled(
  sessionId: string,
  opts?: { customerName?: string },
): Promise<void> {
  return notifyBooking(sessionId, "cancelled", opts?.customerName);
}

// Shared implementation for all booking-lifecycle emails. Fire-and-forget:
// no-ops without RESEND_API_KEY and swallows every error so a notification
// problem can never block or break a booking or cancellation.
async function notifyBooking(
  sessionId: string,
  event: BookingEvent,
  customerName?: string,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // not configured → skip

  const from =
    process.env.NOTIFY_FROM_EMAIL ||
    "Pilates by Recharged <onboarding@resend.dev>";

  try {
    const svc = createServiceClient();

    const { data: sessionRow } = await svc
      .from("sessions")
      .select(
        "title, starts_at, studio:studios(name, timezone), class_type:class_types(name), instructor:instructors(profile:profiles(email))",
      )
      .eq("id", sessionId)
      .single();

    const s = sessionRow as unknown as {
      title: string | null;
      starts_at: string | null;
      studio: { name: string | null; timezone: string | null } | null;
      class_type: { name: string | null } | null;
      instructor: { profile: { email: string | null } | null } | null;
    } | null;

    const className = s?.title ?? s?.class_type?.name ?? "Class";
    const studioName = s?.studio?.name ?? "";
    const tz = s?.studio?.timezone ?? "Asia/Ho_Chi_Minh";
    const when = s?.starts_at
      ? formatInTimeZone(new Date(s.starts_at), tz, "EEE d MMM, h:mm a")
      : "";
    const instructorEmail = s?.instructor?.profile?.email ?? null;

    const { data: adminRows } = await svc
      .from("profiles")
      .select("email")
      .eq("role", "admin");
    const adminEmails = ((adminRows ?? []) as { email: string | null }[])
      .map((a) => a.email)
      .filter((e): e is string => Boolean(e));

    const to = Array.from(
      new Set([...adminEmails, instructorEmail].filter(Boolean)),
    ) as string[];
    if (to.length === 0) return;

    const who = customerName ?? "A customer";
    const verb =
      event === "cancelled"
        ? "cancelled their booking for"
        : event === "waitlisted"
          ? "joined the waitlist for"
          : "booked";
    const label = event === "cancelled" ? "Cancellation" : "New booking";
    const subject = `${label} — ${className}${when ? ` · ${when}` : ""}${
      studioName ? ` · ${studioName}` : ""
    }`;
    const footer =
      event === "cancelled"
        ? "Pilates by Recharged · automated cancellation alert"
        : "Pilates by Recharged · automated booking alert";
    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#1c1917;line-height:1.5">
      <p style="margin:0 0 12px"><strong>${escapeHtml(who)}</strong> ${verb} a class.</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:2px 14px 2px 0;color:#78716c">Class</td><td>${escapeHtml(className)}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#78716c">When</td><td>${escapeHtml(when)}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#78716c">Studio</td><td>${escapeHtml(studioName)}</td></tr>
      </table>
      <p style="margin:16px 0 0;color:#a8a29e;font-size:12px">${escapeHtml(footer)}</p>
    </div>`;

    await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
  } catch {
    // Never let a notification failure affect the booking.
  }
}

// ----------------------------------------------------------------------------
// Password reset — the studio's Supabase project has no custom SMTP, so
// resetPasswordForEmail never delivers. We mint the recovery link with the
// service role and send it through Resend instead. Returns false when the mail
// couldn't be sent so the caller can tell the user rather than silently failing.
// ----------------------------------------------------------------------------
export async function notifyPasswordReset(
  to: string,
  link: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const from =
    process.env.NOTIFY_FROM_EMAIL ||
    "Pilates by Recharged <onboarding@resend.dev>";

  const html = `
    <p>Hi,</p>
    <p>Use the link below to set a new password. It expires shortly, so open it soon.</p>
    <p><a href="${escapeHtml(link)}">Set a new password</a></p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Reset your password",
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
