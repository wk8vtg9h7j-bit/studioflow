// Registers the service worker so the app is installable (Add to Home Screen)
// on Android/Chrome. iOS installs from the manifest + apple-touch-icon alone.
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // ignore registration failures (e.g. unsupported browsers)
      });
    }
  }, []);
  return null;
}
