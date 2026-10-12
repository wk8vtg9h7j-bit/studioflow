"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-check the assigned roster when instructors return to the app. This avoids
// showing a stale class after an admin blocks, cancels or reassigns it, without
// constant polling that would slow down the already large studio schedule.
export function InstructorFocusRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [router]);
  return null;
}
