// ============================================================================
// Public landing page. Signed-in users are sent straight to their dashboard.
//
// Anonymous visitors get the real consumer landing (LandingExperience): the
// two-studio toggle, per-studio accent theming, that studio's schedule for
// TODAY, and the interactive VND pricing schedule.
//
// The schedule is read with the SERVICE client on purpose — the landing renders
// for logged-out visitors, and anon RLS does not grant reads on sessions, so the
// same approach /api/availability takes is the one that works here.
//
// `short` and `blurb` have no database column, so they are derived from the
// studio's name rather than hardcoded per slug.
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

const FALLBACK_TZ = "Asia/Ho_Chi_Minh";

type StudioRow = {
  id: string;
  name: string | null;
  slug: string | null;
  address: string | null;
  timezone: string | null;
  brand_color: string | null;
};

type SessionRow = {
  starts_at: string;
  studio_id: string;
  class_type: {
    name: string | null;
    description: string | null;
    credits_cost: number | null;
    color: string | null;
  } | null;
};

export default async function HomePage() {
  const profile = await getProfile();
  if (profile) redirect(homePathForRole(profile.role));

  const studios = await loadStudios();

  return <LandingExperience studios={studios} />;
}

// Build the landing view model: every active studio, each with the lineup it is
// actually running today. A studio with no classes today still appears (the
// component renders its own "schedule coming soon" state) so the location
// toggle never silently loses a location.
async function loadStudios(): Promise<LandingStudio[]> {
  const supabase = createServiceClient();

  const { data: studioData } = await supabase
    .from("studios")
    .select("id, name, slug, address, timezone, brand_color")
    .eq("active", true)
    .order("created_at", { ascending: true });

  const studioRows = (studioData ?? []) as StudioRow[];
  if (studioRows.length === 0) return [];

  // One window wide enough to cover every studio's "today" regardless of its
  // timezone; each session is then bucketed into the studio it belongs to and
  // filtered against that studio's own local date.
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const { data: sessionData } = await supabase
    .from("sessions")
    .select(
      `starts_at, studio_id,
       class_type:class_types(name, description, credits_cost, color)`,
    )
    .eq("status", "scheduled")
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at", { ascending: true });

  const sessionRows = (sessionData ?? []) as unknown as SessionRow[];

  return studioRows.map((studio) => {
    const tz = studio.timezone || FALLBACK_TZ;
    const today = dayKey(now, tz);

    const classes: LandingClass[] = sessionRows
      .filter(
        (s) =>
          s.studio_id === studio.id && dayKey(new Date(s.starts_at), tz) === today,
      )
      .map((s) => ({
        name: s.class_type?.name ?? "Class",
        description: s.class_type?.description ?? "",
        credits: s.class_type?.credits_cost ?? 1,
        color: s.class_type?.color ?? "#8b5cf6",
        time: safeFormat(new Date(s.starts_at), tz, "h:mm a"),
      }));

    const name = studio.name ?? "Recharged";
    return {
      key: studio.slug ?? studio.id,
      name,
      short: shortName(name),
      address: studio.address ?? "",
      accent: studio.brand_color ?? "#7c3aed",
      blurb: blurbFor(name),
      classes,
      scheduleLabel: safeFormat(now, tz, "EEE d MMM"),
    };
  });
}

// "Hideaway Pilates · Da Nang" → "Hideaway". The toggle pill is narrow, so it
// wants the distinguishing first word, not the full legal name.
function shortName(name: string): string {
  const head = name.split(/[·\-–—,(]/)[0].trim();
  const first = head.split(/\s+/).filter(Boolean)[0];
  return first || head || name;
}

function blurbFor(name: string): string {
  return `Small-group reformer Pilates at ${name} — max four people per class, so every session is coached, not crowded.`;
}

function dayKey(date: Date, tz: string): string {
  return safeFormat(date, tz, "yyyy-MM-dd");
}

function safeFormat(date: Date, tz: string, pattern: string): string {
  if (Number.isNaN(date.getTime())) return "";
  try {
    return formatInTimeZone(date, tz, pattern);
  } catch {
    return formatInTimeZone(date, FALLBACK_TZ, pattern);
  }
}
