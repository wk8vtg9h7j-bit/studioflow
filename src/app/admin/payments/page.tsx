// ============================================================================
// Admin — Daily Payments tracker (accounting daily sheet).
//
// For each day we show:
//   • Who paid — every package purchase, its amount, the payment method
//     (QR / card / cash), and whether the buyer was a NEW or RETURNING customer.
//   • Who attended — the class roster for that day, so takings can be reconciled
//     against attendance.
//
// Revenue is inferred from the credit ledger: each `credit_ledger` row with
// reason = 'purchase' is one payment, priced from the package that was bought.
// payment_method is recorded by reception when the package is sold. A purchase is
// "New" when it is that customer's first-ever purchase, otherwise "Returning".
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import { formatMoney, FALLBACK_TZ } from "@/lib/format";
import { formatInTimeZone } from "date-fns-tz";
import type { Product } from "@/lib/types";
import { RecordSale } from "./RecordSale";

export const dynamic = "force-dynamic";


// How far back we look when the URL carries no explicit range.
const DEFAULT_RANGE_DAYS = 30;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Shift a yyyy-MM-dd key by whole days. Parsed as UTC midnight so the arithmetic
// never crosses a DST boundary in the studio's zone.
function shiftDay(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Method = "qr" | "card" | "cash" | "unrecorded";

const METHOD_LABEL: Record<Method, string> = {
  qr: "QR",
  card: "Card",
  cash: "Cash",
  unrecorded: "Unrecorded",
};
const METHOD_BADGE: Record<Method, string> = {
  qr: "bg-brand-50 text-brand-700",
  card: "bg-sky-50 text-sky-700",
  cash: "bg-emerald-50 text-emerald-700",
  unrecorded: "bg-stone-100 text-ink-muted",
};

type PurchaseRow = {
  id: string;
  created_at: string;
  customer_id: string;
  payment_method: string | null;
  package: { name: string | null; price_cents: number | null; currency: string | null } | null;
  customer: CustomerRef | null;
};

type SaleRow = {
  id: string;
  created_at: string;
  total_cents: number;
  currency: string;
  payment_method: string | null;
  customer: CustomerRef | null;
  items: { name: string; qty: number }[] | null;
};

type CustomerRef = {
  name: string | null;
  email: string | null;
  profile: { full_name: string | null; email: string | null } | null;
};

type AttendRow = {
  status: string;
  session: { starts_at: string; title: string | null } | null;
  customer: CustomerRef | null;
};

type Payment = {
  id: string;
  kind: "package" | "retail";
  name: string;
  label: string;
  amount: number;
  currency: string;
  method: Method;
  // Derived from purchase history, which retail sales have no part in — so a
  // retail row leaves this null rather than claiming the customer is returning.
  isNew: boolean | null;
  time: string;
};

type Attendee = { name: string; klass: string; time: string; status: string };

type DayGroup = {
  date: string;
  label: string;
  payments: Payment[];
  // Takings bucketed by currency code. A day that mixed VND and USD keeps two
  // entries rather than collapsing into one meaningless number.
  totals: Totals;
  attendees: Attendee[];
};

// Money is only additive within a single currency, so every total on this page
// is a map of currency code -> amount rather than a bare number.
type Totals = Record<string, number>;

function addTo(totals: Totals, currency: string | null, amount: number) {
  const code = (currency || "VND").toUpperCase();
  totals[code] = (totals[code] ?? 0) + amount;
}

function mergeInto(target: Totals, source: Totals) {
  for (const [code, amount] of Object.entries(source)) {
    target[code] = (target[code] ?? 0) + amount;
  }
}

// Render as "₫1,200,000" for the common single-currency day, or join each
// currency with a separator when a day genuinely mixed them.
function formatTotals(totals: Totals): string {
  const entries = Object.entries(totals).filter(([, amount]) => amount !== 0);
  if (entries.length === 0) return formatMoney(0, "VND");
  return entries
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([code, amount]) => formatMoney(amount, code))
    .join(" + ");
}

