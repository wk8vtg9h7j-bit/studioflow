// ============================================================================
// Customer "My packages" page. Lists the clip-cards the member currently holds,
// reconstructed from credit_ledger.
//
// Remaining credits are per-card, which the ledger doesn't store directly — it
// stores a stream of deltas. We rebuild it by walking the member's ledger
// oldest-first: every credit that came *in* opens a card, and every spend drains
// the oldest still-live card in the same pool (which is how the credits actually
// get consumed in practice).
//
// Credits arrive three ways and all three have to open a card, otherwise the
// list contradicts the balance shown above it: a bought package, a refund when a
// class is cancelled in time, and a manual adjustment from the studio. This
// mirrors credit_balance(), which sums every non-expired delta regardless of
// reason — so the cards always add up to the totals book_session will honour.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import { formatSessionDate } from "@/lib/format";
import { getLocale } from "@/lib/locale-server";

type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  pool: string | null;
  expires_at: string | null;
  created_at: string;
  // Set on booking spends and refunds, but there's no foreign key on this
  // column, so PostgREST can't embed the booking — we resolve it separately.
  booking_id: string | null;
  package: { id: string; name: string; credits: number } | null;
};

// One line in the "Class history" list: a credit movement the member can
// recognise, with the class it belongs to when we can resolve one.
type UsageEntry = {
  id: string;
  at: string;
  credits: number;
  pool: string;
  positive: boolean;
  // What the member should read on the row: the class name when we could
  // resolve one, otherwise a plain description of the movement.
  label: string;
};

type ActivePackage = {
  id: string;
  name: string;
  granted: number;
  remaining: number;
  pool: string;
  expiresAt: string | null;
  // Where the card came from, so the date line only says "Purchased" when the
  // member actually bought it.
  source: "purchase" | "refund" | "adjustment";
  startedAt: string;
};

// The calendar day a ledger row landed on, used to merge rows the member
// thinks of as one event. ISO timestamps sort and compare fine as strings.
const dayKey = (iso: string) => iso.slice(0, 10);

// formatSessionDate throws on an unparseable value: its internal try/catch
// only swaps the timezone, so a bad date fails in both branches. Check the
// value itself before handing it over.
const safeDate = (value: string | null) =>
  value && Number.isFinite(Date.parse(value)) ? formatSessionDate(value) : null;

