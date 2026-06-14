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
import { formatMoney } from "@/lib/format";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const TZ = "Asia/Ho_Chi_Minh";

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
  name: string;
  packageName: string;
  amount: number;
  currency: string;
  method: Method;
  isNew: boolean;
  time: string;
};

type Attendee = { name: string; klass: string; time: string; status: string };

type DayGroup = {
  date: string;
  label: string;
  payments: Payment[];
  total: number;
  currency: string;
  attendees: Attendee[];
};

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

export default async function PaymentsPage() {
  const supabase = await createClient();

  const [{ data: purchaseData }, { data: attendData }] = await Promise.all([
    supabase
      .from("credit_ledger")
      .select(
        `id, created_at, customer_id, payment_method,
         package:packages ( name, price_cents, currency ),
         customer:customers ( name, email, profile:profiles ( full_name, email ) )`,
      )
      .eq("reason", "purchase")
      .order("created_at", { ascending: true }),
    supabase
      .from("bookings")
      .select(
        `status,
         session:sessions ( starts_at, title ),
         customer:customers ( name, email, profile:profiles ( full_name, email ) )`,
      )
      .in("status", ["booked", "attended"]),
  ]);

  const purchases = (purchaseData ?? []) as unknown as PurchaseRow[];
  const attendance = (attendData ?? []) as unknown as AttendRow[];

  // First-purchase-per-customer => "New". Computed over the ascending list.
  const seen = new Set<string>();
  const isNew = new Map<string, boolean>();
  for (const p of purchases) {
    const first = !seen.has(p.customer_id);
    isNew.set(p.id, first);
    seen.add(p.customer_id);
  }

  const groups = new Map<string, DayGroup>();
  const dayOf = (iso: string) => formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");
  const ensureDay = (date: string, iso: string): DayGroup => {
    let g = groups.get(date);
    if (!g) {
      g = {
        date,
        label: formatInTimeZone(new Date(iso), TZ, "EEEE, d MMM yyyy"),
        payments: [],
        total: 0,
        currency: "VND",
        attendees: [],
      };
      groups.set(date, g);
    }
    return g;
  };

  for (const row of purchases) {
    const date = dayOf(row.created_at);
    const g = ensureDay(date, row.created_at);
    const amount = row.package?.price_cents ?? 0;
    g.currency = row.package?.currency ?? g.currency;
    g.total += amount;
    g.payments.push({
      id: row.id,
      name: nameOf(row.customer),
      packageName: row.package?.name ?? "Package",
      amount,
      currency: row.package?.currency ?? "VND",
      method: methodOf(row.payment_method),
      isNew: isNew.get(row.id) ?? false,
      time: formatInTimeZone(new Date(row.created_at), TZ, "h:mm a"),
    });
  }

  for (const row of attendance) {
    if (!row.session) continue;
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

  const currency = purchases.at(-1)?.package?.currency ?? "VND";
  const grandTotal = purchases.reduce(
    (s, p) => s + (p.package?.price_cents ?? 0),
    0,
  );
  const todayKey = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const monthKey = formatInTimeZone(new Date(), TZ, "yyyy-MM");
  const todayTotal = groups.get(todayKey)?.total ?? 0;
  const monthTotal = days
    .filter((d) => d.date.startsWith(monthKey))
    .reduce((s, d) => s + d.total, 0);

  // Method breakdown + new/returning counts across all payments.
  const byMethod: Record<Method, number> = { qr: 0, card: 0, cash: 0, unrecorded: 0 };
  let newCount = 0;
  let returningCount = 0;
  for (const p of purchases) {
    byMethod[methodOf(p.payment_method)] += p.package?.price_cents ?? 0;
    if (isNew.get(p.id)) newCount++;
    else returningCount++;
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Daily payments
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Package sales and class attendance, grouped by day — so takings can be
          reconciled against who came in.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="space-y-6 lg:col-span-2">
          {days.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No payments or attendance recorded yet.
            </div>
          ) : (
            days.map((day) => (
              <div key={day.date} className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-5 py-3">
                  <h2 className="text-sm font-semibold text-ink">{day.label}</h2>
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {formatMoney(day.total, day.currency)}
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
                        className="flex items-center justify-between px-5 py-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-ink">
                              {p.name}
                            </p>
                            <span
                              className={`badge ${p.isNew ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-ink-muted"}`}
                            >
                              {p.isNew ? "New" : "Returning"}
                            </span>
                          </div>
                          <p className="truncate text-xs text-ink-muted">
                            {p.packageName} · {p.time}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
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
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="truncate text-ink">{a.name}</span>
                          <span className="shrink-0 text-ink-muted">
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
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">At a glance</h2>
            <dl className="space-y-3">
              <SummaryStat label="Today" value={formatMoney(todayTotal, currency)} />
              <SummaryStat label="This month" value={formatMoney(monthTotal, currency)} />
              <SummaryStat label="Payments" value={purchases.length} />
            </dl>

            <div className="my-5 h-px bg-stone-200" />
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              By payment method
            </p>
            <dl className="space-y-3">
              <SummaryStat label="QR" value={formatMoney(byMethod.qr, currency)} />
              <SummaryStat label="Card" value={formatMoney(byMethod.card, currency)} />
              <SummaryStat label="Cash" value={formatMoney(byMethod.cash, currency)} />
              {byMethod.unrecorded > 0 && (
                <SummaryStat
                  label="Unrecorded"
                  value={formatMoney(byMethod.unrecorded, currency)}
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
              <SummaryStat label="All time" value={formatMoney(grandTotal, currency)} />
            </dl>

            <p className="mt-5 text-xs text-ink-soft">
              Amounts come from each package&rsquo;s price. &ldquo;New&rdquo; means
              the customer&rsquo;s first purchase. Refunds and manual credit
              adjustments are not counted.
            </p>
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
