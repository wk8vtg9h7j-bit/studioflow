import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
      .from("studios").select("id").eq("slug", slug)
      .eq("active", true).eq("private_only", false).maybeSingle();
    if (studioError) throw studioError;
    if (!studio) return NextResponse.json({ classes: [] });
    const { data, error } = await service.from("sessions")
      .select("starts_at,class_type:class_types!inner(name,pool)")
      .eq("studio_id", studio.id)
      .eq("status", "scheduled")
      .eq("class_type.pool", "regular")
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true }).limit(8);
    if (error) throw error;
    const rows = (data ?? []) as unknown as { starts_at: string; class_type: { name: string } }[];
    return NextResponse.json({
      classes: rows.map((row) => ({ startsAt: row.starts_at, name: row.class_type.name })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Schedule temporarily unavailable" }, { status: 503 });
  }
}
