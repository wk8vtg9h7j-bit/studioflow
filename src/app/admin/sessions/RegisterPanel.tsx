// Admin class roster and checkout. Only mounts when a class is expanded:
// checkout packages and payment classifications are not fetched for every row.
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CheckoutControl } from "@/components/CheckoutControl";
import type { BookingStatus } from "@/lib/types";
import { getRegisterDataAction, setBookingStatusAction } from "./actions";
import type { RegisterData } from "./actions";

type RegisterView = "payments" | "attendance";
const STATUS_LABEL: Record<BookingStatus, string> = {
  booked: "Booked",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
  attended: "Attended",
  no_show: "No show",
};
const STATUS_STYLE: Record<BookingStatus, string> = {
  booked: "bg-emerald-50 text-emerald-700",
  waitlisted: "bg-amber-50 text-amber-700",
  cancelled: "bg-rose-50 text-rose-700",
  attended: "bg-sky-50 text-sky-700",
  no_show: "bg-stone-100 text-stone-600",
};

export function RegisterPanel({
  sessionId,
  view = "payments",
}: {
  sessionId: string;
  view?: RegisterView;
}) {
  const [data, setData] = useState<RegisterData | null>(null);
  const [activeView, setActiveView] = useState<RegisterView>(view);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setActiveView(view), [view]);

  const load = useCallback(async () => {
    try {
      const fresh = await getRegisterDataAction(sessionId);
      setData(fresh);
      setError(null);
    } catch {
      setError("Could not load the class roster. Please try again.");
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  const afterPaymentSaved = useCallback(() => {
    setNotice("Payment recorded. The customer's payment status and credits have been updated.");
    void load();
  }, [load]);

  function mark(bookingId: string, status: BookingStatus) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const form = new FormData();
        form.set("booking_id", bookingId);
        form.set("status", status);
        const result = await setBookingStatusAction({}, form);
        if (result.error) setError(result.error);
        else await load();
      } catch {
        setError("Could not update attendance. Please try again.");
      }
    });
  }

  if (!data) {
    return (
      <div className="space-y-3" aria-live="polite">
        <div className="h-10 animate-pulse rounded-xl bg-stone-200" />
        <div className="h-20 animate-pulse rounded-xl bg-stone-100" />
        <p className="text-sm text-ink-muted">{error ?? "Loading payments and attendance…"}</p>
        {error && (
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Retry
          </button>
        )}
      </div>
    );
  }

  const activeBookings = data.roster.filter(row =>
    row.status === "booked" || row.status === "attended",
  );
  const due = activeBookings.filter(row => row.payment_status === "payment_due").length;
  const paymentRows = [...activeBookings].sort((a, b) => {
    if (a.payment_status !== b.payment_status) {
      return a.payment_status === "payment_due" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  const rows = activeView === "payments" ? paymentRows : data.roster;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink sm:text-base">Class management</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Collect outstanding payments and update attendance in one place.
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-1 rounded-xl bg-stone-200/60 p-1 sm:w-auto"
          aria-label="Class management view">
          <button type="button" aria-pressed={activeView === "payments"}
            onClick={() => setActiveView("payments")}
            className={"min-h-10 min-w-0 rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:px-4 sm:text-sm " +
              (activeView === "payments"
                ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink")}>
            Payments
          </button>
          <button type="button" aria-pressed={activeView === "attendance"}
            onClick={() => setActiveView("attendance")}
            className={"min-h-10 min-w-0 rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:px-4 sm:text-sm " +
              (activeView === "attendance"
                ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink")}>
            Attendance
          </button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-amber-100 bg-amber-50 p-2.5 sm:p-3">
          <p className="break-words text-xs font-medium text-amber-800">Payment due</p>
          <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl text-amber-900">{due}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-2.5 sm:p-3">
          <p className="break-words text-xs font-medium text-ink-muted">Checked in</p>
          <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl text-ink">{data.attendedCount}</p>
        </div>
        <div className="col-span-2 min-w-0 rounded-xl border border-stone-200 bg-white p-2.5 sm:col-span-1 sm:p-3">
          <p className="break-words text-xs font-medium text-ink-muted">Booked seats</p>
          <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl text-ink">
            {data.bookedCount}/{data.capacity}
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          {error}
          <button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button>
        </div>
      )}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-ink-muted">
          {activeView === "payments" ? "No active bookings to collect payment from." : "Nobody has booked this class yet."}
        </div>
      ) : (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {rows.map(row => {
            const paymentDue = row.payment_status === "payment_due";
            return (
              <li key={row.id} className="min-w-0 space-y-3 p-3.5 sm:p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-ink">{row.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {row.spots_count} {row.spots_count === 1 ? "spot" : "spots"} · {row.credits_spent} credits used
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={"rounded-full px-2.5 py-1 text-[11px] font-semibold " +
                      (paymentDue ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700")}>
                      {paymentDue ? "PAYMENT DUE" : "PAID / PACKAGE"}
                    </span>
                    <span className={"rounded-full px-2.5 py-1 text-[11px] font-semibold " + STATUS_STYLE[row.status]}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </div>
                </div>

                {activeView === "payments" && paymentDue && row.status === "attended" && (
                  <div className="min-w-0 max-w-full rounded-xl border border-stone-200 bg-stone-50/70 p-2.5 sm:p-3">
                    <CheckoutControl
                      bookingId={row.id}
                      pool={data.pool}
                      creditsSpent={row.credits_spent}
                      eligibleStarter={row.eligible_starter}
                      packages={data.packages}
                      onSuccess={afterPaymentSaved}
                      instructorName={data.instructorName ?? undefined}
                    />
                  </div>
                )}
                {activeView === "payments" && paymentDue && row.status === "booked" && (
                  <div className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-amber-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-amber-900">
                      Check in this customer before recording payment for the attended class.
                    </p>
                    <button type="button" className="btn-secondary min-h-10 shrink-0 text-xs"
                      disabled={pending || !data.canMarkAttendance}
                      onClick={() => mark(row.id, "attended")}>
                      {pending ? "Updating…" : "Check in"}
                    </button>
                    {!data.canMarkAttendance && (
                      <p className="text-xs text-amber-800 sm:max-w-[140px]">Available when class starts</p>
                    )}
                  </div>
                )}

                {activeView === "attendance" && row.status !== "waitlisted" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-secondary min-h-10 text-xs"
                      disabled={pending || !data.canMarkAttendance || row.status === "attended"}
                      onClick={() => mark(row.id, "attended")}>Attended</button>
                    <button type="button" className="btn-secondary min-h-10 text-xs"
                      disabled={pending || !data.canMarkAttendance || row.status === "no_show"}
                      onClick={() => mark(row.id, "no_show")}>No show</button>
                    <button type="button" className="btn-ghost min-h-10 text-xs"
                      disabled={pending || row.status === "booked"}
                      onClick={() => mark(row.id, "booked")}>Undo</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs leading-relaxed text-ink-muted">
        Paid packages cover the class. Starter/manual credits do not count as payment.
        An attended customer can pay for the single class or, if eligible, buy a package that includes it.
        This checkout records a payment once and updates the customer's credits.
      </p>
    </div>
  );
}
