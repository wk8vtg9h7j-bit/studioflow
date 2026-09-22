// ============================================================================
// A single row in the member's "My bookings" list. Presentational: it shows the
// class title, when/where it runs, the member's status (booked/waitlisted/etc),
// and — for upcoming bookings the member still holds — a cancel button wired to
// cancelBookingAction. Past or already-cancelled bookings show no action.
// ============================================================================
import type { Session, Studio, ClassType, Instructor } from "@/lib/types";
import { formatSessionWhen } from "@/lib/format";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { cancelBookingAction } from "./actions";

// The joined shape we read on the my-bookings page: a booking with its session
// and that session's studio / class type / instructor. There's no shared
// BookingWithRelations type, so we describe exactly what the query selects.
export type BookingWithSession = {
  id: string;
  status: "booked" | "waitlisted" | "cancelled" | "attended" | "no_show";
  credits_spent: number | null;
  spots_count: number | null;
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

const STATUS_LABEL: Record<BookingWithSession["status"], string> = {
  booked: "Booked",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
  attended: "Attended",
  no_show: "No show",
};

export function BookingRow({
  booking,
  cancellable,
  locked = false,
}: {
  booking: BookingWithSession;
  cancellable: boolean;
  // Upcoming and still held, but inside the three-hour window — the cancel
  // button is gone and we say why instead of showing a bare dash.
  locked?: boolean;
}) {
  const session = booking.session;
  const accent = session?.class_type?.color ?? "#7c3aed";
  const tz = session?.studio?.timezone;
  const title =
    session?.title || session?.class_type?.name || "Class";

  const where = [session?.studio?.name, session?.instructor?.display_name]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="card overflow-hidden">
      {/* Class-type colour as a top stripe, so the title gets the full width of
          the card on a phone instead of sharing the row with a bar. */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold leading-snug text-ink">
            {title}
          </h3>
          <span className={`badge ${STATUS_BADGE[booking.status]}`}>
            {STATUS_LABEL[booking.status]}
          </span>
        </div>

        <div className="space-y-0.5 text-sm text-ink-muted">
          <p className="font-medium text-ink">
            {session
              ? formatSessionWhen(session.starts_at, tz)
              : "Class removed"}
          </p>
          {where && <p className="break-words">{where}</p>}
          <p>
            {booking.spots_count ?? 1} spot{(booking.spots_count ?? 1) === 1 ? "" : "s"}
            {booking.credits_spent
              ? ` · ${booking.credits_spent} credit${booking.credits_spent === 1 ? "" : "s"} used`
              : ""}
          </p>
        </div>

        {(cancellable || locked) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
            {locked ? (
              <p className="text-sm text-ink-muted">
                Cancellation closed — this class starts within 3 hours, so the
                credit stays used.
              </p>
            ) : (
              <p className="text-sm text-ink-muted">
                Free to cancel until 3 hours before the start.
              </p>
            )}

            {cancellable && (
              <div className="w-full sm:w-40">
                <form action={cancelBookingAction}>
                  <input type="hidden" name="booking_id" value={booking.id} />
                  <SubmitButton>Cancel</SubmitButton>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
