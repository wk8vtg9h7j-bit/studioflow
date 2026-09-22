// ============================================================================
// Admin · Notifications
//
// A feed of recent bookings and cancellations. Events newer than the admin's
// last visit are flagged "New"; opening this page stamps the feed as seen (via
// MarkSeen) so the header bell clears.
// ============================================================================
import { cookies } from "next/headers";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole } from "@/lib/auth";
import {
  getNotificationEvents,
  countNewSince,
  NOTIF_SEEN_COOKIE,
} from "./data";
import { MarkSeen } from "./MarkSeen";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireRole("admin", "/admin/notifications");

  const seenISO = cookies().get(NOTIF_SEEN_COOKIE)?.value ?? null;
  const events = await getNotificationEvents();
  const newCount = countNewSince(events, seenISO);

  return (
    <div className="space-y-8">
      {/* Stamp as seen after render so "New" reflects the previous visit. */}
      <MarkSeen />

      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Bookings and cancellations across your studios.{" "}
          {newCount > 0
            ? `${newCount} new since your last visit.`
            : "You're all caught up."}
        </p>
      </header>

      {events.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-ink-muted">
          No booking activity in the last 30 days.
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => {
            const isNew = !seenISO || e.atISO > seenISO;
            const cancelled = e.type === "cancelled";
            return (
              <li key={e.id} className="card flex items-center gap-4 px-5 py-4">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm ${
                    cancelled
                      ? "bg-rose-50 text-rose-600"
                      : "bg-emerald-50 text-emerald-600"
                  }`}
                  aria-hidden
                >
                  {cancelled ? "\u2212" : "+"}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink">
                      {e.customer}
                    </p>
                    <span
                      className={`badge ${
                        cancelled
                          ? "bg-rose-50 text-rose-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {cancelled ? "Cancelled" : "Booked"}
                    </span>
                    {isNew && (
                      <span className="badge bg-brand-50 text-brand-700">
                        New
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-ink-muted">
                    {e.klass}
                    {e.studio ? ` · ${e.studio}` : ""}
                    {e.whenISO
                      ? ` · ${formatInTimeZone(new Date(e.whenISO), e.timezone, "EEE d MMM, h:mm a")}`
                      : ""}
                  </p>
                </div>

                <p className="shrink-0 text-right text-xs text-ink-soft">
                  {formatInTimeZone(
                    new Date(e.atISO),
                    e.timezone,
                    "d MMM, h:mm a",
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
