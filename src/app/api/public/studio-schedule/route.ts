import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// How far ahead to look when deriving the weekly pattern. Four weeks is enough
// to see every recurring slot without being thrown by a single cancellation.
const WEEKLY_HORIZON_DAYS = 28;

// Only public, regular group-class schedules for these two studios.
// No booking, customer, instructor or authentication data leaves this route.
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("studio");
  if (slug !== "hideaway-pilates" && slug !== "downtown-pilates") {
    return NextResponse.json({ error: "Unknown studio" }, { status: 400 });
  }
  try {
    const service = createServiceClient();
    const { data: studio, error: studioError } = await service
      .from("studios").select("id,timezone").eq("slug", slug)
      .eq("active", true).eq("private_only", false).maybeSingle();
    if (studioError) throw studioError;
    if (!studio) return NextResponse.json({ classes: [] });

    const { id: studioId, timezone } = studio as { id: string; timezone: string | null };
    const nowIso = new Date().toISOString();

    const { data, error } = await service.from("sessions")
      .select("starts_at,class_type:class_types!inner(name,pool)")
      .eq("studio_id", studioId)
      .eq("status", "scheduled")
      .eq("class_type.pool", "regular")
      .gt("starts_at", nowIso)
      .order("starts_at", { ascending: true }).limit(8);
    if (error) throw error;
    const rows = (data ?? []) as unknown as { starts_at: string; class_type: { name: string } }[];

    // The weekly grid is derived from the real schedule rather than a hardcoded
    // table, so a time change at the studio cannot leave the public login page
    // advertising a class that no longer runs.
    const horizon = new Date(Date.now() + WEEKLY_HORIZON_DAYS * 86_400_000).toISOString();
    const { data: upcoming, error: upcomingError } = await service.from("sessions")
      .select("starts_at,class_type:class_types!inner(pool)")
      .eq("studio_id", studioId)
      .eq("status", "scheduled")
      .eq("class_type.pool", "regular")
      .gt("starts_at", nowIso)
      .lt("starts_at", horizon)
      .order("starts_at", { ascending: true }).limit(500);
    if (upcomingError) throw upcomingError;

    const zone = timezone || "Asia/Ho_Chi_Minh";
    const parts = new Intl.DateTimeFormat("en-GB", {
      weekday: "short", hour: "2-digit", minute: "2-digit",
      hourCycle: "h23", timeZone: zone,
    });
    const weekdayTimes = new Set<string>();
    const weekendTimes = new Set<string>();
    for (const row of (upcoming ?? []) as { starts_at: string }[]) {
      const bits = parts.formatToParts(new Date(row.starts_at));
      const day = bits.find((p) => p.type === "weekday")?.value;
      const hour = bits.find((p) => p.type === "hour")?.value;
      const minute = bits.find((p) => p.type === "minute")?.value;
      if (!day || !hour || !minute) continue;
      const time = `${hour}:${minute}`;
      if (day === "Sat" || day === "Sun") weekendTimes.add(time);
      else weekdayTimes.add(time);
    }

    return NextResponse.json({
      classes: rows.map((row) => ({ startsAt: row.starts_at, name: row.class_type.name })),
      weekly: {
        weekdayTimes: [...weekdayTimes].sort(),
        weekendTimes: [...weekendTimes].sort(),
      },
    }, {
      // Public, non-personalised data. A short shared cache keeps the login page
      // off the database on every view while staying current within the minute.
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ error: "Schedule temporarily unavailable" }, { status: 503 });
  }
}
