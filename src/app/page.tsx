// ============================================================================
// Public landing page. Signed-in users are sent straight to their dashboard.
// Signed-out visitors get the interactive Recharged landing, seeded with each
// studio's real upcoming lineup. The query runs on the service client because
// this page is unauthenticated — RLS would otherwise hide the schedule from an
// anonymous visitor. Only public class info is read (no personal data).
// ============================================================================
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { getProfile, homePathForRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import LandingExperience, {
  type LandingClass,
  type LandingStudio,
} from "./LandingExperience";

export const dynamic = "force-dynamic";

// Copy that has no home in the database yet. Keyed by studio slug so a new
// studio still renders (it just falls back to a generic blurb).
const STUDIO_COPY: Record<string, { short: string; blurb: string }> = {
  default: {
    short: "Studio",
    blurb:
      "Small-group reformer Pilates with hands-on coaching. Book a mat, move with intention, leave recharged.",
  },
};

type SessionRow = {
  id: string;
  starts_at: string;
  capacity: number;
  studio: {
    id: string;
    name: string;
    slug: string | null;
    brand_color: string | null;
    timezone: string | null;
    address: string | null;
  } | null;
  class_type: {
    id: string;
    name: string;
    color: string | null;
    credits_cost: number | null;
    description: string | null;
  } | null;
};

export default async function HomePage() {
  const profile = await getProfile();
  if (profile) redirect(homePathForRole(profile.role));

  const service = createServiceClient();
  const { data } = await service
    .from("sessions")
    .select(
      "id,starts_at,capacity, studio:studios(id,name,slug,brand_color,timezone,address), class_type:class_types(id,name,color,credits_cost,description)",
    )
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(200);

  const rows = (data ?? []) as unknown as SessionRow[];

  // Public landing cards also show live occupancy. The service client can count
  // booked rows without exposing any customer details.
  const bookedBySession = new Map<string, number>();
  if (rows.length > 0) {
    const { data: bookedRows } = await service
      .from("bookings")
      .select("session_id")
      .eq("status", "booked")
      .in(
        "session_id",
        rows.map((row) => row.id),
      );

    for (const booking of bookedRows ?? []) {
      const sessionId = (booking as { session_id: string }).session_id;
      bookedBySession.set(
        sessionId,
        (bookedBySession.get(sessionId) ?? 0) + 1,
      );
    }
  }

  // Group by studio, then keep only the first upcoming day per studio so the
  // landing shows one clean lineup rather than every future class.
  const byStudio = new Map<string, LandingStudio>();
  const dayByStudio = new Map<string, string>();

  for (const row of rows) {
    const studio = row.studio;
    const classType = row.class_type;
    if (!studio || !classType) continue;

    const key = studio.slug ?? studio.id;
    const tz = studio.timezone ?? "Asia/Ho_Chi_Minh";
    const day = formatInTimeZone(row.starts_at, tz, "yyyy-MM-dd");

    let entry = byStudio.get(key);
    if (!entry) {
      const copy = STUDIO_COPY[key] ?? STUDIO_COPY.default;
      entry = {
        key,
        name: studio.name,
        short: copy.short === "Studio" ? studio.name : copy.short,
        address: studio.address ?? "",
        accent: studio.brand_color ?? "#7c3aed",
        blurb: copy.blurb,
        classes: [],
        scheduleLabel: formatInTimeZone(row.starts_at, tz, "EEE d MMM"),
      };
      byStudio.set(key, entry);
      dayByStudio.set(key, day);
    }

    // Only the first upcoming day, capped so the grid stays tidy.
    if (dayByStudio.get(key) !== day || entry.classes.length >= 8) continue;

    const cls: LandingClass = {
      name: classType.name,
      description: classType.description ?? "",
      credits: classType.credits_cost ?? 1,
      color: classType.color ?? entry.accent,
      time: formatInTimeZone(row.starts_at, tz, "HH:mm"),
      booked: bookedBySession.get(row.id) ?? 0,
      capacity: row.capacity ?? 4,
    };
    entry.classes.push(cls);
  }

  const studios = [...byStudio.values()];

  // No schedule yet? Still render the landing with a placeholder studio so the
  // hero, pricing, and sign-up calls to action stay live.
  if (studios.length === 0) {
    studios.push({
      key: "recharged",
      name: "Recharged Da Nang",
      short: "Da Nang",
      address: "",
      accent: "#7c3aed",
      blurb: STUDIO_COPY.default.blurb,
      classes: [],
      scheduleLabel: "",
    });
  }

  return <LandingExperience studios={studios} />;
}