export default async function MyPackagesPage() {
  const locale = await getLocale();
  const vi = locale === "vi";
  const supabase = await createClient();

  // RLS scopes credit_ledger to the signed-in member, so a plain authed client
  // is all we need. Oldest-first so the drain below consumes in the same order
  // the studio does.
  const { data } = await supabase
    .from("credit_ledger")
    .select(
      "id,delta,reason,pool,expires_at,created_at,booking_id,package:packages(id,name,credits)",
    )
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as LedgerRow[];

  // Spends and refunds carry a booking_id, but credit_ledger has no foreign key
  // on that column, so PostgREST can't embed the booking. Resolve the class
  // names in a second pass and join them in JS.
  const bookingIds = Array.from(
    new Set(
      rows
        .filter((r) => r.booking_id && r.reason !== "purchase")
        .map((r) => r.booking_id as string),
    ),
  );

  const classNameById = new Map<string, string>();
  if (bookingIds.length > 0) {
    // bookings.session_id does have a foreign key, so this embed is fine.
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

  // Authoritative per-pool totals — same function book_session checks against.
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

  // Walk the ledger oldest-first. Every credit in opens a card; every credit out
  // drains the oldest still-live card in the same pool.
  const buckets: ActivePackage[] = [];

  // What each booking's spend took and from which cards, so the refund we see
  // later can put those credits back where they came from instead of opening a
  // fresh card every time someone cancels in time.
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

      // Anything we couldn't hand back — a purchase, a studio adjustment, or a
      // refund whose original spend has already expired — becomes its own card.
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
              ? (row.package?.name ?? (vi ? "Gói tập" : "Package"))
              : source === "refund"
                ? (vi ? "Tín dụng được hoàn" : "Credit returned")
                : (vi ? "Tín dụng được thêm" : "Credits added"),
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

  // Only show cards the member can still actually spend.
  const live = buckets.filter((b) => b.remaining > 0 && isLive(b));

  // A studio topping someone up writes one ledger row per credit, so ten credits
  // handed over at once become ten identical cards. Merge the ones the member
  // would read as the same thing — same source, same pool, same name, same
  // expiry, same day — into a single card and add the credits up. Cards that
  // differ in any of those stay apart, because those differences are real.
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

  // Class history: every credit movement that isn't a purchase. The ledger came
  // back oldest-first for the drain above, so reverse it to read newest-first.
  const usageRows: UsageEntry[] = rows
    .filter((r) => r.reason !== "purchase" && r.delta !== 0)
    .map((r) => {
      const className = r.booking_id
        ? (classNameById.get(r.booking_id) ?? null)
        : null;
      const positive = r.delta > 0;

      // Only a movement tied to a booking is a refund. Credits the studio adds
      // by hand aren't "returned" — saying so would be a lie on the row.
      const fallback = positive
        ? r.booking_id
          ? (vi ? "Tín dụng được hoàn" : "Credit returned")
          : (vi ? "Tín dụng được thêm" : "Credits added")
        : (vi ? "Lớp" : "Class");

      return {
        id: r.id,
        at: r.created_at,
        credits: Math.abs(r.delta),
        pool: r.pool ?? "regular",
        positive,
        label: className ?? fallback,
      };
    });

  // A studio handing out ten credits by hand writes ten identical rows. Merge
  // the ones the member would read as one event — same day, same pool, same
  // direction, same label — into a single row and add the credits up.
  const mergedUsageById = new Map<string, UsageEntry>();
  for (const u of usageRows) {
    const key = [dayKey(u.at), u.pool, u.positive ? "+" : "-", u.label].join(
      "|",
    );
    const seen = mergedUsageById.get(key);
    if (seen) {
      seen.credits += u.credits;
    } else {
      mergedUsageById.set(key, { ...u });
    }
  }

  const usage = Array.from(mergedUsageById.values()).reverse();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {vi ? "Gói tập của bạn" : "Your packages"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {vi
            ? "Các gói tín dụng bạn còn có thể sử dụng, sắp xếp theo hạn dùng gần nhất. Tín dụng thường và riêng luôn được tách biệt."
            : "Every clip-card you can still spend, soonest to expire first. Regular and private credits are kept apart and never mix."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-ink-soft">
            {vi ? "Thường" : "Regular"}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            {regularCredits}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {vi
              ? `${regularCredits} tín dụng khả dụng`
              : `${regularCredits} credit${regularCredits === 1 ? "" : "s"} available`}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-ink-soft">
            {vi ? "Riêng" : "Private"}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            {privateCredits}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {vi
              ? `${privateCredits} tín dụng khả dụng`
              : `${privateCredits} credit${privateCredits === 1 ? "" : "s"} available`}
          </p>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-ink-muted">
          {vi ? "Bạn chưa có gói tập đang hoạt động. " : "You don't have any active packages. "}
          <a href="/book" className="font-medium text-ink underline">
            {vi ? "Xem lớp" : "Browse classes"}
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
                        {vi ? "Riêng" : "Private"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink">
                    {safeDate(pkg.expiresAt)
                      ? vi
                        ? `Hết hạn ${safeDate(pkg.expiresAt)}`
                        : `Expires ${safeDate(pkg.expiresAt)}`
                      : vi ? "Không hết hạn" : "No expiry"}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {pkg.source === "purchase"
                      ? vi ? "Đã mua" : "Purchased"
                      : vi ? "Đã thêm" : "Added"}{" "}
                    {safeDate(pkg.startedAt) ?? ""}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold text-ink">
                    {vi ? `Còn ${pkg.remaining}` : `${pkg.remaining} left`}
                  </p>
                  <p className="text-[11px] text-ink-soft">
                    {vi ? `trên ${pkg.granted}` : `of ${pkg.granted}`}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {vi ? "Lịch sử lớp" : "Class history"}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {vi
              ? "Mọi tín dụng bạn đã sử dụng hoặc được hoàn, mới nhất trước."
              : "Every credit you've spent or had returned, newest first."}
          </p>
        </div>

        {usage.length === 0 ? (
          <div className="card px-5 py-10 text-center text-sm text-ink-muted">
            {vi ? "Bạn chưa sử dụng tín dụng nào." : "You haven't used any credits yet."}
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
                      {u.pool === "private" ? (vi ? " · Riêng" : " · Private") : ""}
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
