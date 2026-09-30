// ============================================================================
// Shared customer analytics for the admin CRM / dashboard.
//
// Everything here is read-only. It derives balances, visits, spend and marketing
// segments from the existing ledger/bookings/sales tables so Preview can add
// richer CRM features without changing the live database schema.
// ============================================================================

export type AnalyticsCustomer = {
  id: string;
  profile_id: string | null;
  status: string;
  tags: string[];
  notes: string | null;
  date_of_birth: string | null;
  emergency_contact: string | null;
  marketing_opt_in: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  profile: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export type AnalyticsLedgerRow = {
  id: string;
  customer_id: string;
  delta: number;
  reason: string;
  pool: string | null;
  expires_at: string | null;
  created_at: string;
  sale_amount_cents: number | null;
  sale_currency: string | null;
  package_id: string | null;
};

export type AnalyticsBookingRow = {
  id: string;
  customer_id: string;
  status: string;
  spots_count: number | null;
  booked_at: string;
  session: {
    id: string;
    starts_at: string;
    ends_at: string;
    studio_id: string;
    status: string;
  } | null;
};

export type AnalyticsSaleRow = {
  customer_id: string | null;
  total_cents: number;
  currency: string | null;
  created_at: string;
};

export type CustomerSegmentKey =
  | "never_visited"
  | "registered_never_booked"
  | "zero_credits"
  | "one_credit"
  | "expiring_7d"
  | "inactive_14"
  | "inactive_30"
  | "inactive_60"
  | "first_visit_no_package"
  | "package_almost_finished"
  | "private_clients"
  | "high_value";

export const CUSTOMER_SEGMENTS: Array<{
  key: CustomerSegmentKey;
  label: string;
  shortLabel: string;
  description: string;
  campaign: string;
}> = [
  {
    key: "registered_never_booked",
    label: "Registered, never booked",
    shortLabel: "Never booked",
    description: "Created a customer record but never made a class booking.",
    campaign: "Activation offer / first-class reminder",
  },
  {
    key: "never_visited",
    label: "Never attended",
    shortLabel: "Never attended",
    description: "Has no attended class on record.",
    campaign: "First-visit conversion campaign",
  },
  {
    key: "zero_credits",
    label: "0 credits",
    shortLabel: "0 credits",
    description: "Has no currently usable regular or private credits.",
    campaign: "Package purchase / comeback offer",
  },
  {
    key: "one_credit",
    label: "1 credit remaining",
    shortLabel: "1 credit",
    description: "Has exactly one currently usable credit across both pools.",
    campaign: "Use your last credit + package upgrade",
  },
  {
    key: "expiring_7d",
    label: "Credits expiring in 7 days",
    shortLabel: "Expiring soon",
    description: "Has at least one unused credit bucket expiring within 7 days.",
    campaign: "Expiry reminder",
  },
  {
    key: "inactive_14",
    label: "No visit in 14+ days",
    shortLabel: "Inactive 14d",
    description: "Previously attended, but not in the last 14 days.",
    campaign: "Light re-engagement",
  },
  {
    key: "inactive_30",
    label: "No visit in 30+ days",
    shortLabel: "Inactive 30d",
    description: "Previously attended, but not in the last 30 days.",
    campaign: "Win-back campaign",
  },
  {
    key: "inactive_60",
    label: "No visit in 60+ days",
    shortLabel: "Inactive 60d",
    description: "Previously attended, but not in the last 60 days.",
    campaign: "Stronger comeback offer",
  },
  {
    key: "first_visit_no_package",
    label: "First visit, no package",
    shortLabel: "1 visit / no package",
    description: "Completed exactly one attended visit and has never bought a package.",
    campaign: "Post-first-class package conversion",
  },
  {
    key: "package_almost_finished",
    label: "Package almost finished",
    shortLabel: "Low package balance",
    description: "Has bought a package and has only 1–2 total usable credits left.",
    campaign: "Early renewal / upgrade",
  },
  {
    key: "private_clients",
    label: "Private clients",
    shortLabel: "Private",
    description: "Has private credits or has previously purchased private credits.",
    campaign: "Private-session retention / upsell",
  },
  {
    key: "high_value",
    label: "High-value customers",
    shortLabel: "High value",
    description: "Top 20% of customers by recorded lifetime spend.",
    campaign: "VIP retention / priority offers",
  },
];

export type CustomerAnalytics = {
  customer: AnalyticsCustomer;
  name: string;
  email: string | null;
  phone: string | null;
  regularCredits: number;
  privateCredits: number;
  totalCredits: number;
  expiringCredits7d: number;
  visits: number;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  nextBookingAt: string | null;
  bookingsCount: number;
  packagePurchases: number;
  totalSpendCents: number;
  spendCurrency: string;
  daysSinceLastVisit: number | null;
  segments: CustomerSegmentKey[];
};

type Bucket = {
  remaining: number;
  expiresAt: number | null;
};

export function buildCustomerAnalytics(
  customers: AnalyticsCustomer[],
  ledgerRows: AnalyticsLedgerRow[],
  bookingRows: AnalyticsBookingRow[],
  salesRows: AnalyticsSaleRow[],
  now = new Date(),
): CustomerAnalytics[] {
  const nowMs = now.getTime();
  const sevenDaysMs = 7 * 86_400_000;

  const ledgerByCustomer = new Map<string, AnalyticsLedgerRow[]>();
  for (const row of ledgerRows) {
    const rows = ledgerByCustomer.get(row.customer_id) ?? [];
    rows.push(row);
    ledgerByCustomer.set(row.customer_id, rows);
  }

  const bookingsByCustomer = new Map<string, AnalyticsBookingRow[]>();
  for (const row of bookingRows) {
    const rows = bookingsByCustomer.get(row.customer_id) ?? [];
    rows.push(row);
    bookingsByCustomer.set(row.customer_id, rows);
  }

  const salesByCustomer = new Map<string, AnalyticsSaleRow[]>();
  for (const row of salesRows) {
    if (!row.customer_id) continue;
    const rows = salesByCustomer.get(row.customer_id) ?? [];
    rows.push(row);
    salesByCustomer.set(row.customer_id, rows);
  }

  const base = customers.map((customer) => {
    const ledger = [...(ledgerByCustomer.get(customer.id) ?? [])].sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        a.id.localeCompare(b.id),
    );

    const poolBuckets = new Map<string, Bucket[]>([
      ["regular", []],
      ["private", []],
    ]);

    for (const row of ledger) {
      const pool = row.pool ?? "regular";
      const buckets = poolBuckets.get(pool) ?? [];

      if (row.delta > 0) {
        buckets.push({
          remaining: row.delta,
          expiresAt: row.expires_at ? Date.parse(row.expires_at) : null,
        });
        poolBuckets.set(pool, buckets);
        continue;
      }

      if (row.delta >= 0) continue;

      let owed = -row.delta;
      const spentAt = Date.parse(row.created_at);
      for (const bucket of buckets) {
        if (owed <= 0) break;
        if (bucket.remaining <= 0) continue;
        if (bucket.expiresAt !== null && bucket.expiresAt <= spentAt) continue;

        const take = Math.min(owed, bucket.remaining);
        bucket.remaining -= take;
        owed -= take;
      }
    }

    function liveBalance(pool: "regular" | "private") {
      return (poolBuckets.get(pool) ?? []).reduce((sum, bucket) => {
        if (bucket.remaining <= 0) return sum;
        if (bucket.expiresAt !== null && bucket.expiresAt <= nowMs) return sum;
        return sum + bucket.remaining;
      }, 0);
    }

    const regularCredits = liveBalance("regular");
    const privateCredits = liveBalance("private");
    const totalCredits = regularCredits + privateCredits;

    const expiringCredits7d = ["regular", "private"].reduce(
      (total, pool) =>
        total +
        (poolBuckets.get(pool) ?? []).reduce((sum, bucket) => {
          if (bucket.remaining <= 0 || bucket.expiresAt === null) return sum;
          if (bucket.expiresAt <= nowMs) return sum;
          if (bucket.expiresAt > nowMs + sevenDaysMs) return sum;
          return sum + bucket.remaining;
        }, 0),
      0,
    );

    const bookings = bookingsByCustomer.get(customer.id) ?? [];
    const attended = bookings
      .filter((booking) => booking.status === "attended" && booking.session)
      .sort(
        (a, b) =>
          Date.parse(a.session!.starts_at) - Date.parse(b.session!.starts_at),
      );

    const visits = attended.reduce(
      (sum, booking) => sum + (booking.spots_count ?? 1),
      0,
    );

    const firstVisitAt = attended[0]?.session?.starts_at ?? null;
    const lastVisitAt =
      attended.length > 0
        ? attended[attended.length - 1]?.session?.starts_at ?? null
        : null;

    const nextBookingAt =
      bookings
        .filter(
          (booking) =>
            booking.status === "booked" &&
            booking.session &&
            Date.parse(booking.session.starts_at) > nowMs,
        )
        .sort(
          (a, b) =>
            Date.parse(a.session!.starts_at) - Date.parse(b.session!.starts_at),
        )[0]?.session?.starts_at ?? null;

    const packageRows = ledger.filter((row) => row.reason === "purchase");
    const packageSpend = packageRows.reduce(
      (sum, row) => sum + (row.sale_amount_cents ?? 0),
      0,
    );
    const retailRows = salesByCustomer.get(customer.id) ?? [];
    const retailSpend = retailRows.reduce(
      (sum, row) => sum + (row.total_cents ?? 0),
      0,
    );

    const spendCurrency =
      packageRows.find((row) => row.sale_currency)?.sale_currency ??
      retailRows.find((row) => row.currency)?.currency ??
      "VND";

    const daysSinceLastVisit =
      lastVisitAt === null
        ? null
        : Math.floor((nowMs - Date.parse(lastVisitAt)) / 86_400_000);

    const hadPrivatePurchase = ledger.some(
      (row) => row.reason === "purchase" && (row.pool ?? "regular") === "private",
    );

    return {
      customer,
      name:
        customer.profile?.full_name ??
        customer.name ??
        customer.profile?.email ??
        customer.email ??
        "Unnamed customer",
      email: customer.profile?.email ?? customer.email ?? null,
      phone: customer.profile?.phone ?? customer.phone ?? null,
      regularCredits,
      privateCredits,
      totalCredits,
      expiringCredits7d,
      visits,
      firstVisitAt,
      lastVisitAt,
      nextBookingAt,
      bookingsCount: bookings.length,
      packagePurchases: packageRows.length,
      totalSpendCents: packageSpend + retailSpend,
      spendCurrency,
      daysSinceLastVisit,
      hadPrivatePurchase,
    };
  });

  const spenders = base
    .map((row) => row.totalSpendCents)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const highValueThreshold =
    spenders.length === 0
      ? Number.POSITIVE_INFINITY
      : spenders[Math.max(0, Math.floor((spenders.length - 1) * 0.8))];

  return base.map((row) => {
    const segments: CustomerSegmentKey[] = [];

    if (row.bookingsCount === 0) segments.push("registered_never_booked");
    if (row.visits === 0) segments.push("never_visited");
    if (row.totalCredits === 0) segments.push("zero_credits");
    if (row.totalCredits === 1) segments.push("one_credit");
    if (row.expiringCredits7d > 0) segments.push("expiring_7d");

    if (row.daysSinceLastVisit !== null) {
      if (row.daysSinceLastVisit >= 14) segments.push("inactive_14");
      if (row.daysSinceLastVisit >= 30) segments.push("inactive_30");
      if (row.daysSinceLastVisit >= 60) segments.push("inactive_60");
    }

    if (row.visits === 1 && row.packagePurchases === 0) {
      segments.push("first_visit_no_package");
    }
    if (
      row.packagePurchases > 0 &&
      row.totalCredits >= 1 &&
      row.totalCredits <= 2
    ) {
      segments.push("package_almost_finished");
    }
    if (row.privateCredits > 0 || row.hadPrivatePurchase) {
      segments.push("private_clients");
    }
    if (
      row.totalSpendCents > 0 &&
      row.totalSpendCents >= highValueThreshold
    ) {
      segments.push("high_value");
    }

    const { hadPrivatePurchase: _hadPrivatePurchase, ...safe } = row;
    return { ...safe, segments };
  });
}

export function segmentMeta(key: string | undefined) {
  return CUSTOMER_SEGMENTS.find((segment) => segment.key === key) ?? null;
}
