// ============================================================================
// Customer "My packages" page. Reconstructs active credit cards from the ledger
// and shows a readable class-credit history while preserving the current
// production locale behavior.
// ============================================================================
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getDict, localeFromCookieString } from "@/lib/i18n";
import { formatSessionDate } from "@/lib/format";

type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  pool: string | null;
  expires_at: string | null;
  created_at: string;
  booking_id: string | null;
  package: { id: string; name: string; credits: number } | null;
};

type UsageEntry = {
  id: string;
  at: string;
  credits: number;
  pool: string;
  positive: boolean;
  label: string;
};

type ActivePackage = {
  id: string;
  name: string;
  granted: number;
  remaining: number;
  pool: string;
  expiresAt: string | null;
  source: "purchase" | "refund" | "adjustment";
  startedAt: string;
};

const dayKey = (iso: string) => iso.slice(0, 10);
const safeDate = (value: string | null) =>
  value && Number.isFinite(Date.parse(value)) ? formatSessionDate(value) : null;

export default async function MyPackagesPage() {
  const cookieStore = await cookies();
  const locale = localeFromCookieString(cookieStore.toString());
  const dict = getDict(locale);
  const extra =
    locale === "vi"
      ? {
          returned: "Tín dụng được hoàn lại",
          added: "Tín dụng được thêm",
          classFallback: "Lớp học",
          addedAt: "Đã thêm",
          historyTitle: "Lịch sử tín dụng",
          historyIntro: "Các tín dụng bạn đã dùng hoặc được hoàn lại, mới nhất trước.",
          historyEmpty: "Bạn chưa sử dụng tín dụng nào.",
        }
      : {
          returned: "Credit returned",
          added: "Credits added",
          classFallback: "Class",
          addedAt: "Added",
          historyTitle: "Class history",
          historyIntro: "Every credit you've spent or had returned, newest first.",
          historyEmpty: "You haven't used any credits yet.",
        };

  const supabase = await createClient();
  const { data } = await supabase
    .from("credit_ledger")
    .select(
      "id,delta,reason,pool,expires_at,created_at,booking_id,package:packages(id,name,credits)",
    )
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as LedgerRow[];

  const bookingIds = Array.from(
    new Set(
      rows
        .filter((r) => r.booking_id && r.reason !== "purchase")
        .map((r) => r.booking_id as string),
    ),
  );

  const classNameById = new Map<string, string>();
  if (bookingIds.length > 0) {
    const { data: bookingRows } = await supabase
      .from("bookings")
      .select("id,session:sessions(title,class_type:class_types(name))")
      .in("id", bookingIds);

    const resolved = (bookingRows ?? []) as unknown as {
      id: string;
      session: {
        title: string | null;
        class_type: { name: string } | null;
      } | null;
    }[];

    for (const b of resolved) {
      const name = b.session?.title || b.session?.class_type?.name;
      if (name) classNameById.set(b.id, name);
    }
  }

  const { data: customerId } = await supabase.rpc("my_customer_id");
  let regularCredits = 0;
  let privateCredits = 0;
  if (customerId) {
    const [regularRes, privateRes] = await Promise.all([
      supabase.rpc("credit_balance", {
        p_customer: customerId,
        p_pool: "regular",
      }),
      supabase.rpc("credit_balance", {
        p_customer: customerId,
        p_pool: "private",
      }),
    ]);
    regularCredits = typeof regularRes.data === "number" ? regularRes.data : 0;
    privateCredits = typeof privateRes.data === "number" ? privateRes.data : 0;
  }

  const nowMs = Date.now();
  const isLive = (r: { expiresAt: string | null }) =>
    !r.expiresAt || Date.parse(r.expiresAt) > nowMs;

  const buckets: ActivePackage[] = [];
  const drained = new Map<string, { bucket: ActivePackage; amount: number }[]>();

  for (const row of rows) {
    const pool = row.pool ?? "regular";

    if (row.delta > 0) {
      let left = row.delta;
      const taken = row.booking_id ? drained.get(row.booking_id) : undefined;
      if (taken && row.booking_id) {
        for (const t of taken) {
          if (left <= 0) break;
          const give = Math.min(left, t.amount);
          t.bucket.remaining += give;
          t.amount -= give;
          left -= give;
        }
        drained.delete(row.booking_id);
      }

      if (left > 0) {
        const source: ActivePackage["source"] =
          row.reason === "purchase"
            ? "purchase"
            : row.booking_id
              ? "refund"
              : "adjustment";
        buckets.push({
          id: row.id,
          name:
            source === "purchase"
              ? (row.package?.name ?? "Package")
              : source === "refund"
                ? extra.returned
                : extra.added,
          granted: left,
          remaining: left,
          pool,
          expiresAt: row.expires_at,
          source,
          startedAt: row.created_at,
        });
      }
      continue;
    }

    if (row.delta < 0) {
      let owed = -row.delta;
      const took: { bucket: ActivePackage; amount: number }[] = [];
      for (const b of buckets) {
        if (owed <= 0) break;
        if (b.pool !== pool || b.remaining <= 0 || !isLive(b)) continue;
        const take = Math.min(owed, b.remaining);
        b.remaining -= take;
        owed -= take;
        took.push({ bucket: b, amount: take });
      }
      if (row.booking_id && took.length > 0) drained.set(row.booking_id, took);
    }
  }

  const live = buckets.filter((b) => b.remaining > 0 && isLive(b));
  const mergedById = new Map<string, ActivePackage>();
  for (const b of live) {
    const key = [
      b.source,
      b.pool,
      b.name,
      b.expiresAt ?? "none",
      dayKey(b.startedAt),
    ].join("|");
    const seen = mergedById.get(key);
    if (seen) {
      seen.granted += b.granted;
      seen.remaining += b.remaining;
    } else {
      mergedById.set(key, { ...b });
    }
  }

  const active = Array.from(mergedById.values()).sort((a, b) => {
    const ax = a.expiresAt ? Date.parse(a.expiresAt) : Infinity;
    const bx = b.expiresAt ? Date.parse(b.expiresAt) : Infinity;
    return ax - bx;
  });

  const usageRows: UsageEntry[] = rows
    .filter((r) => r.reason !== "purchase" && r.delta !== 0)
    .map((r) => {
      const className = r.booking_id
        ? (classNameById.get(r.booking_id) ?? null)
        : null;
      const positive = r.delta > 0;
      const fallback = positive
        ? r.booking_id
          ? extra.returned
          : extra.added
        : extra.classFallback;
      return {
        id: r.id,
        at: r.created_at,
        credits: Math.abs(r.delta),
        pool: r.pool ?? "regular",
        positive,
        label: className ?? fallback,
      };
    });

  const mergedUsageById = new Map<string, UsageEntry>();
  for (const u of usageRows) {
    const key = [dayKey(u.at), u.pool, u.positive ? "+" : "-", u.label].join("|");
    const seen = mergedUsageById.get(key);
    if (seen) seen.credits += u.credits;
    else mergedUsageById.set(key, { ...u });
  }
  const usage = Array.from(mergedUsageById.values()).reverse();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {dict.packages_title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{dict.packages_intro}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-ink-soft">
            {dict.packages_pool_regular}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            {regularCredits}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {dict.credits_available(regularCredits)}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-ink-soft">
            {dict.packages_pool_private}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            {privateCredits}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {dict.credits_available(privateCredits)}
          </p>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-ink-muted">
          {dict.packages_none}{" "}
          <a href="/book" className="font-medium text-ink underline">
            {dict.packages_browse}
          </a>
          .
        </div>
      ) : (
        <ul className="space-y-3">
          {active.map((pkg) => (
            <li key={pkg.id} className="card px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{pkg.name}</p>
                    {pkg.pool === "private" && (
                      <span className="badge bg-brand-50 text-brand-700">
                        {dict.packages_pool_private}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink">
                    {safeDate(pkg.expiresAt)
                      ? dict.packages_expires(safeDate(pkg.expiresAt) as string)
                      : dict.packages_no_expiry}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {pkg.source === "purchase"
                      ? dict.packages_purchased(safeDate(pkg.startedAt) ?? "")
                      : `${extra.addedAt} ${safeDate(pkg.startedAt) ?? ""}`}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold text-ink">
                    {dict.packages_remaining(pkg.remaining)}
                  </p>
                  <p className="text-[11px] text-ink-soft">
                    {dict.packages_of_total(pkg.granted)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{extra.historyTitle}</h2>
          <p className="mt-1 text-sm text-ink-muted">{extra.historyIntro}</p>
        </div>

        {usage.length === 0 ? (
          <div className="card px-5 py-10 text-center text-sm text-ink-muted">
            {extra.historyEmpty}
          </div>
        ) : (
          <ul className="space-y-2">
            {usage.map((u) => (
              <li key={u.id} className="card px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-ink">{u.label}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {safeDate(u.at) ?? ""}
                      {u.pool === "private" ? ` · ${dict.packages_pool_private}` : ""}
                    </p>
                  </div>
                  <p
                    className={`text-sm font-semibold ${
                      u.positive ? "text-emerald-700" : "text-ink"
                    }`}
                  >
                    {u.positive ? "+" : "−"}
                    {u.credits}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
