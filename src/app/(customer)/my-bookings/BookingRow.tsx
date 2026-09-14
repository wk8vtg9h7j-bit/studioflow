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
}: {
  booking: BookingWithSession;
  cancellable: boolean;
}) {
  const session = booking.session;
  const accent = session?.class_type?.color ?? "#7c3aed";
  const tz = session?.studio?.timezone;
  const title =
    session?.title || session?.class_type?.name || "Class";

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
              {STATUS_LABEL[booking.status]}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-muted">
            {session ? formatSessionWhen(session.starts_at, tz) : "Class removed"}
            {session?.studio?.name ? ` · ${session.studio.name}` : ""}
            {session?.instructor?.display_name
              ? ` · ${session.instructor.display_name}`
              : ""}
          </p>
        </div>

        <div className="w-32 shrink-0">
          {cancellable ? (
            <form action={cancelBookingAction}>
              <input type="hidden" name="booking_id" value={booking.id} />
              <SubmitButton>Cancel</SubmitButton>
            </form>
          ) : (
            <p className="text-center text-xs text-ink-muted">—</p>
          )}
        </div>
      </div>
    </li>
  );
}
