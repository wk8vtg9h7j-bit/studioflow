// ============================================================================
// RegisterPanel — the attendance register for one class. Expands inside a
// SessionRow and lists everyone holding a seat, so reception can mark who
// turned up and who didn't.
//
// The roster is loaded on demand rather than with the sessions list: a page of
// classes would otherwise pull every booking on screen, and the register is
// only ever open for one class at a time.
//
// Marking is reversible. That isn't cosmetic — cancel_booking treats 'attended'
// and 'no_show' as terminal, so a misclick would otherwise strand the seat.
// ============================================================================
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { BookingStatus } from "@/lib/types";
import { getRegisterDataAction, setBookingStatusAction } from "./actions";
import type { RegisterData } from "./actions";

const STATUS_BADGE: Record<BookingStatus, string> = {
  booked: "bg-emerald-50 text-emerald-700",
  waitlisted: "bg-amber-50 text-amber-700",
  cancelled: "bg-rose-50 text-rose-700",
  attended: "bg-sky-50 text-sky-700",
  no_show: "bg-zinc-100 text-zinc-600",
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  booked: "Booked",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
  attended: "Attended",
  no_show: "No show",
};

export function RegisterPanel({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<RegisterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      setData(await getRegisterDataAction(sessionId));
    } catch {
      setError("Could not load the register.");
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Write, then re-read: the counts are derived from the roster, so refetching
  // keeps the summary line honest without duplicating the tally client-side.
  function mark(bookingId: string, status: BookingStatus) {
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("booking_id", bookingId);
      form.set("status", status);
      const result = await setBookingStatusAction({}, form);
      if (result.error) setError(result.error);
      else await load();
    });
  }

  if (!data) {
    return (
      <p className="text-sm text-ink-muted">
        {error ?? "Loading register…"}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft">
        {data.attendedCount} attended · {data.noShowCount} no show ·{" "}
        {data.bookedCount}/{data.capacity} seats · {data.creditsUsed} credits
        spent
      </p>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {data.roster.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nobody has booked this class yet.
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {data.roster.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-ink">
                {row.name}
              </span>
              <span className={`badge ${STATUS_BADGE[row.status]}`}>
                {STATUS_LABEL[row.status]}
              </span>

              {/* A waitlisted member never had a seat, so there is nothing to
                  mark until someone promotes them. */}
              {row.status !== "waitlisted" && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pending || row.status === "attended"}
                    onClick={() => mark(row.id, "attended")}
                  >
                    Attended
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pending || row.status === "no_show"}
                    onClick={() => mark(row.id, "no_show")}
                  >
                    No show
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pending || row.status === "booked"}
                    onClick={() => mark(row.id, "booked")}
                    title="Clear the mark and put this booking back to Booked"
                  >
                    Undo
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-soft">
        Credits are not returned for a no-show — the seat was held. Attendance
        feeds payroll, so marking a no-show lowers the head count for this class.
      </p>
    </div>
  );
}
