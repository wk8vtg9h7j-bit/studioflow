// ============================================================================
// A single bookable class in the customer browse list. Presentational: it shows
// when/where the class is, how many seats are left, what it costs in credits,
// and a book button wired to the bookSessionAction. If the member already has a
// booking for this session we show their status instead of the button, and when
// the class is full the button becomes a "Join waitlist" call to action.
// ============================================================================
import type { SessionWithRelations } from "@/lib/types";
import { formatSessionWhen } from "@/lib/format";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { bookSessionAction } from "./actions";

type Props = {
  session: SessionWithRelations;
  booked: number;
  myStatus: "booked" | "waitlisted" | null;
};

export function BookSessionRow({ session, booked, myStatus }: Props) {
  const capacity = session.capacity ?? 0;
  const available = Math.max(0, capacity - booked);
  const isFull = available <= 0;
  const cost = session.class_type?.credits_cost ?? 1;
  const accent = session.class_type?.color ?? "#7c3aed";
  const tz = session.studio?.timezone;

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
            <p className="truncate text-sm font-semibold text-ink">
              {session.title || session.class_type?.name || "Class"}
            </p>
            {myStatus && (
              <span
                className={`badge ${
                  myStatus === "booked"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {myStatus === "booked" ? "Booked" : "Waitlisted"}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-muted">
            {formatSessionWhen(session.starts_at, tz)}
            {session.studio?.name ? ` · ${session.studio.name}` : ""}
            {session.instructor?.display_name
              ? ` · ${session.instructor.display_name}`
              : ""}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-ink">
            {isFull ? "Full" : `${available} left`}
          </p>
          <p className="text-xs text-ink-muted">
            {cost} credit{cost === 1 ? "" : "s"}
          </p>
        </div>

        <div className="w-32 shrink-0">
          {myStatus ? (
            <p className="text-center text-xs text-ink-muted">
              You&apos;re {myStatus === "booked" ? "in" : "on the list"}
            </p>
          ) : (
            <form action={bookSessionAction}>
              <input type="hidden" name="session_id" value={session.id} />
              <SubmitButton>{isFull ? "Join waitlist" : "Book"}</SubmitButton>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}
