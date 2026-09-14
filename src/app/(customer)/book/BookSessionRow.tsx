// ============================================================================
// A single bookable class in the customer browse list. Presentational: it shows
// when/where the class is, what it's about, how many seats are left, what it
// costs in credits, and a book button wired to the bookSessionAction. If the
// member already has a booking we show their status instead of the button, and
// when the class is full the button becomes a "Join waitlist" call to action.
//
// The layout is phone-first: everything stacks into one readable column and
// nothing is truncated, because members need to actually read the time and the
// description before they spend a credit. The seat/price summary and the action
// share a row from `sm` up, where there's width for it.
// ============================================================================
import type { SessionWithRelations } from "@/lib/types";
import { formatSessionDate, formatSessionTimeRange } from "@/lib/format";
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
  const isPrivate = session.class_type?.pool === "private";
  const description = session.class_type?.description;
  const where = [session.studio?.name, session.instructor?.display_name]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="card overflow-hidden">
      {/* The class-type colour reads as a top stripe so the title never has to
          share horizontal space with it on a narrow screen. */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold leading-snug text-ink">
            {session.title || session.class_type?.name || "Class"}
          </h3>
          {isPrivate && (
            <span className="badge bg-brand-50 text-brand-700">Private</span>
          )}
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

        <div className="space-y-0.5 text-sm text-ink-muted">
          <p className="font-medium text-ink">
            {formatSessionDate(session.starts_at, tz)}
          </p>
          <p>{formatSessionTimeRange(session.starts_at, session.ends_at, tz)}</p>
          {where && <p className="break-words">{where}</p>}
        </div>

        {description && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <p className="text-sm">
            <span className="font-semibold text-ink">
              {isFull ? "Full" : `${available} left`}
            </span>
            <span className="text-ink-muted">
              {" · "}
              {cost} {isPrivate ? "private " : ""}credit{cost === 1 ? "" : "s"}
            </span>
          </p>

          <div className="w-full sm:w-40">
            {myStatus ? (
              <p className="text-sm text-ink-muted sm:text-right">
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
      </div>
    </li>
  );
}
