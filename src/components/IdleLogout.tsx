// ============================================================================
// IdleLogout — signs the user out after a period of inactivity. Mounted in the
// AppShell, so it only runs for signed-in sections. Activity (mouse, keyboard,
// touch, scroll) refreshes a shared "last activity" timestamp in localStorage
// (so multiple tabs count as one session), and a one-minute interval checks
// whether the idle window has elapsed before triggering the sign-out action.
// ============================================================================
"use client";

import { useEffect } from "react";
import { signOutAction } from "@/app/(auth)/actions";

// Idle window before auto sign-out. Change this single value to adjust.
const IDLE_MINUTES = 30;
const IDLE_MS = IDLE_MINUTES * 60 * 1000;
const KEY = "sf:lastActivity";

export function IdleLogout() {
  useEffect(() => {
    const bump = () => {
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        // ignore storage errors (private mode, etc.)
      }
    };

    const check = () => {
      let last = Date.now();
      try {
        last = Number(localStorage.getItem(KEY)) || Date.now();
      } catch {
        // ignore
      }
      if (Date.now() - last >= IDLE_MS) {
        void signOutAction();
      }
    };

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];
    bump();
    events.forEach((e) =>
      window.addEventListener(e, bump, { passive: true }),
    );
    const interval = setInterval(check, 60 * 1000);

    return () => {
      clearInterval(interval);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, []);

  return null;
}
