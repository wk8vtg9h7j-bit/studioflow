import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  sendStudioFlowPush,
  webPushConfigured,
  webPushErrorMessage,
  webPushStatusCode,
} from "@/lib/webPush";

export const maxDuration = 60;

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 12;

function globalBookingRecipientIds(): string[] {
  return (process.env.BOOKING_PUSH_GLOBAL_INSTRUCTOR_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

type QueueRow = {
  id: string;
  booking_id: string;
  booked_at: string;
  instructor_push_attempts: number;
};

type BookingRow = {
  id: string;
  spots_count: number | null;
  customer: {
    name: string | null;
    email: string | null;
    profile: {
      full_name: string | null;
      email: string | null;
    } | null;
  } | null;
  session: {
    id: string;
    status: string;
    starts_at: string;
    capacity: number;
    title: string | null;
    instructor_id: string | null;
    studio: {
      name: string;
      timezone: string | null;
    } | null;
    class_type: {
      name: string | null;
    } | null;
  } | null;
};

type SubscriptionRow = {
  id: string;
  instructor_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
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

  if (!webPushConfigured()) {
    return NextResponse.json(
      { error: "VAPID keys are not configured" },
      { status: 500 },
    );
  }

  const service = createServiceClient();

  const { data: queueData, error: queueError } = await service
    .from("booking_email_notifications")
    .select("id,booking_id,booked_at,instructor_push_attempts")
    .eq("booking_status", "booked")
    .is("instructor_push_sent_at", null)
    .lt("instructor_push_attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (queueError) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }

  const queue = (queueData ?? []) as QueueRow[];
  if (queue.length === 0) {
    return NextResponse.json({
      attempted: 0,
      pushed: 0,
      devices: 0,
      failed: 0,
      remaining: 0,
    });
  }

  const bookingIds = Array.from(new Set(queue.map((row) => row.booking_id)));

  const { data: bookingData, error: bookingError } = await service
    .from("bookings")
    .select(
      `id,
       spots_count,
       customer:customers (
         name,
         email,
         profile:profiles ( full_name, email )
       ),
       session:sessions (
         id,
         status,
         starts_at,
         capacity,
         title,
         instructor_id,
         studio:studios ( name, timezone ),
         class_type:class_types ( name )
       )`,
    )
    .in("id", bookingIds);

  if (bookingError) {
    return NextResponse.json({ error: bookingError.message }, { status: 500 });
  }

  const bookings = new Map(
    ((bookingData ?? []) as unknown as BookingRow[]).map((row) => [row.id, row]),
  );

  const globalRecipientIds = globalBookingRecipientIds();
  const instructorIds = Array.from(
    new Set([
      ...Array.from(bookings.values())
        .map((booking) => booking.session?.instructor_id)
        .filter((value): value is string => Boolean(value)),
      ...globalRecipientIds,
    ]),
  );

  const sessionIds = Array.from(
    new Set(
      Array.from(bookings.values())
        .map((booking) => booking.session?.id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const subscriptionsByInstructor = new Map<string, SubscriptionRow[]>();
  if (instructorIds.length > 0) {
    const { data: subscriptionData, error: subscriptionError } = await service
      .from("instructor_push_subscriptions")
      .select("id,instructor_id,endpoint,p256dh,auth")
      .in("instructor_id", instructorIds);

    if (subscriptionError) {
      return NextResponse.json(
        { error: subscriptionError.message },
        { status: 500 },
      );
    }

    for (const subscription of (subscriptionData ?? []) as SubscriptionRow[]) {
      const list = subscriptionsByInstructor.get(subscription.instructor_id) ?? [];
      list.push(subscription);
      subscriptionsByInstructor.set(subscription.instructor_id, list);
    }
  }

  const occupiedBySession = new Map<string, number>();
  if (sessionIds.length > 0) {
    const { data: seatData, error: seatError } = await service
      .from("bookings")
      .select("session_id,spots_count")
      .in("session_id", sessionIds)
      .in("status", ["booked", "attended"]);

    if (seatError) {
      return NextResponse.json({ error: seatError.message }, { status: 500 });
    }

    for (const seat of seatData ?? []) {
      const sessionId = String(seat.session_id);
      occupiedBySession.set(
        sessionId,
        (occupiedBySession.get(sessionId) ?? 0) +
          Math.max(Number(seat.spots_count ?? 1), 1),
      );
    }
  }

  let pushed = 0;
  let devices = 0;
  let failed = 0;

  for (const item of queue) {
    const booking = bookings.get(item.booking_id);
    const session = booking?.session;
    const now = new Date().toISOString();
    const nextAttempts = item.instructor_push_attempts + 1;

    if (!booking || !session) {
      await markHandled(
        service,
        item.id,
        now,
        nextAttempts,
        "Booking or session no longer exists.",
      );
      failed += 1;
      continue;
    }

    if (session.status === "cancelled") {
      await markHandled(
        service,
        item.id,
        now,
        nextAttempts,
        "Session was cancelled before push delivery.",
      );
      continue;
    }

    const recipientIds = Array.from(
      new Set(
        [session.instructor_id, ...globalRecipientIds].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );

    const subscriptions = Array.from(
      new Map(
        recipientIds
          .flatMap(
            (instructorId) =>
              subscriptionsByInstructor.get(instructorId) ?? [],
          )
          .map((subscription) => [subscription.endpoint, subscription]),
      ).values(),
    );

    if (subscriptions.length === 0) {
      await markHandled(
        service,
        item.id,
        now,
        nextAttempts,
        recipientIds.length === 0
          ? "No instructor recipient is configured for this booking."
          : "No booking-notification recipient has a push-enabled device.",
      );
      continue;
    }

    const customerName =
      booking.customer?.profile?.full_name?.trim() ||
      booking.customer?.name?.trim() ||
      "A customer";
    const className =
      session.title?.trim() ||
      session.class_type?.name?.trim() ||
      "Pilates class";
    const studioName = session.studio?.name?.trim() || "Pilates";
    const studioShort = studioName.split(" - ")[0] || studioName;
    const timezone = session.studio?.timezone || "Asia/Ho_Chi_Minh";
    const when = formatWhen(session.starts_at, timezone);
    const spots = Math.max(booking.spots_count ?? 1, 1);
    const occupied = occupiedBySession.get(session.id) ?? spots;

    const payload = {
      title: `New booking — ${studioShort}`,
      body: `${customerName} booked ${spots > 1 ? `${spots} spots · ` : ""}${className}\n${when} · ${occupied}/${session.capacity} booked`,
      url: "/instructor",
      tag: `booking-${booking.id}-${item.booked_at}`,
    };

    let successfulDevices = 0;
    let staleDevices = 0;
    const transientErrors: string[] = [];

    for (const subscription of subscriptions) {
      try {
        await sendStudioFlowPush(
          {
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
          payload,
        );
        successfulDevices += 1;
        devices += 1;
      } catch (pushError) {
        const statusCode = webPushStatusCode(pushError);

        if (statusCode === 404 || statusCode === 410) {
          staleDevices += 1;
          await service
            .from("instructor_push_subscriptions")
            .delete()
            .eq("id", subscription.id);
          continue;
        }

        transientErrors.push(webPushErrorMessage(pushError));
      }
    }

    if (successfulDevices > 0 || staleDevices === subscriptions.length) {
      await markHandled(
        service,
        item.id,
        now,
        nextAttempts,
        transientErrors.length > 0
          ? `Some devices failed: ${transientErrors.join(" | ").slice(0, 1800)}`
          : staleDevices > 0 && successfulDevices === 0
            ? "All saved push subscriptions had expired."
            : null,
      );
      if (successfulDevices > 0) pushed += 1;
      continue;
    }

    failed += 1;
    await service
      .from("booking_email_notifications")
      .update({
        instructor_push_attempts: nextAttempts,
        instructor_push_last_error: transientErrors
          .join(" | ")
          .slice(0, 2000),
      })
      .eq("id", item.id);
  }

  const { count: remaining } = await service
    .from("booking_email_notifications")
    .select("id", { count: "exact", head: true })
    .eq("booking_status", "booked")
    .is("instructor_push_sent_at", null)
    .lt("instructor_push_attempts", MAX_ATTEMPTS);

  return NextResponse.json({
    attempted: queue.length,
    pushed,
    devices,
    failed,
    remaining: remaining ?? 0,
  });
}

async function markHandled(
  service: ReturnType<typeof createServiceClient>,
  id: string,
  sentAt: string,
  attempts: number,
  error: string | null,
) {
  await service
    .from("booking_email_notifications")
    .update({
      instructor_push_sent_at: sentAt,
      instructor_push_attempts: attempts,
      instructor_push_last_error: error,
    })
    .eq("id", id);
}

function formatWhen(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));
}
