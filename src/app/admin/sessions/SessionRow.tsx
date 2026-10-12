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

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatSessionWhen, formatSessionTimeRange } from "@/lib/format";
import type { SessionWithRelations } from "@/lib/types";
import { SessionForm } from "./SessionForm";
import type {
  StudioOption,
  ClassTypeOption,
  InstructorOption,
} from "./SessionForm";
import {
  setSessionStatusAction,
  setFillerSeatsAction,
  adminBookPrivateCustomerAction,
  searchPrivateCustomersAction,
  type PrivateCustomerSearchResult,
} from "./actions";
import { RegisterPanel } from "./RegisterPanel";
import { GroupBookingPanel } from "./GroupBookingPanel";

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
  const [registerView, setRegisterView] = useState<"payments" | "attendance">("payments");
  const [showMobileActions, setShowMobileActions] = useState(false);
  const router = useRouter();
  const [fillPending, startFillTransition] = useTransition();
  const [privateBookPending, startPrivateBookTransition] = useTransition();
  const [showPrivateBooking, setShowPrivateBooking] = useState(false);
  const [showGroupBooking, setShowGroupBooking] = useState(false);
  const [privateCustomerId, setPrivateCustomerId] = useState("");
  const [privateCustomerQuery, setPrivateCustomerQuery] = useState("");
  const [privateCustomers, setPrivateCustomers] = useState<
    PrivateCustomerSearchResult[]
  >([]);
  const [privateSearchLoading, setPrivateSearchLoading] = useState(false);
  const [fillNotice, setFillNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const cancelled = session.status === "cancelled";
  const isPrivate = session.class_type?.pool === "private";
  // Seats reception is holding to close a quiet class. Included in `booked`.
  const held = session.filler_seats ?? 0;
  const openSeats = Math.max(0, session.capacity - booked);
  const realBooked = Math.max(0, booked - held);
  // Keep any actually booked group class staffed; only an empty class can
  // release its instructor when reception marks it full.
  const canToggleFill = held > 0 || (openSeats > 0 && realBooked === 0);
  const fillHelp = held > 0
    ? "Reopen this class; the teacher stays unassigned until reassigned."
    : realBooked > 0
      ? "Cannot release an instructor from a class with customer bookings."
      : "Mark class full and release instructor for private appointments.";
  const tz = session.studio?.timezone;
  const heading = session.title ?? session.class_type?.name ?? "Class";
  const color = session.class_type?.color ?? "#d6d3d1";

  useEffect(() => {
    if (!showPrivateBooking || !isPrivate || cancelled) return;

    let cancelledRequest = false;
    const timer = window.setTimeout(async () => {
      setPrivateSearchLoading(true);
      try {
        const results = await searchPrivateCustomersAction(privateCustomerQuery);
        if (!cancelledRequest) setPrivateCustomers(results);
      } finally {
        if (!cancelledRequest) setPrivateSearchLoading(false);
      }
    }, privateCustomerQuery.trim() ? 220 : 0);

    return () => {
      cancelledRequest = true;
      window.clearTimeout(timer);
    };
  }, [showPrivateBooking, isPrivate, cancelled, privateCustomerQuery]);

  function toggleRoster(view: "payments" | "attendance") {
    if (showRegister && registerView === view) {
      setShowRegister(false);
    } else {
      setRegisterView(view);
      setShowRegister(true);
      setEditing(false);
      setShowPrivateBooking(false);
      setShowGroupBooking(false);
    }
    setShowMobileActions(false);
  }

  function toggleFill() {
    const releasing = held > 0;
    const seats = releasing ? 0 : openSeats;
    setFillNotice(null);

    startFillTransition(async () => {
      const form = new FormData();
      form.set("id", session.id);
      form.set("seats", String(seats));

      const result = await setFillerSeatsAction({}, form);
      if (result.error) {
        setFillNotice({ kind: "error", text: result.error });
        return;
      }

      setFillNotice({
        kind: "success",
        text:
          result.message ??
          (releasing
            ? "Class reopened. Customers can book again."
            : "Class filled. Remaining seats are now held."),
      });
      router.refresh();
    });
  }

  function bookPrivateCustomer() {
    if (!privateCustomerId) {
      setFillNotice({ kind: "error", text: "Choose a customer first." });
      return;
    }

    setFillNotice(null);
    startPrivateBookTransition(async () => {
      const form = new FormData();
      form.set("session_id", session.id);
      form.set("customer_id", privateCustomerId);

      const result = await adminBookPrivateCustomerAction({}, form);
      if (result.error) {
        setFillNotice({ kind: "error", text: result.error });
        return;
      }

      setFillNotice({
        kind: "success",
        text: result.message ?? "Customer booked into the private class.",
      });
      setShowPrivateBooking(false);
      setPrivateCustomerId("");
      setPrivateCustomerQuery("");
      setPrivateCustomers([]);
      router.refresh();
    });
  }

  return (
    <li className="card min-w-0 overflow-hidden">
      {/* Keep the title and session details full-width. Actions never compete
          with the title for horizontal space at tablet or desktop widths. */}
      <div className="min-w-0 px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-0.5 h-12 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words text-sm font-semibold leading-snug text-ink sm:text-base">
                {heading}
              </h3>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                cancelled ? "bg-stone-100 text-stone-600" : "bg-emerald-50 text-emerald-700"
              }`}>
                {cancelled ? "Cancelled" : "Scheduled"}
              </span>
            </div>

            <p className="mt-1.5 break-words text-xs leading-relaxed text-ink-muted sm:text-sm">
              {formatSessionWhen(session.starts_at, tz)} ·{" "}
              {formatSessionTimeRange(session.starts_at, session.ends_at, tz)}
            </p>
            <p className="mt-1 break-words text-xs leading-relaxed text-ink-muted">
              {session.studio?.name ?? "Unknown studio"} ·{" "}
              {session.instructor?.display_name ?? "Unassigned"}
              {session.room ? ` · ${session.room}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-semibold text-ink-muted">
                {booked}/{session.capacity} booked
              </span>
              {held > 0 && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-800">
                  {held} held
                </span>
              )}
              {held >= session.capacity && !session.instructor_id && (
                <span className="text-emerald-700">Instructor free for private classes</span>
              )}
            </div>
          </div>
        </div>

        {/* Two readable primary actions on phones. At larger widths they are
            still on their own row, so long studio/instructor names cannot clip. */}
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-stone-100 pt-3 sm:flex sm:flex-wrap">
          <button
            type="button"
            onClick={() => toggleRoster("payments")}
            aria-expanded={showRegister && registerView === "payments"}
            className="btn-primary min-h-10 min-w-0 whitespace-normal px-2 text-center text-xs leading-snug sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">
              {showRegister && registerView === "payments" ? "Close payments" : "Payments"}
            </span>
            <span className="hidden sm:inline">
              {showRegister && registerView === "payments" ? "Close payments" : "Collect payment"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleRoster("attendance")}
            aria-expanded={showRegister && registerView === "attendance"}
            className="btn-secondary min-h-10 min-w-0 whitespace-normal px-2 text-center text-xs leading-snug sm:px-4 sm:text-sm"
          >
            {showRegister && registerView === "attendance" ? "Close attendance" : "Attendance"}
          </button>
          <button
            type="button"
            onClick={() => setShowMobileActions(value => !value)}
            aria-expanded={showMobileActions}
            aria-controls={`session-actions-${session.id}`}
            className="btn-secondary col-span-2 min-h-10 min-w-0 whitespace-normal px-2 text-center text-xs leading-snug sm:px-4 sm:text-sm"
          >
            {showMobileActions ? "Close actions" : "More actions"}
            <span aria-hidden="true">{showMobileActions ? "−" : "+"}</span>
          </button>
        </div>
      </div>

      {showMobileActions && (
        <div id={`session-actions-${session.id}`}
          className="border-t border-stone-200 bg-stone-50 px-3 py-3 sm:px-4 sm:py-4">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {!cancelled && (
              <button
                type="button"
                onClick={() => {
                  if (isPrivate) {
                    setShowPrivateBooking(value => !value);
                    setShowGroupBooking(false);
                  } else {
                    setShowGroupBooking(value => !value);
                    setShowPrivateBooking(false);
                  }
                  setShowRegister(false);
                  setEditing(false);
                  setShowMobileActions(false);
                }}
                className="btn-secondary min-h-10 min-w-0 whitespace-normal px-2 text-xs leading-snug sm:px-4 sm:text-sm"
                disabled={isPrivate && booked >= session.capacity}
              >
                {(isPrivate ? showPrivateBooking : showGroupBooking)
                  ? "Close booking" : "Book customer"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setEditing(value => !value);
                setShowRegister(false);
                setShowGroupBooking(false);
                setShowPrivateBooking(false);
                setShowMobileActions(false);
              }}
              className="btn-secondary min-h-10 min-w-0 whitespace-normal px-2 text-xs leading-snug sm:px-4 sm:text-sm"
            >
              {editing ? "Close edit" : "Edit class"}
            </button>
            {!cancelled && !isPrivate && (
              <button
                type="button"
                onClick={() => { toggleFill(); setShowMobileActions(false); }}
                disabled={fillPending || !canToggleFill}
                title={fillHelp}
                className="btn-secondary min-h-10 min-w-0 whitespace-normal px-2 text-xs leading-snug sm:px-4 sm:text-sm"
              >
                {fillPending ? "Saving…" : held > 0 ? "Unfill class" : "Fill class"}
              </button>
            )}
            <form action={setSessionStatusAction} className="min-w-0">
              <input type="hidden" name="id" value={session.id} />
              <input type="hidden" name="status"
                value={cancelled ? "scheduled" : "cancelled"} />
              <button type="submit"
                className="btn-ghost min-h-10 w-full min-w-0 whitespace-normal px-2 text-xs leading-snug sm:px-4 sm:text-sm">
                {cancelled ? "Restore class" : "Cancel class"}
              </button>
            </form>
          </div>
        </div>
      )}

      {showGroupBooking && !isPrivate && !cancelled && (
        <GroupBookingPanel
          sessionId={session.id}
          onClose={() => setShowGroupBooking(false)}
        />
      )}

      {showPrivateBooking && isPrivate && !cancelled && (
        <div className="min-w-0 border-t border-stone-200 bg-stone-50 px-3 py-3 sm:px-4 sm:py-4">
          <div className="max-w-xl space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Book an existing customer
              </h3>
              <p className="mt-1 text-xs text-ink-muted">
                This creates a real private booking and deducts the class&apos;s
                private credit cost from the selected customer.
              </p>
            </div>

            <div className="space-y-2">
              <div>
                <label
                  className="label"
                  htmlFor={`private-customer-filter-${session.id}`}
                >
                  Find customer
                </label>
                <input
                  id={`private-customer-filter-${session.id}`}
                  type="search"
                  className="input"
                  value={privateCustomerQuery}
                  onChange={(e) => setPrivateCustomerQuery(e.target.value)}
                  placeholder="Search by name or email…"
                  disabled={privateBookPending}
                />
                {privateSearchLoading && (
                  <p className="mt-1 text-xs text-ink-soft">Searching…</p>
                )}
              </div>

              <div>
                <label className="label" htmlFor={`private-customer-${session.id}`}>
                  Customer
                </label>
                <select
                  id={`private-customer-${session.id}`}
                  className="input"
                  value={privateCustomerId}
                  onChange={(e) => setPrivateCustomerId(e.target.value)}
                  disabled={privateBookPending}
                >
                  <option value="">
                    {privateSearchLoading
                      ? "Searching…"
                      : privateCustomers.length === 0
                        ? "No matching customers"
                        : "Choose a customer…"}
                  </option>
                  {privateCustomers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                      {customer.email ? ` — ${customer.email}` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-soft">
                  Showing up to 30 matching customers
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={bookPrivateCustomer}
              className="btn-primary"
              disabled={
                privateBookPending ||
                !privateCustomerId ||
                booked >= session.capacity
              }
            >
              {privateBookPending ? "Booking…" : "Book into private class"}
            </button>
          </div>
        </div>
      )}

      {fillNotice && (
        <div
          role="status"
          className={`border-t px-5 py-3 text-sm ${
            fillNotice.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {fillNotice.text}
        </div>
      )}

      {showRegister && (
        <div className="min-w-0 border-t border-stone-200 bg-stone-50 px-3 py-3 sm:px-4 sm:py-4">
          <RegisterPanel sessionId={session.id} view={registerView} />
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
