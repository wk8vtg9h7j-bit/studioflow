// ============================================================================
// Admin — CSV export of the Daily Payments tracker.
//
// Mirrors /admin/payments exactly: same date range, same studio timezone, same
// two revenue sources (package purchases from the credit ledger + retail sales),
// same day-key trimming. One row per payment, newest last, so the file can be
// dropped straight into a spreadsheet and summed per currency.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { formatMoney, FALLBACK_TZ } from "@/lib/format";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const DEFAULT_RANGE_DAYS = 30;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Shift a yyyy-MM-dd key by whole days. Parsed as UTC midnight so the arithmetic
// never crosses a DST boundary in the studio's zone.
function shiftDay(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type CustomerRef = {
  name: string | null;
  email: string | null;
  profile: { full_name: string | null; email: string | null } | null;
};

type PurchaseRow = {
  id: string;
  created_at: string;
  payment_method: string | null;
  sale_amount_cents: number | null;
  sale_currency: string | null;
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

function methodOf(raw: string | null): string {
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

// Quote only when the value would otherwise break the row, and double any inner
// quotes — the minimal escaping every spreadsheet agrees on.
function csvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  await requireRole("admin", "/admin/payments");

  const supabase = await createClient();

  // The day axis comes from the studio, exactly as it does on the page itself.
  const { data: studioData } = await supabase
    .from("studios")
    .select("timezone")
    .eq("active", true)
    .order("name", { ascending: true });

  const TZ =
    ((studioData ?? []) as { timezone: string | null }[])[0]?.timezone ||
    FALLBACK_TZ;

  const todayKey = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const rawFrom = request.nextUrl.searchParams.get("from");
  const rawTo = request.nextUrl.searchParams.get("to");
  const fromParam = rawFrom && DAY_KEY.test(rawFrom) ? rawFrom : null;
  const toParam = rawTo && DAY_KEY.test(rawTo) ? rawTo : null;
  const a = fromParam ?? shiftDay(todayKey, -(DEFAULT_RANGE_DAYS - 1));
  const b = toParam ?? todayKey;
  const fromKey = a <= b ? a : b;
  const toKey = a <= b ? b : a;

  // Padded a day either side because created_at is a UTC instant while the keys
  // are wall-clock days; the exact cut happens on day keys below.
  const lowerBound = `${shiftDay(fromKey, -1)}T00:00:00Z`;
  const upperBound = `${shiftDay(toKey, 2)}T00:00:00Z`;

  const [{ data: purchaseData }, { data: saleData }] = await Promise.all([
    supabase
      .from("credit_ledger")
      .select(
        `id, created_at, payment_method, sale_amount_cents, sale_currency,
         package:packages ( name, price_cents, currency ),
         customer:customers ( name, email, profile:profiles ( full_name, email ) )`,
      )
      .eq("reason", "purchase")
      .gte("created_at", lowerBound)
      .lt("created_at", upperBound)
      .order("created_at", { ascending: true }),
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
  ]);

  const purchases = (purchaseData ?? []) as unknown as PurchaseRow[];
  const sales = (saleData ?? []) as unknown as SaleRow[];

  const dayOf = (iso: string) => formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");
  const inRange = (iso: string) => {
    const key = dayOf(iso);
    return key >= fromKey && key <= toKey;
  };

  type Line = {
    at: string;
    date: string;
    time: string;
    type: string;
    customer: string;
    item: string;
    method: string;
    currency: string;
    amount: number;
  };

  const lines: Line[] = [];

  for (const row of purchases) {
    if (!inRange(row.created_at)) continue;
    lines.push({
      at: row.created_at,
      date: dayOf(row.created_at),
      time: formatInTimeZone(new Date(row.created_at), TZ, "HH:mm"),
      type: "package",
      customer: nameOf(row.customer),
      item: row.package?.name ?? "Package",
      method: methodOf(row.payment_method),
      currency: (row.sale_currency ?? row.package?.currency ?? "VND").toUpperCase(),
      amount: row.sale_amount_cents ?? row.package?.price_cents ?? 0,
    });
  }

  for (const row of sales) {
    if (!inRange(row.created_at)) continue;
    lines.push({
      at: row.created_at,
      date: dayOf(row.created_at),
      time: formatInTimeZone(new Date(row.created_at), TZ, "HH:mm"),
      type: "retail",
      customer: nameOf(row.customer),
      item:
        (row.items ?? []).map((i) => `${i.name} x${i.qty}`).join(", ") ||
        "Retail sale",
      method: methodOf(row.payment_method),
      currency: (row.currency || "VND").toUpperCase(),
      amount: row.total_cents,
    });
  }

  lines.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));

  const header = [
    "date",
    "time",
    "type",
    "customer",
    "item",
    "method",
    "currency",
    "amount",
    "amount_display",
  ];

  const body = lines.map((l) =>
    [
      l.date,
      l.time,
      l.type,
      l.customer,
      l.item,
      l.method,
      l.currency,
      l.amount,
      formatMoney(l.amount, l.currency),
    ]
      .map(csvCell)
      .join(","),
  );

  // CRLF and a BOM so Excel opens Vietnamese names in the right encoding.
  const csv = "\uFEFF" + [header.join(","), ...body].join("\r\n") + "\r\n";

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payments-${fromKey}-to-${toKey}.csv"`,
      "cache-control": "no-store",
    },
  });
}
