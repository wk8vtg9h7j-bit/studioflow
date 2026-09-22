// ============================================================================
// Notifications actions — mark the feed as "seen" by stamping a cookie with the
// current time. The header badge counts events newer than this stamp.
// ============================================================================
"use server";

import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth";
import { NOTIF_SEEN_COOKIE } from "./data";

export async function markNotificationsSeenAction() {
  await requireRole("admin", "/admin/notifications");
  cookies().set(NOTIF_SEEN_COOKIE, new Date().toISOString(), {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}
