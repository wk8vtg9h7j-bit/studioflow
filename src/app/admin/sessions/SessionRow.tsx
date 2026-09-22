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
  const router = useRouter();
  const [fillPending, startFillTransition] = useTransition();
  const [privateBookPending, startPrivateBookTransition] = useTransition();
  const [showPrivateBooking, setShowPrivateBooking] = useState(false);
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
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-soft">
            <span className="min-w-0 truncate">
              {session.studio?.name ?? "Unknown studio"}
              {" · "}
              {session.instructor?.display_name ?? "Unassigned"}
              {session.room ? ` · ${session.room}` : ""}
            </span>
            <span className="shrink-0" aria-hidden>
              ·
            </span>
            <span className="shrink-0 font-medium text-ink-muted">
              {booked}/{session.capacity} booked
            </span>
            {held > 0 ? (
              <span className="shrink-0">· {held} held</span>
            ) : null}
          </div>
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

          {!cancelled && isPrivate ? (
            <button
              type="button"
              onClick={() => setShowPrivateBooking((v) => !v)}
              className="btn-ghost"
              disabled={booked >= session.capacity}
              title="Book an existing customer into this private class"
            >
              {showPrivateBooking ? "Close booking" : "Book customer"}
            </button>
          ) : !cancelled ? (
            <button
              type="button"
              onClick={toggleFill}
              className="btn-ghost"
              disabled={fillPending || (held === 0 && openSeats === 0)}
              title={
                held > 0
                  ? "Release the held seats so customers can book again"
                  : "Hold the remaining seats so customers see this class as full"
              }
            >
              {fillPending ? "Saving…" : held > 0 ? "Unfill" : "Fill"}
            </button>
          ) : null}

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

      {showPrivateBooking && isPrivate && !cancelled && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
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
