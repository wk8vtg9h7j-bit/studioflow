// ============================================================================
// A single row in the member's "My bookings" list. Presentational: it shows the
// class title, when/where it runs, the member's status (booked/waitlisted/etc),
// and — for upcoming bookings the member still holds — a cancel button wired to
// cancelBookingAction. Past or already-cancelled bookings show no action.
// ============================================================================
import type { Session, Studio, ClassType, Instructor } from "@/lib/types";
import type { Dict } from "@/lib/i18n";
import { formatSessionWhen } from "@/lib/format";
import { CancelBookingForm } from "./CancelBookingForm";

// Cancelling this close to the start forfeits the credit (migration 0012), so
// the member gets a confirm dialog spelling that out before the action runs.
const REFUND_WINDOW_MS = 3 * 60 * 60 * 1000;

// The joined shape we read on the my-bookings page: a booking with its session
// and that session's studio / class type / instructor. There's no shared
// BookingWithRelations type, so we describe exactly what the query selects.
export type BookingWithSession = {
  id: string;
  status: "booked" | "waitlisted" | "cancelled" | "attended" | "no_show";
  credits_spent: number | null;
  session:
    | (Session & {
        studio: Pick<
          Studio,
          "id" | "name" | "slug" | "brand_color" | "timezone"
        > | null;
        class_type: Pick<
          ClassType,
          "id" | "name" | "color" | "credits_cost"
        > | null;
        instructor: Pick<Instructor, "id" | "display_name"> | null;
      })
    | null;
};

const STATUS_BADGE: Record<BookingWithSession["status"], string> = {
  booked: "bg-emerald-50 text-emerald-700",
  waitlisted: "bg-amber-50 text-amber-700",
  cancelled: "bg-rose-50 text-rose-700",
  attended: "bg-sky-50 text-sky-700",
  no_show: "bg-zinc-100 text-zinc-600",
};

// Status labels are locale-dependent, so they're built from the dictionary
// inside the component rather than held in a module-level constant.
const statusLabels = (
  dict: Dict,
): Record<BookingWithSession["status"], string> => ({
  booked: dict.booking_status_booked,
  waitlisted: dict.booking_status_waitlisted,
  cancelled: dict.booking_status_cancelled,
  attended: dict.booking_status_attended,
  no_show: dict.booking_status_no_show,
});

export function BookingRow({
  booking,
  cancellable,
  dict,
}: {
  booking: BookingWithSession;
  cancellable: boolean;
  dict: Dict;
}) {
  const session = booking.session;
  const accent = session?.class_type?.color ?? "#7c3aed";
  const tz = session?.studio?.timezone;
  const title =
    session?.title || session?.class_type?.name || dict.session_fallback;

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <span
          className="h-10 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">{title}</p>
            <span className={`badge ${STATUS_BADGE[booking.status]}`}>
              {statusLabels(dict)[booking.status]}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-muted">
            {session
              ? formatSessionWhen(session.starts_at, tz)
              : dict.booking_class_removed}
            {session?.studio?.name ? ` · ${session.studio.name}` : ""}
            {session?.instructor?.display_name
              ? ` · ${session.instructor.display_name}`
              : ""}
          </p>
        </div>

        <div className="w-32 shrink-0">
          {cancellable ? (
            <CancelBookingForm
              bookingId={booking.id}
              warnNoRefund={
                (booking.credits_spent ?? 0) > 0 &&
                !!session &&
                Date.parse(session.starts_at) < Date.now() + REFUND_WINDOW_MS
              }
              dict={dict}
            />
          ) : (
            <p className="text-center text-xs text-ink-muted">—</p>
          )}
        </div>
      </div>
    </li>
  );
}
