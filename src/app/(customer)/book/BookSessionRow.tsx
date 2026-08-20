// ============================================================================
// A single bookable class in the customer browse list. Presentational: it shows
// when/where the class is, how many seats are left, what it costs in credits,
// and a book button wired to the bookSessionAction. If the member already has a
// booking for this session we show their status instead of the button, and when
// the class is full the button becomes a "Join waitlist" call to action.
// ============================================================================
import type { SessionWithRelations } from "@/lib/types";
import type { Dict } from "@/lib/i18n";
import { formatSessionWhen } from "@/lib/format";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { bookSessionAction } from "./actions";

type Props = {
  session: SessionWithRelations;
  booked: number;
  myStatus: "booked" | "waitlisted" | null;
  dict: Dict;
};

export function BookSessionRow({ session, booked, myStatus, dict }: Props) {
  const capacity = session.capacity ?? 0;
  const available = Math.max(0, capacity - booked);
  const isFull = available <= 0;
  const cost = session.class_type?.credits_cost ?? 1;
  const accent = session.class_type?.color ?? "#7c3aed";
  const tz = session.studio?.timezone;

  return (
    <li className="card hover-lift overflow-hidden">
      {/* The accent bar runs the full height of the card on every breakpoint, so a
          member can colour-match a class type while scanning down the list. */}
      <div className="flex">
        <span
          className="w-1.5 shrink-0 self-stretch"
          style={{ backgroundColor: accent }}
          aria-hidden
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            {/* When the class happens is the single thing members scan for, so it
                leads the card in its own full-width line — never truncated. */}
            <p className="text-sm font-semibold tracking-tight text-brand-700">
              {formatSessionWhen(session.starts_at, tz)}
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold leading-tight text-ink">
                {session.title ||
                  session.class_type?.name ||
                  dict.session_fallback}
              </p>
              {myStatus && (
                <span
                  className={`badge ${
                    myStatus === "booked"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {myStatus === "booked"
                    ? dict.status_booked
                    : dict.status_waitlisted}
                </span>
              )}
            </div>

            {/* Studio and instructor wrap instead of truncating: on a phone the
                old single nowrap line hid everything after the first few words. */}
            <p className="mt-1 text-sm text-ink-muted">
              {[session.studio?.name, session.instructor?.display_name]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {session.class_type?.description ? (
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted">
                {session.class_type.description}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-4 sm:w-44 sm:flex-col sm:items-end sm:justify-center">
            <div className="sm:text-right">
              <p
                className={`text-sm font-semibold ${
                  isFull ? "text-ink-muted" : "text-ink"
                }`}
              >
                {isFull ? dict.seats_full : dict.seats_left(available)}
              </p>
              <p className="text-xs text-ink-muted">{dict.cost_credits(cost)}</p>
            </div>

            <div className="w-32 shrink-0 sm:w-full">
              {myStatus ? (
                <p className="text-right text-xs text-ink-muted sm:text-right">
                  {myStatus === "booked" ? dict.youre_in : dict.youre_on_list}
                </p>
              ) : (
                <form action={bookSessionAction}>
                  <input type="hidden" name="session_id" value={session.id} />
                  <SubmitButton>
                    {isFull ? dict.action_join_waitlist : dict.action_book}
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
