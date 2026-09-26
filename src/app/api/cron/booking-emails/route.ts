import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "@/lib/supabase/server";
import { createOAuthClient } from "@/lib/google/oauth";
import { decryptToken } from "@/lib/google/crypto";
import {
  configuredEmailProvider,
  escapeHtml,
  sendEmail,
} from "@/lib/email";

export const maxDuration = 60;

const BATCH_SIZE = 40;
const MAX_ATTEMPTS = 1000;

type QueueRow = {
  id: string;
  booking_id: string;
  booked_at: string;
  booking_status: "booked" | "waitlisted";
  spots_count: number;
  customer_sent_at: string | null;
  admin_sent_at: string | null;
  attempts: number;
};

type BookingRow = {
  id: string;
  customer: {
    name: string | null;
    email: string | null;
    profile: {
      full_name: string | null;
      email: string | null;
    } | null;
  } | null;
  session: {
    starts_at: string;
    ends_at: string;
    title: string | null;
    room: string | null;
    studio: {
      name: string;
      address: string | null;
      timezone: string | null;
      id: string;
      google_account_email: string | null;
      google_refresh_token: string | null;
      google_token_status: string | null;
    } | null;
    class_type: { name: string | null } | null;
    instructor: { display_name: string | null } | null;
  } | null;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();

  const { data: queueData, error: queueError } = await service
    .from("booking_email_notifications")
    .select(
      "id,booking_id,booked_at,booking_status,spots_count,customer_sent_at,admin_sent_at,attempts",
    )
    .or("customer_sent_at.is.null,admin_sent_at.is.null")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (queueError) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }

  const queue = (queueData ?? []) as QueueRow[];
  if (queue.length === 0) {
    return NextResponse.json({
      attempted: 0,
      customerEmailed: 0,
      adminEmailed: 0,
      failed: 0,
      remaining: 0,
    });
  }

  const provider = configuredEmailProvider();

  const bookingIds = Array.from(new Set(queue.map((row) => row.booking_id)));
  const { data: bookingData, error: bookingError } = await service
    .from("bookings")
    .select(
      `id,
       customer:customers (
         name,
         email,
         profile:profiles ( full_name, email )
       ),
       session:sessions (
         starts_at,
         ends_at,
         title,
         room,
         studio:studios (
           name,
           address,
           timezone,
           google_account_email,
           google_refresh_token,
           google_token_status
         ),
         class_type:class_types ( name ),
         instructor:instructors ( display_name )
       )`,
    )
    .in("id", bookingIds);

  if (bookingError) {
    return NextResponse.json({ error: bookingError.message }, { status: 500 });
  }

  const bookings = new Map(
    ((bookingData ?? []) as unknown as BookingRow[]).map((row) => [row.id, row]),
  );

  let customerEmailed = 0;
  let adminEmailed = 0;
  let failed = 0;

  for (const item of queue) {
    const booking = bookings.get(item.booking_id);
    const session = booking?.session;
    const customer = booking?.customer;
    const now = new Date().toISOString();
    const errors: string[] = [];

    if (!booking || !session) {
      await service
        .from("booking_email_notifications")
        .update({
          customer_sent_at: item.customer_sent_at ?? now,
          admin_sent_at: item.admin_sent_at ?? now,
          attempts: item.attempts + 1,
          last_error: "Booking or session no longer exists.",
        })
        .eq("id", item.id);
      failed += 1;
      continue;
    }

    const timezone = session.studio?.timezone || "Asia/Ho_Chi_Minh";
    const className =
      session.title?.trim() || session.class_type?.name?.trim() || "Pilates class";
    const customerName =
      customer?.profile?.full_name?.trim() ||
      customer?.name?.trim() ||
      "Guest";
    const customerEmail =
      customer?.profile?.email?.trim() || customer?.email?.trim() || null;
    const studioName = session.studio?.name ?? "Pilates studio";
    const studioAddress = session.studio?.address?.trim() || null;
    const instructor = session.instructor?.display_name?.trim() || null;
    const when = formatWhen(session.starts_at, timezone);
    const spots = Math.max(item.spots_count || 1, 1);
    const isWaitlist = item.booking_status === "waitlisted";

    let customerSentAt = item.customer_sent_at;
    let adminSentAt = item.admin_sent_at;

    if (!customerSentAt) {
      if (!customerEmail) {
        customerSentAt = now;
        errors.push("Customer has no email address.");
      } else {
        const customerMessage = customerEmailMessage({
          customerName,
          className,
          when,
          spots,
          studioName,
          studioAddress,
          instructor,
          isWaitlist,
        });
        const sent = provider
          ? await sendEmail(provider, {
              to: customerEmail,
              ...customerMessage,
            })
          : await sendViaStudioGmail(session.studio, {
              to: [customerEmail],
              ...customerMessage,
            });

        if (sent.ok) {
          customerSentAt = now;
          customerEmailed += 1;
        } else {
          errors.push(`Customer email: ${sent.error}`);
        }
      }
    }

    if (!adminSentAt) {
      const configuredAdmin = (process.env.BOOKING_NOTIFICATION_EMAIL ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const adminRecipients =
        configuredAdmin.length > 0
          ? configuredAdmin
          : session.studio?.google_account_email
            ? [session.studio.google_account_email]
            : [];

      if (adminRecipients.length === 0) {
        errors.push("Studio has no booking notification email.");
      } else {
        const adminMessage = adminEmailMessage({
          customerName,
          customerEmail,
          className,
          when,
          spots,
          studioName,
          instructor,
          isWaitlist,
          bookingId: item.booking_id,
        });
        const sent = provider
          ? await sendEmail(provider, {
              to: adminRecipients,
              ...adminMessage,
            })
          : await sendViaStudioGmail(session.studio, {
              to: adminRecipients,
              ...adminMessage,
            });

        if (sent.ok) {
          adminSentAt = now;
          adminEmailed += 1;
        } else {
          errors.push(`Admin email: ${sent.error}`);
        }
      }
    }

    if (errors.length > 0) failed += 1;

    await service
      .from("booking_email_notifications")
      .update({
        customer_sent_at: customerSentAt,
        admin_sent_at: adminSentAt,
        attempts: item.attempts + 1,
        last_error: errors.length > 0 ? errors.join(" | ").slice(0, 2000) : null,
      })
      .eq("id", item.id);
  }

  const { count: remaining } = await service
    .from("booking_email_notifications")
    .select("id", { count: "exact", head: true })
    .or("customer_sent_at.is.null,admin_sent_at.is.null")
    .lt("attempts", MAX_ATTEMPTS);

  return NextResponse.json({
    attempted: queue.length,
    customerEmailed,
    adminEmailed,
    failed,
    remaining: remaining ?? 0,
    delivery: provider ? provider.kind : "google-gmail",
  });
}

