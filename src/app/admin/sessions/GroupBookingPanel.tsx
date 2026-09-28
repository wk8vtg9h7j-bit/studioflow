"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminBookGroupCustomerAction,
  adminCreateAndBookGroupCustomerAction,
  searchPrivateCustomersAction,
  type PrivateCustomerSearchResult,
} from "./actions";

export function GroupBookingPanel({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<PrivateCustomerSearchResult[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [spots, setSpots] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (mode !== "existing") return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchPrivateCustomersAction(query);
        if (!cancelled) setCustomers(results);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, query.trim() ? 220 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, query]);

  function bookExisting() {
    if (!customerId) {
      setNotice({ kind: "error", text: "Choose a customer first." });
      return;
    }

    setNotice(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("session_id", sessionId);
      form.set("customer_id", customerId);
      form.set("spots", String(spots));

      const result = await adminBookGroupCustomerAction({}, form);
      if (result.error) {
        setNotice({ kind: "error", text: result.error });
        return;
      }

      setNotice({
        kind: "success",
        text: result.message ?? "Customer booked.",
      });
      setCustomerId("");
      setQuery("");
      setCustomers([]);
      router.refresh();
    });
  }

  function createAndBook() {
    if (!name.trim()) {
      setNotice({ kind: "error", text: "Enter the customer name." });
      return;
    }

    setNotice(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("session_id", sessionId);
      form.set("name", name.trim());
      form.set("email", email.trim());

      const result = await adminCreateAndBookGroupCustomerAction({}, form);
      if (result.error) {
        setNotice({ kind: "error", text: result.error });
        return;
      }

      setNotice({
        kind: "success",
        text: result.message ?? "Customer created and booked.",
      });
      setName("");
      setEmail("");
      router.refresh();
    });
  }

  return (
    <div className="border-t border-stone-200 bg-stone-50 px-4 py-4 sm:px-5">
      <div className="max-w-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Book customer</h3>
            <p className="mt-1 text-xs text-ink-muted">
              Book an existing customer, or create a new no-login customer and
              book them immediately.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5">
            Close
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("existing");
              setNotice(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              mode === "existing"
                ? "bg-brand-50 text-brand-700"
                : "text-ink-muted hover:bg-stone-100"
            }`}
          >
            Existing customer
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("new");
              setNotice(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              mode === "new"
                ? "bg-brand-50 text-brand-700"
                : "text-ink-muted hover:bg-stone-100"
            }`}
          >
            New customer
          </button>
        </div>

        {mode === "existing" ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor={`customer-search-${sessionId}`}>
                Find customer
              </label>
              <input
                id={`customer-search-${sessionId}`}
                type="search"
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or email…"
                disabled={pending}
              />
              {searching && (
                <p className="mt-1 text-xs text-ink-soft">Searching…</p>
              )}
            </div>

            <div>
              <label className="label" htmlFor={`customer-select-${sessionId}`}>
                Customer
              </label>
              <select
                id={`customer-select-${sessionId}`}
                className="input"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                disabled={pending}
              >
                <option value="">
                  {searching
                    ? "Searching…"
                    : customers.length === 0
                      ? "No matching customers"
                      : "Choose a customer…"}
                </option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.email ? ` — ${customer.email}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="label">Spots</p>
              <div className="grid max-w-xs grid-cols-2 gap-2">
                {[1, 2].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSpots(value as 1 | 2)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                      spots === value
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-stone-200 bg-white text-ink"
                    }`}
                    disabled={pending}
                  >
                    {value} spot{value === 1 ? "" : "s"}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-ink-soft">
              The normal class credit cost is deducted from the customer. If the
              class is full, normal waitlist rules apply and no credit is spent.
            </p>

            <button
              type="button"
              onClick={bookExisting}
              className="btn-primary"
              disabled={pending || !customerId}
            >
              {pending ? "Booking…" : "Book customer"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor={`new-customer-name-${sessionId}`}>
                Customer name
              </label>
              <input
                id={`new-customer-name-${sessionId}`}
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Full name"
                disabled={pending}
              />
            </div>

            <div>
              <label className="label" htmlFor={`new-customer-email-${sessionId}`}>
                Email <span className="text-ink-soft">(optional)</span>
              </label>
              <input
                id={`new-customer-email-${sessionId}`}
                type="email"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Can be added later"
                disabled={pending}
              />
            </div>

            <div className="rounded-lg bg-white px-3 py-3 text-xs text-ink-muted ring-1 ring-stone-200">
              New customers receive the same starter credit as a normal signup:
              <strong className="text-ink"> +1 regular credit for 30 days</strong>.
              For a normal 1-credit class, that starter credit is then used for
              this booking. No login is created yet; an email/login can be
              attached later without losing their history.
            </div>

            <button
              type="button"
              onClick={createAndBook}
              className="btn-primary"
              disabled={pending || !name.trim()}
            >
              {pending ? "Creating & booking…" : "Create & book customer"}
            </button>
          </div>
        )}

        {notice && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              notice.kind === "success"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}
