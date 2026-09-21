// ============================================================================
// SessionRow — one scheduled class on the admin calendar list. It shows the
// at-a-glance details (class/title, studio, when, instructor, capacity) and can
// expand into an inline edit form. Cancelling/restoring posts directly to a
// server action; editing reuses the shared SessionForm, so the row receives the
// studio/class-type/instructor option arrays as props to hand straight through.
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
import { setSessionStatusAction, setFillerSeatsAction } from "./actions";
import { RegisterPanel } from "./RegisterPanel";

export function SessionRow({
  session,
  booked,
  studios,
  classTypes,
  instructors,
}: {
  session: SessionWithRelations;
  // Seats taken right now, held seats included — tallied on the server because
  // RLS hides other customers' bookings from a normal client.
  booked: number;
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
}) {
  const [editing, setEditing] = useState(false);
  // The roster is fetched by RegisterPanel only once it's opened, so this flag
  // is also what keeps the sessions list from loading every booking on screen.
  const [showRegister, setShowRegister] = useState(false);

  const cancelled = session.status === "cancelled";
  // Seats reception is holding to close a quiet class. Included in `booked`.
  const held = session.filler_seats ?? 0;
  const openSeats = Math.max(0, session.capacity - booked);
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
            {booked}/{session.capacity} booked
            {held > 0 ? ` · ${held} held` : ""}
            {session.room ? ` · ${session.room}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRegister((v) => !v)}
            className="btn-secondary"
            title="Mark who attended and who didn't"
          >
            {showRegister ? "Hide register" : "Register"}
          </button>

          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary"
          >
            {editing ? "Close" : "Edit"}
          </button>

          {!cancelled && (
            <form action={setFillerSeatsAction}>
              <input type="hidden" name="id" value={session.id} />
              {/* Hold every remaining seat, or release the hold entirely. */}
              <input
                type="hidden"
                name="seats"
                value={held > 0 ? 0 : openSeats}
              />
              <button
                type="submit"
                className="btn-ghost"
                disabled={held === 0 && openSeats === 0}
                title={
                  held > 0
                    ? "Release the held seats so customers can book again"
                    : "Hold the remaining seats so customers see this class as full"
                }
              >
                {held > 0 ? "Unfill" : "Fill"}
              </button>
            </form>
          )}

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

      {showRegister && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <RegisterPanel sessionId={session.id} />
        </div>
      )}

      {editing && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <SessionForm
            session={session}
            studios={studios}
            classTypes={classTypes}
            instructors={instructors}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </li>
  );
}
