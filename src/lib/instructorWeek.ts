// Shared week and studio helpers for the instructor portal.
// The two Recharged studios operate in Da Nang (UTC+7, no DST).
import { formatInTimeZone } from "date-fns-tz";

export const INSTRUCTOR_TIME_ZONE = "Asia/Ho_Chi_Minh";

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDay(iso: string, days: number): string {
  const date = new Date(iso + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function mondayFor(iso: string): string {
  const date = new Date(iso + "T12:00:00Z");
  const day = (date.getUTCDay() + 6) % 7;
  return shiftDay(iso, -day);
}

function validDay(raw: string | undefined): raw is string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(raw + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) && dateOnly(date) === raw;
}

function labelDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso + "T12:00:00Z"));
}

export function instructorWeek(raw?: string | string[]) {
  const input = Array.isArray(raw) ? raw[0] : raw;
  const today = formatInTimeZone(new Date(), INSTRUCTOR_TIME_ZONE, "yyyy-MM-dd");
  const start = mondayFor(validDay(input) ? input : today);
  const following = shiftDay(start, 7);
  const sunday = shiftDay(start, 6);
  return {
    start,
    next: following,
    previous: shiftDay(start, -7),
    isCurrent: start === mondayFor(today),
    label: labelDay(start) + " – " + labelDay(sunday),
    from: start + "T00:00:00+07:00",
    until: following + "T00:00:00+07:00",
  };
}

export function instructorStudioKey(name?: string | null): string {
  const lower = (name ?? "").toLowerCase().trim();
  if (lower.includes("downtown")) return "downtown";
  if (lower.includes("hideaway")) return "hideaway";
  return lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}

export function instructorStudioName(key: string, fallback?: string | null): string {
  if (key === "downtown") return "Downtown";
  if (key === "hideaway") return "Hideaway";
  return fallback || "Other studio";
}

export function instructorStudioOrder(a: string, b: string): number {
  const rank = (key: string) => key === "downtown" ? 0 : key === "hideaway" ? 1 : 2;
  return rank(a) - rank(b) || a.localeCompare(b);
}

export function instructorPortalHref(path: string, week: string, studio?: string): string {
  const params = new URLSearchParams({ week });
  if (studio && studio !== "all") params.set("studio", studio);
  return path + "?" + params.toString();
}

export function studioParam(raw?: string | string[]): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && /^[a-z0-9-]{1,60}$/.test(value) ? value : "all";
}
