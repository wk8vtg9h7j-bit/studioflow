// ============================================================================
// GET /api/availability?studio=<slug|uuid>[&date=YYYY-MM-DD]
//
// Public, CORS-enabled read for the marketing sites (hideawaypilates.com,
// downtownpilatesdn.com). Returns each upcoming scheduled class with its live
// seat counts so the static sites can show "X spots left" and link straight
// into /book.
//
// Auth-free by design: it exposes only aggregate seat counts (capacity, booked,
// available) — never who booked. Seat counts must be tallied with the
// service-role client because the bookings RLS policy hides other customers'
// rows, so an anonymous fetch could never count them itself.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Only the two marketing origins may read this cross-origin. Same-origin
// fetches (the CRM itself) don't need CORS at all.
const ALLOWED_ORIGINS = new Set([
  "https://hideawaypilates.com",
  "https://www.hideawaypilates.com",
  "https://downtownpilatesdn.com",
  "https://www.downtownpilatesdn.com",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow || "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

type SessionRow = {
  id: string;
  starts_at: string;
  capacity: number;
  studio_id: string;
  filler_seats: number;
  class_type: { id: string; name: string; credits_cost: number } | null;
};

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));
  const { searchParams } = new URL(req.url);
  const studioParam = searchParams.get("studio") ?? undefined;
  const dateParam = searchParams.get("date") ?? undefined;

  const service = createServiceClient();

  // Resolve a friendly slug (?studio=hideaway) to its UUID; accept a raw UUID
  // too. Without a studio filter we return every studio's classes.
  let studioId: string | undefined;
  if (studioParam) {
    const { data: studio } = await service
      .from("studios")
      .select("id")
      .or(`slug.eq.${studioParam},id.eq.${studioParam}`)
      .maybeSingle();
    if (!studio) {
      // Unknown studio → empty (but valid) payload, not an error.
      return NextResponse.json({ sessions: [] }, { headers: cors });
    }
    studioId = (studio as { id: string }).id;
  }

  const nowIso = new Date().toISOString();

  let query = service
    .from("sessions")
    .select("id,starts_at,capacity,studio_id,filler_seats,class_type:class_types(id,name,credits_cost)")
    .eq("status", "scheduled")
    .gt("starts_at", nowIso);

  if (studioId) query = query.eq("studio_id", studioId);

  // Optional single-day narrowing (Da Nang clock, +07:00).
  if (dateParam) {
    query = query
      .gte("starts_at", `${dateParam}T00:00:00+07:00`)
      .lte("starts_at", `${dateParam}T23:59:59+07:00`);
  }

  const { data: sessionsData } = await query
    .order("starts_at", { ascending: true })
    .limit(200);

  const sessions = (sessionsData ?? []) as unknown as SessionRow[];
  const sessionIds = sessions.map((s) => s.id);

  // Tally booked seats per session with the service-role client (RLS would hide
  // other members' bookings from an anon read).
  const bookedBySession = new Map<string, number>();
  if (sessionIds.length > 0) {
    const { data: seatRows } = await service
      .from("bookings")
      .select("session_id")
      .eq("status", "booked")
      .in("session_id", sessionIds);
    for (const r of (seatRows ?? []) as { session_id: string }[]) {
      bookedBySession.set(
        r.session_id,
        (bookedBySession.get(r.session_id) ?? 0) + 1,
      );
    }
  }

  const payload = sessions.map((s) => {
    // Seats held by reception count as taken, so the marketing site shows the
    // class as full. Folded into `booked` as well as `available` to keep
    // capacity - booked === available true for consumers.
    const booked =
      (bookedBySession.get(s.id) ?? 0) + Math.max(0, s.filler_seats ?? 0);
    const available = Math.max(0, s.capacity - booked);
    return {
      id: s.id,
      starts_at: s.starts_at,
      capacity: s.capacity,
      booked,
      available,
      class_name: s.class_type?.name ?? null,
      credits_cost: s.class_type?.credits_cost ?? null,
    };
  });

  return NextResponse.json(
    { sessions: payload },
    {
      headers: {
        ...cors,
        // Cache at the edge for a minute; seat counts don't need to be
        // real-time on a marketing page and this shields the DB from bursts.
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