function customerEmailMessage(input: {
  customerName: string;
  className: string;
  when: string;
  spots: number;
  studioName: string;
  studioAddress: string | null;
  instructor: string | null;
  isWaitlist: boolean;
}) {
  const {
    customerName,
    className,
    when,
    spots,
    studioName,
    studioAddress,
    instructor,
    isWaitlist,
  } = input;

  const subject = isWaitlist
    ? `Waitlist confirmation: ${className}`
    : `Booking confirmed: ${className}`;

  const statusEn = isWaitlist
    ? "You are on the waitlist. No class credit has been used yet."
    : "Your booking is confirmed.";
  const statusVi = isWaitlist
    ? "Bạn đang trong danh sách chờ. Hiện tại chưa trừ lượt tập."
    : "Lịch tập của bạn đã được xác nhận.";

  const details = [
    className,
    when,
    `${spots} spot${spots === 1 ? "" : "s"}`,
    studioName,
    studioAddress,
    instructor ? `Instructor: ${instructor}` : null,
  ].filter(Boolean);

  const text = [
    `Hi ${customerName},`,
    "",
    statusEn,
    "",
    ...details,
    "",
    isWaitlist
      ? "If a spot opens and your booking is confirmed, you will receive another confirmation."
      : "We look forward to seeing you in class.",
    "",
    "— Pilates by Recharged",
    "",
    "-----",
    "",
    `Xin chào ${customerName},`,
    "",
    statusVi,
    "",
    ...details,
    "",
    isWaitlist
      ? "Nếu có chỗ trống và lịch được xác nhận, bạn sẽ nhận thêm email xác nhận."
      : "Hẹn gặp bạn tại lớp.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#292524;max-width:620px">
      <h2 style="margin-bottom:8px">${escapeHtml(isWaitlist ? "Waitlist confirmation" : "Booking confirmed")}</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>${escapeHtml(statusEn)}</p>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:16px;margin:18px 0">
        <strong>${escapeHtml(className)}</strong><br />
        ${escapeHtml(when)}<br />
        ${spots} spot${spots === 1 ? "" : "s"}<br />
        ${escapeHtml(studioName)}
        ${studioAddress ? `<br />${escapeHtml(studioAddress)}` : ""}
        ${instructor ? `<br />Instructor: ${escapeHtml(instructor)}` : ""}
      </div>
      <p>${escapeHtml(
        isWaitlist
          ? "If a spot opens and your booking is confirmed, you will receive another confirmation."
          : "We look forward to seeing you in class.",
      )}</p>
      <p>— Pilates by Recharged</p>
      <hr style="border:0;border-top:1px solid #e7e5e4;margin:24px 0" />
      <p>Xin chào ${escapeHtml(customerName)},</p>
      <p>${escapeHtml(statusVi)}</p>
      <p>${escapeHtml(isWaitlist ? "Nếu có chỗ trống và lịch được xác nhận, bạn sẽ nhận thêm email xác nhận." : "Hẹn gặp bạn tại lớp.")}</p>
    </div>
  `;

  return { subject, text, html };
}

function adminEmailMessage(input: {
  customerName: string;
  customerEmail: string | null;
  className: string;
  when: string;
  spots: number;
  studioName: string;
  instructor: string | null;
  isWaitlist: boolean;
  bookingId: string;
}) {
  const {
    customerName,
    customerEmail,
    className,
    when,
    spots,
    studioName,
    instructor,
    isWaitlist,
    bookingId,
  } = input;

  const status = isWaitlist ? "WAITLIST" : "BOOKED";
  const subject = `${isWaitlist ? "New waitlist" : "New booking"}: ${customerName} · ${className}`;
  const lines = [
    `${status}: ${customerName}`,
    customerEmail ? `Email: ${customerEmail}` : "Email: none",
    `Class: ${className}`,
    `When: ${when}`,
    `Studio: ${studioName}`,
    `Spots: ${spots}`,
    instructor ? `Instructor: ${instructor}` : null,
    `Booking ID: ${bookingId}`,
  ].filter(Boolean);

  const text = lines.join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#292524;max-width:620px">
      <h2>${escapeHtml(isWaitlist ? "New waitlist booking" : "New class booking")}</h2>
      <p><strong>${escapeHtml(customerName)}</strong></p>
      <p>
        ${customerEmail ? `Email: ${escapeHtml(customerEmail)}<br />` : ""}
        Class: ${escapeHtml(className)}<br />
        When: ${escapeHtml(when)}<br />
        Studio: ${escapeHtml(studioName)}<br />
        Spots: ${spots}
        ${instructor ? `<br />Instructor: ${escapeHtml(instructor)}` : ""}
      </p>
      <p style="font-size:12px;color:#78716c">Booking ID: ${escapeHtml(bookingId)}</p>
    </div>
  `;

  return { subject, text, html };
}

function formatWhen(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));
}


async function sendViaStudioGmail(
  studio:
    | {
        id: string;
        google_account_email: string | null;
        google_refresh_token: string | null;
        google_token_status: string | null;
      }
    | null,
  message: {
    to: string[];
    subject: string;
    text: string;
    html: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (
    !studio ||
    studio.google_token_status !== "connected" ||
    !studio.google_refresh_token
  ) {
    return {
      ok: false,
      error: "Studio Google account is not connected.",
    };
  }

  try {
    const client = createOAuthClient();
    client.setCredentials({
      refresh_token: decryptToken(studio.google_refresh_token),
    });

    const gmail = google.gmail({ version: "v1", auth: client });
    const from = studio.google_account_email || "info@rechargeddanang.com";
    const subject = `=?UTF-8?B?${Buffer.from(message.subject).toString("base64")}?=`;
    const raw = [
      `From: ${from}`,
      `To: ${message.to.join(", ")}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.html,
    ].join("\r\n");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: Buffer.from(raw)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, ""),
      },
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Google Gmail: ${error.message}`
          : "Google Gmail send failed",
    };
  }
}
