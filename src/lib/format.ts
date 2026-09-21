// ============================================================================
// Formatting helpers — small, dependency-light utilities for rendering dates,
// money, and the occasional label consistently across every role's UI.
//
// Sessions are stored as UTC timestamptz; studios carry an IANA timezone. When
// we show a session time we render it in *the studio's* zone, not the viewer's,
// so a 9:00 AM Sydney class always reads "9:00 AM" regardless of who's looking.
// ============================================================================
import { formatInTimeZone } from "date-fns-tz";

export const FALLBACK_TZ = "Asia/Ho_Chi_Minh";

// "Mon, 12 May · 9:00 AM" — the compact form used in lists and cards.
export function formatSessionWhen(
  startsAt: string | Date,
  timezone?: string | null,
): string {
  const tz = timezone || FALLBACK_TZ;
  try {
    return formatInTimeZone(new Date(startsAt), tz, "EEE, d MMM · h:mm a");
  } catch {
    // An unknown/invalid IANA zone shouldn't blow up a page — fall back to UTC.
    return formatInTimeZone(new Date(startsAt), FALLBACK_TZ, "EEE, d MMM · h:mm a");
  }
}

// "Monday, 12 May 2026" — used in detail headers where there's room to breathe.
export function formatSessionDate(
  startsAt: string | Date,
  timezone?: string | null,
): string {
  const tz = timezone || FALLBACK_TZ;
  try {
    return formatInTimeZone(new Date(startsAt), tz, "EEEE, d MMM yyyy");
  } catch {
    return formatInTimeZone(new Date(startsAt), FALLBACK_TZ, "EEEE, d MMM yyyy");
  }
}

// "9:00 AM – 10:00 AM" — a start/end range rendered in the studio's zone.
export function formatSessionTimeRange(
  startsAt: string | Date,
  endsAt: string | Date,
  timezone?: string | null,
): string {
  const tz = timezone || FALLBACK_TZ;
  const safe = (d: string | Date, fmt: string) => {
    try {
      return formatInTimeZone(new Date(d), tz, fmt);
    } catch {
      return formatInTimeZone(new Date(d), FALLBACK_TZ, fmt);
    }
  };
  return `${safe(startsAt, "h:mm a")} – ${safe(endsAt, "h:mm a")}`;
}

// Value for an <input type="datetime-local">, expressed in the studio's zone so
// editing a session shows the same wall-clock time the studio sees.
export function toDateTimeLocal(
  startsAt: string | Date,
  timezone?: string | null,
): string {
  const tz = timezone || FALLBACK_TZ;
  try {
    return formatInTimeZone(new Date(startsAt), tz, "yyyy-MM-dd'T'HH:mm");
  } catch {
    return formatInTimeZone(new Date(startsAt), FALLBACK_TZ, "yyyy-MM-dd'T'HH:mm");
  }
}

// Zero-decimal currencies have no minor unit (no "cents"): the stored integer
// IS the whole-currency amount, so we must NOT divide by 100. VND (Vietnamese
// dong) is the common case here; JPY/KRW etc. behave the same way.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "VND",
  "JPY",
  "KRW",
  "CLP",
  "ISK",
  "HUF",
  "PYG",
  "UGX",
  "XAF",
  "XOF",
  "RWF",
  "VUV",
]);

// Currency formatter. For ordinary currencies amounts are stored as integer
// minor units (cents), so we divide by 100 before handing to Intl. For
// zero-decimal currencies (VND, JPY, …) the stored integer is already the whole
// amount, so we pass it through untouched. Defaults to VND.
export function formatMoney(
  minorUnits: number | null | undefined,
  currency = "VND",
): string {
  const code = currency.toUpperCase();
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  const amount = zeroDecimal ? (minorUnits ?? 0) : (minorUnits ?? 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    // Unknown currency code — show the number with the raw code appended.
    return zeroDecimal
      ? `${amount} ${code}`
      : `${amount.toFixed(2)} ${code}`;
  }
}

// Some amounts are stored as major-unit decimals — payroll's numeric(10,2), e.g.
// 25.00 — rather than integer minor units. Convert to whatever formatMoney
// expects for the currency, then delegate, so exactly one place knows which
// currencies are zero-decimal.
export function formatMajorMoney(
  amount: number | null | undefined,
  currency = "VND",
): string {
  const code = currency.toUpperCase();
  const value = amount ?? 0;
  return formatMoney(
    ZERO_DECIMAL_CURRENCIES.has(code) ? Math.round(value) : Math.round(value * 100),
    code,
  );
}

// "scheduled" -> "Scheduled", "no_show" -> "No show". Handy for enum-ish values.
export function humanizeLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