function methodOf(raw: string | null): Method {
  return raw === "qr" || raw === "card" || raw === "cash" ? raw : "unrecorded";
}
function nameOf(c: CustomerRef | null) {
  return (
    c?.profile?.full_name ??
    c?.name ??
    c?.profile?.email ??
    c?.email ??
    "Unknown customer"
  );
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from: rawFrom, to: rawTo } = await searchParams;
  const supabase = await createClient();

  // The studios are fetched *before* the main batch because the page's day axis
  // depends on them: every grouping key, the SQL bounds, and the Today/This
  // month stats are computed in one zone, and that zone comes from the studio.
  // Aggregating across studios means a single axis is the only coherent choice,
  // so we take the first active studio's zone and fall back to the shared one.
  const { data: studioData } = await supabase
    .from("studios")
    .select("id, name, timezone")
    .eq("active", true)
    .order("name", { ascending: true });

  const studioOptions = (studioData ?? []) as {
    id: string;
    name: string;
    timezone: string | null;
  }[];
  const TZ = studioOptions[0]?.timezone || FALLBACK_TZ;

  // Resolve the visible window as yyyy-MM-dd day keys in the studio's zone.
  const todayKey = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const fromParam = rawFrom && DAY_KEY.test(rawFrom) ? rawFrom : null;
  const toParam = rawTo && DAY_KEY.test(rawTo) ? rawTo : null;
  const a = fromParam ?? shiftDay(todayKey, -(DEFAULT_RANGE_DAYS - 1));
  const b = toParam ?? todayKey;
  // Tolerate a reversed range rather than showing nothing.
  const fromKey = a <= b ? a : b;
  const toKey = a <= b ? b : a;

  // SQL bounds are padded a day either side: created_at is a UTC instant while
  // fromKey/toKey are wall-clock days in TZ, so the two never line up exactly.
  // The padding over-fetches; the exact cut happens on day keys further down.
  const lowerBound = `${shiftDay(fromKey, -1)}T00:00:00Z`;
  const upperBound = `${shiftDay(toKey, 2)}T00:00:00Z`;

  const [
    { data: purchaseData },
    { data: attendData },
    { data: saleData },
    { data: productData },
    { data: customerData },
    { data: priorBuyerData },
  ] = await Promise.all([
    supabase
      .from("credit_ledger")
      .select(
        `id, created_at, customer_id, payment_method,
         package:packages ( name, price_cents, currency ),
         customer:customers ( name, email, profile:profiles ( full_name, email ) )`,
      )
      .eq("reason", "purchase")
      .gte("created_at", lowerBound)
      .lt("created_at", upperBound)
      .order("created_at", { ascending: true }),
    supabase
      .from("bookings")
      .select(
        `status,
         session:sessions ( starts_at, title ),
         customer:customers ( name, email, profile:profiles ( full_name, email ) )`,
      )
      .in("status", ["booked", "attended"])
      .gte("session.starts_at", lowerBound)
      .lt("session.starts_at", upperBound),
    supabase
      .from("sales")
      .select(
        `id, created_at, total_cents, currency, payment_method,
         customer:customers ( name, email, profile:profiles ( full_name, email ) ),
         items:sale_items ( name, qty )`,
      )
      .gte("created_at", lowerBound)
      .lt("created_at", upperBound)
      .order("created_at", { ascending: true }),
    // The till form's price list.
    supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("customers")
      .select(`id, name, email, profile:profiles ( full_name, email )`),
    // Everyone who bought before the window opened. Without this the first
    // purchase *inside* the window would look like a first purchase ever.
    supabase
      .from("credit_ledger")
      .select("customer_id")
      .eq("reason", "purchase")
      .lt("created_at", lowerBound),
  ]);

  const purchases = (purchaseData ?? []) as unknown as PurchaseRow[];
  const attendance = (attendData ?? []) as unknown as AttendRow[];
  const sales = (saleData ?? []) as unknown as SaleRow[];
  const products = (productData ?? []) as Product[];

  // A Customer row carries no display name of its own — it is either a profile
  // or a walk-in — so flatten both into one label before handing it to the form.
  const customerOptions = ((customerData ?? []) as unknown as (CustomerRef & {
    id: string;
  })[]).map((c) => ({ id: c.id, name: nameOf(c) }));

  // First-purchase-per-customer => "New". Computed over the ascending list, but
  // seeded with everyone who already bought before the window so a long-standing
  // customer is never relabelled "New" just because we started looking late.
  const seen = new Set<string>(
    ((priorBuyerData ?? []) as { customer_id: string }[]).map((r) => r.customer_id),
  );
  const isNew = new Map<string, boolean>();
  for (const p of purchases) {
    const first = !seen.has(p.customer_id);
    isNew.set(p.id, first);
    seen.add(p.customer_id);
  }

  const groups = new Map<string, DayGroup>();
  const dayOf = (iso: string) => formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");

  // The padded SQL bounds over-fetch by a day either side; trim to the exact
  // window here, on day keys in the studio's zone. Every figure below — the day
  // groups, the totals, the method split, the counts — reads these two arrays.
  const inRange = (iso: string) => {
    const key = dayOf(iso);
    return key >= fromKey && key <= toKey;
  };
  const visiblePurchases = purchases.filter((p) => inRange(p.created_at));
  const visibleSales = sales.filter((s) => inRange(s.created_at));

  const ensureDay = (date: string, iso: string): DayGroup => {
    let g = groups.get(date);
    if (!g) {
      g = {
        date,
        label: formatInTimeZone(new Date(iso), TZ, "EEEE, d MMM yyyy"),
        payments: [],
        totals: {},
        attendees: [],
      };
      groups.set(date, g);
    }
    return g;
  };

  for (const row of visiblePurchases) {
    const date = dayOf(row.created_at);
    const g = ensureDay(date, row.created_at);
    const amount = row.package?.price_cents ?? 0;
    addTo(g.totals, row.package?.currency ?? null, amount);
    g.payments.push({
      id: row.id,
      kind: "package",
      name: nameOf(row.customer),
      label: row.package?.name ?? "Package",
      amount,
      currency: row.package?.currency ?? "VND",
      method: methodOf(row.payment_method),
      isNew: isNew.get(row.id) ?? false,
      time: formatInTimeZone(new Date(row.created_at), TZ, "h:mm a"),
    });
  }

  // Retail sits alongside packages in the same day group. Amounts come from the
  // sale header, which was snapshotted at the till — never re-derived from the
  // current price list.
  for (const row of visibleSales) {
    const date = dayOf(row.created_at);
    const g = ensureDay(date, row.created_at);
    addTo(g.totals, row.currency, row.total_cents);
    g.payments.push({
      id: row.id,
      kind: "retail",
      name: nameOf(row.customer),
      label:
        (row.items ?? []).map((i) => `${i.name} ×${i.qty}`).join(", ") ||
        "Retail sale",
      amount: row.total_cents,
      currency: row.currency,
      // New/returning is a purchase-history notion; retail has no part in it.
      isNew: null,
      method: methodOf(row.payment_method),
      time: formatInTimeZone(new Date(row.created_at), TZ, "h:mm a"),
    });
  }

  for (const row of attendance) {
    if (!row.session) continue;
    if (!inRange(row.session.starts_at)) continue;
    const date = dayOf(row.session.starts_at);
    const g = ensureDay(date, row.session.starts_at);
    g.attendees.push({
      name: nameOf(row.customer),
      klass: row.session.title ?? "Class",
      time: formatInTimeZone(new Date(row.session.starts_at), TZ, "h:mm a"),
      status: row.status,
    });
  }

  // Most recent day first; newest payments first within a day.
  const days = Array.from(groups.values()).sort((a, b) =>
    a.date < b.date ? 1 : -1,
  );
  for (const d of days) {
    d.payments.reverse();
    d.attendees.sort((a, b) => (a.time < b.time ? -1 : 1));
  }

  const rangeTotals: Totals = {};
  for (const p of visiblePurchases) {
    addTo(rangeTotals, p.package?.currency ?? null, p.package?.price_cents ?? 0);
  }
  for (const r of visibleSales) {
    addTo(rangeTotals, r.currency, r.total_cents);
  }

  const monthKey = formatInTimeZone(new Date(), TZ, "yyyy-MM");
  const todayTotals = groups.get(todayKey)?.totals ?? {};
  const monthTotals: Totals = {};
  for (const d of days) {
    if (d.date.startsWith(monthKey)) mergeInto(monthTotals, d.totals);
  }

  // Method breakdown + new/returning counts across all payments.
  const byMethod: Record<Method, Totals> = {
    qr: {},
    card: {},
    cash: {},
    unrecorded: {},
  };
  let newCount = 0;
  let returningCount = 0;
  for (const p of visiblePurchases) {
    addTo(
      byMethod[methodOf(p.payment_method)],
      p.package?.currency ?? null,
      p.package?.price_cents ?? 0,
    );
    if (isNew.get(p.id)) newCount++;
    else returningCount++;
  }

  // Retail has no new/returning notion — it only moves the method split.
  for (const r of visibleSales) {
    addTo(byMethod[methodOf(r.payment_method)], r.currency, r.total_cents);
  }

  const hasUnrecorded = Object.values(byMethod.unrecorded).some((v) => v !== 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Daily payments
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Package sales, retail sales and class attendance, grouped by day — so
          takings can be reconciled against who came in.
        </p>

        <form method="get" className="mt-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <div>
            <label htmlFor="from" className="label">
              From
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={fromKey}
              className="input w-full sm:w-44"
            />
          </div>
          <div>
            <label htmlFor="to" className="label">
              To
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={toKey}
              className="input w-full sm:w-44"
            />
          </div>
          <button type="submit" className="btn-secondary w-full sm:w-auto">
            Apply
          </button>
          <a href="/admin/payments" className="btn-ghost w-full sm:w-auto">
            Last {DEFAULT_RANGE_DAYS} days
          </a>
          <a
            href={`/admin/payments/export?from=${fromKey}&to=${toKey}`}
            className="btn-ghost w-full sm:w-auto"
          >
            Export CSV
          </a>
        </form>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="space-y-6 lg:col-span-2">
          {days.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No payments or attendance in this date range.
            </div>
          ) : (
            days.map((day) => (
              <div key={day.date} className="card overflow-hidden">
                <div className="flex flex-col gap-1 border-b border-stone-200 bg-stone-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <h2 className="text-sm font-semibold text-ink">{day.label}</h2>
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {formatTotals(day.totals)}
                  </span>
                </div>

                {/* Payments */}
                <div className="px-5 pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    Paid ({day.payments.length})
                  </p>
                </div>
                {day.payments.length === 0 ? (
                  <p className="px-5 py-2 text-xs text-ink-muted">
                    No payments this day.
                  </p>
                ) : (
                  <ul className="divide-y divide-stone-100">
                    {day.payments.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-ink">
                              {p.name}
                            </p>
                            {p.isNew !== null && (
                              <span
                                className={`badge ${p.isNew ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-ink-muted"}`}
                              >
                                {p.isNew ? "New" : "Returning"}
                              </span>
                            )}
                            {p.kind === "retail" && (
                              <span className="badge bg-amber-50 text-amber-700">
                                Retail
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-ink-muted">
                            {p.label} · {p.time}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-start">
                          <span className={`badge ${METHOD_BADGE[p.method]}`}>
                            {METHOD_LABEL[p.method]}
                          </span>
                          <span className="text-sm font-semibold tabular-nums text-ink">
                            {formatMoney(p.amount, p.currency)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Attendance */}
                <div className="border-t border-stone-100 bg-stone-50/50 px-5 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    Attended ({day.attendees.length})
                  </p>
                  {day.attendees.length === 0 ? (
                    <p className="mt-1 text-xs text-ink-muted">
                      No bookings for this day.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {day.attendees.map((a, i) => (
                        <li
                          key={`${day.date}-${i}`}
                          className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="truncate text-ink">{a.name}</span>
                          <span className="text-ink-muted sm:shrink-0">
                            {a.klass} · {a.time}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-sm font-semibold text-ink">At a glance</h2>
            <dl className="space-y-3">
              <SummaryStat label="Today" value={formatTotals(todayTotals)} />
              <SummaryStat label="This month" value={formatTotals(monthTotals)} />
              <SummaryStat
                label="Payments"
                value={visiblePurchases.length + visibleSales.length}
              />
            </dl>

            <div className="my-5 h-px bg-stone-200" />
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              By payment method
            </p>
            <dl className="space-y-3">
              <SummaryStat label="QR" value={formatTotals(byMethod.qr)} />
              <SummaryStat label="Card" value={formatTotals(byMethod.card)} />
              <SummaryStat label="Cash" value={formatTotals(byMethod.cash)} />
              {hasUnrecorded && (
                <SummaryStat
                  label="Unrecorded"
                  value={formatTotals(byMethod.unrecorded)}
                />
              )}
            </dl>

            <div className="my-5 h-px bg-stone-200" />
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Customers
            </p>
            <dl className="space-y-3">
              <SummaryStat label="New" value={newCount} />
              <SummaryStat label="Returning" value={returningCount} />
            </dl>

            <div className="my-5 h-px bg-stone-200" />
            <dl className="space-y-3">
              <SummaryStat
                label="Selected range"
                value={formatTotals(rangeTotals)}
              />
            </dl>

            <p className="mt-5 text-xs text-ink-soft">
              Package amounts come from each package&rsquo;s current price; retail
              amounts are the total snapshotted at the till. &ldquo;New&rdquo;
              means the customer&rsquo;s first package purchase — retail sales do
              not count towards it. Refunds and manual credit adjustments are not
              counted.
            </p>
          </div>

          <div className="card mt-6 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Record a sale</h2>
            <RecordSale
              products={products}
              customers={customerOptions}
              studios={studioOptions}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
