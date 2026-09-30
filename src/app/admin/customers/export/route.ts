import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { loadCustomerAnalytics } from "@/lib/customerAnalytics.server";
import { segmentMeta } from "@/lib/customerAnalytics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireRole("admin", "/admin/customers");

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const segment = segmentMeta(url.searchParams.get("segment") ?? undefined)?.key;

  const analytics = await loadCustomerAnalytics();
  const rows = analytics.filter((row) => {
    if (!row.email) return false;
    if (status && row.customer.status !== status) return false;
    if (segment && !row.segments.includes(segment)) return false;
    if (!q) return true;

    const haystack = [
      row.name,
      row.email,
      row.phone,
      ...(row.customer.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  const header = [
    "Name",
    "Email",
    "Phone",
    "Status",
    "Marketing opt-in",
    "Regular credits",
    "Private credits",
    "Total visits",
    "Last visit",
    "Next booking",
    "Lifetime spend",
    "Currency",
    "Segments",
  ];

  const csv = [
    header,
    ...rows.map((row) => [
      row.name,
      row.email ?? "",
      row.phone ?? "",
      row.customer.status,
      row.customer.marketing_opt_in ? "Yes" : "No",
      row.regularCredits,
      row.privateCredits,
      row.visits,
      row.lastVisitAt ?? "",
      row.nextBookingAt ?? "",
      row.totalSpendCents,
      row.spendCurrency,
      row.segments.join("; "),
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

  const filename = segment
    ? `studioflow-${segment}-customers.csv`
    : "studioflow-customers.csv";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
