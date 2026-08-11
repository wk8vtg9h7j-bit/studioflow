// ============================================================================
// SessionRow — one scheduled class on the admin calendar list. It shows the
// at-a-glance details (class/title, studio, when, instructor, live occupancy)
// and can expand into one of two inline panels: an edit form, or the register
// ("Fill class") where reception checks people in. Cancelling/restoring posts
// directly to a server action; editing reuses the shared SessionForm, so the row
// receives the studio/class-type/instructor option arrays as props to hand
// straight through. RegisterPanel needs only the session id — it fetches its own
// roster — so it takes nothing else from here.
//
// Only one panel is open at a time: opening either closes the other, so the row
// never grows two stacked forms.
//
// `booked` is the live seat count for this session, computed by the page (see
// the companion bookings query there). It counts 'booked' + 'attended' rows, so
// "3 of 4" here means the same thing the database means when it decides whether
// the next booking gets a seat or the waitlist.
//
// Times are always rendered in the session's own studio timezone, so an admin in
// London sees a Sydney class at its Sydney wall-clock.
// ============================================================================
"use client";

import { useState } from "react";
import { formatSessionWhen, formatSessionTimeRange } from "@/lib/format";
import type { SessionWithRelations } from "@/lib/types";
import { SessionForm } from "./SessionForm";
import type {
  StudioOption,
  ClassTypeOption,
  InstructorOption,
} from "./SessionForm";
import { RegisterPanel } from "./RegisterPanel";
import { setSessionStatusAction } from "./actions";

export function SessionRow({
  session,
  booked,
  studios,
  classTypes,
  instructors,
}: {
  session: SessionWithRelations;
  booked: number;
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
}) {
  const [panel, setPanel] = useState<"none" | "edit" | "register">("none");
  const editing = panel === "edit";
  const filling = panel === "register";

  const cancelled = session.status === "cancelled";
  const tz = session.studio?.timezone;
  const heading = session.title ?? session.class_type?.name ?? "Class";
  const color = session.class_type?.color ?? "#d6d3d1";

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <span
          className="h-12 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-ink">{heading}</p>
            {cancelled ? (
              <span className="badge bg-stone-100 text-ink-muted">
                Cancelled
              </span>
            ) : (
              <span className="badge bg-emerald-50 text-emerald-700">
                Scheduled
              </span>
            )}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {formatSessionWhen(session.starts_at, tz)} ·{" "}
            {formatSessionTimeRange(session.starts_at, session.ends_at, tz)}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">
            {session.studio?.name ?? "Unknown studio"}
            {" · "}
            {session.instructor?.display_name ?? "Unassigned"}
            {" · "}
            {booked} of {session.capacity} booked
            {session.room ? ` · ${session.room}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setPanel((p) => (p === "register" ? "none" : "register"))
            }
            className="btn-secondary"
          >
            {filling ? "Close" : "Fill class"}
          </button>

          <button
            type="button"
            onClick={() => setPanel((p) => (p === "edit" ? "none" : "edit"))}
            className="btn-secondary"
          >
            {editing ? "Close" : "Edit"}
          </button>

          <form action={setSessionStatusAction}>
            <input type="hidden" name="id" value={session.id} />
            <input
              type="hidden"
              name="status"
              value={cancelled ? "scheduled" : "cancelled"}
            />
            <button
              type="submit"
              className="btn-ghost"
              title={cancelled ? "Restore session" : "Cancel session"}
            >
              {cancelled ? "Restore" : "Cancel"}
            </button>
          </form>
        </div>
      </div>

      {editing && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <SessionForm
            session={session}
            studios={studios}
            classTypes={classTypes}
            instructors={instructors}
            onDone={() => setPanel("none")}
          />
        </div>
      )}

      {filling && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <RegisterPanel sessionId={session.id} />
        </div>
      )}
    </li>
  );
}
