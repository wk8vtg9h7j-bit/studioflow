// ============================================================================
// A single bookable class in the customer browse list. Phone-first layout with
// readable date/time, full class description, availability, credit type and the
// booking action.
// ============================================================================
import type { SessionWithRelations } from "@/lib/types";
import type { Dict } from "@/lib/i18n";
import { formatSessionDate, formatSessionTimeRange } from "@/lib/format";
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
  const isPrivate = session.class_type?.pool === "private";
  const description = session.class_type?.description;
  const where = [session.studio?.name, session.instructor?.display_name]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="card overflow-hidden">
      <div
        className="h-1 w-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold leading-snug text-ink">
            {session.title || session.class_type?.name || dict.session_fallback}
          </h3>
          {isPrivate && (
            <span className="badge bg-brand-50 text-brand-700">
              {dict.packages_pool_private}
            </span>
          )}
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
              {isFull ? dict.seats_full : dict.seats_left(available)}
            </span>
            <span className="text-ink-muted">
              {" · "}
              {dict.cost_credits(cost)}
              {isPrivate ? ` · ${dict.packages_pool_private}` : ""}
            </span>
          </p>

          <div className="w-full sm:w-40">
            {myStatus ? (
              <p className="text-sm text-ink-muted sm:text-right">
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
    </li>
  );
}
