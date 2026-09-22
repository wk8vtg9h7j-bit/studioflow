// ============================================================================
// MarkSeen — on mount, stamps the notifications feed as seen so the header badge
// clears. Renders nothing; it just fires the server action once.
// ============================================================================
"use client";

import { useEffect, useRef } from "react";
import { markNotificationsSeenAction } from "./actions";

export function MarkSeen() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    markNotificationsSeenAction().catch(() => {});
  }, []);
  return null;
}
