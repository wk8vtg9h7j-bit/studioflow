// ============================================================================
// Customer "My packages" page. Lists the clip-cards the member currently holds:
// each purchase row in credit_ledger with reason='purchase', joined to the
// package it came from.
//
// Remaining credits are per-purchase, which the ledger doesn't store directly —
// it stores a stream of deltas. We reconstruct it by walking the member's ledger
// oldest-first and draining spends against the oldest non-expired purchase in
// the same pool (which is how the credits actually get consumed in practice).
// The authoritative pool totals still come from the credit_balance() RPC, so the
// summary figures can never drift from what book_session will honour.
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
  package: { id: string; name: string; credits: number } | null;
};

type ActivePackage = {
  id: string;
  name: string;
  granted: number;
  remaining: number;
  pool: string;
  expiresAt: string | null;
  purchasedAt: string;
};

export default async function MyPackagesPage() {
  const cookieStore = await cookies();
  const dict = getDict(localeFromCookieString(cookieStore.toString()));
  const supabase = await createClient();

  // RLS scopes credit_ledger to the signed-in member, so a plain authed client
  // is all we need. Oldest-first so the drain below consumes in the same order
  // the studio does.
  const { data } = await supabase
    .from("credit_ledger")
    .select(
      "id,delta,reason,pool,expires_at,created_at,package:packages(id,name,credits)",
    )
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as LedgerRow[];

  // Authoritative per-pool totals — same function book_session checks against.
  const { data: customerId } = await supabase.rpc("my_customer_id");
  let regularCredits = 0;
  let privateCredits = 0;
  if (customerId) {
    const { data: regular } = await supabase.rpc("credit_balance", {
      p_customer: customerId,
      p_pool: "regular",
    });
    const { data: privatePool } = await supabase.rpc("credit_balance", {
      p_customer: customerId,
      p_pool: "private",
    });
    regularCredits = typeof regular === "number" ? regular : 0;
    privateCredits = typeof privatePool === "number" ? privatePool : 0;
  }

  const nowMs = Date.now();
  const isLive = (r: { expiresAt: string | null }) =>
    !r.expiresAt || Date.parse(r.expiresAt) > nowMs;

  // Walk the ledger oldest-first. Purchases open a bucket; every negative delta
  // drains the oldest still-live bucket in the same pool.
  const buckets: ActivePackage[] = [];
  for (const row of rows) {
    const pool = row.pool ?? "regular";

    if (row.delta > 0 && row.reason === "purchase") {
      buckets.push({
        id: row.id,
        name: row.package?.name ?? "Package",
        granted: row.delta,
        remaining: row.delta,
        pool,
        expiresAt: row.expires_at,
        purchasedAt: row.created_at,
      });
      continue;
    }

    if (row.delta < 0) {
      let owed = -row.delta;
      for (const b of buckets) {
        if (owed <= 0) break;
        if (b.pool !== pool || b.remaining <= 0 || !isLive(b)) continue;
        const take = Math.min(owed, b.remaining);
        b.remaining -= take;
        owed -= take;
      }
    }
  }

  // Only show cards the member can still actually spend.
  const active = buckets
    .filter((b) => b.remaining > 0 && isLive(b))
    .sort((a, b) => {
      const ax = a.expiresAt ? Date.parse(a.expiresAt) : Infinity;
      const bx = b.expiresAt ? Date.parse(b.expiresAt) : Infinity;
      return ax - bx;
    });

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
                  <p className="mt-1 text-xs text-ink-muted">
                    {dict.packages_purchased(
                      formatSessionDate(pkg.purchasedAt),
                    )}
                    {" · "}
                    {pkg.expiresAt
                      ? dict.packages_expires(formatSessionDate(pkg.expiresAt))
                      : dict.packages_no_expiry}
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
    </div>
  );
}
