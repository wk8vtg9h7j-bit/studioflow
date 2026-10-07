"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  removeInstructorPushSubscriptionAction,
  saveInstructorPushSubscriptionAction,
  sendInstructorTestPushAction,
} from "./push-actions";

type PushState =
  | "checking"
  | "enabled"
  | "disabled"
  | "denied"
  | "needs-install"
  | "unsupported";

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneApp() {
  if (typeof window === "undefined") return false;

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }

  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function serialiseSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) return null;

  return {
    endpoint,
    keys: { p256dh, auth },
  };
}

export function PushNotificationsCard({
  vapidPublicKey,
}: {
  vapidPublicKey: string | null;
}) {
  const [state, setState] = useState<PushState>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ios = useMemo(() => isIosDevice(), []);

  useEffect(() => {
    let alive = true;

    async function inspect() {
      if (
        !vapidPublicKey ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (alive) setState("unsupported");
        return;
      }

      if (ios && !isStandaloneApp()) {
        if (alive) setState("needs-install");
        return;
      }

      if (Notification.permission === "denied") {
        if (alive) setState("denied");
        return;
      }

      try {
        const registration =
          (await navigator.serviceWorker.getRegistration("/push-sw.js")) ??
          (await navigator.serviceWorker.register("/push-sw.js"));
        const subscription = await registration.pushManager.getSubscription();

        if (!alive) return;

        if (subscription && Notification.permission === "granted") {
          setEndpoint(subscription.endpoint);
          setState("enabled");
        } else {
          setState("disabled");
        }
      } catch {
        if (alive) setState("unsupported");
      }
    }

    void inspect();

    return () => {
      alive = false;
    };
  }, [ios, vapidPublicKey]);

  function enableNotifications() {
    setMessage(null);

    startTransition(async () => {
      if (!vapidPublicKey) {
        setState("unsupported");
        setMessage("Push notifications are not configured yet.");
        return;
      }

      if (ios && !isStandaloneApp()) {
        setState("needs-install");
        setMessage(
          "On iPhone, add StudioFlow to your Home Screen first, then open it from the new icon and tap Enable notifications.",
        );
        return;
      }

      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState("unsupported");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "disabled");
        setMessage(
          permission === "denied"
            ? "Notifications are blocked in your browser settings."
            : "Notification permission was not granted.",
        );
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register(
          "/push-sw.js",
          { scope: "/" },
        );

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
          });
        }

        const payload = serialiseSubscription(subscription);
        if (!payload) {
          setState("disabled");
          setMessage("Could not read this phone's push subscription.");
          return;
        }

        const saved = await saveInstructorPushSubscriptionAction(payload);
        if (!saved.ok) {
          await subscription.unsubscribe();
          setState("disabled");
          setMessage(saved.error ?? "Could not enable notifications.");
          return;
        }

        setEndpoint(subscription.endpoint);
        setState("enabled");
        setMessage(
          "Enabled. You will be notified when someone books one of your assigned classes.",
        );
      } catch (error) {
        setState("disabled");
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not enable phone notifications.",
        );
      }
    });
  }

  function disableNotifications() {
    setMessage(null);

    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration(
          "/push-sw.js",
        );
        const subscription =
          (await registration?.pushManager.getSubscription()) ?? null;

        if (subscription) {
          const removed = await removeInstructorPushSubscriptionAction(
            subscription.endpoint,
          );
          if (!removed.ok) {
            setMessage(removed.error ?? "Could not disable notifications.");
            return;
          }
          await subscription.unsubscribe();
        }

        setEndpoint(null);
        setState("disabled");
        setMessage("Phone notifications are off on this device.");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not disable phone notifications.",
        );
      }
    });
  }

  function sendTest() {
    if (!endpoint) return;
    setMessage(null);

    startTransition(async () => {
      const result = await sendInstructorTestPushAction(endpoint);
      if (result.ok) {
        setMessage("Test sent. It should appear as a phone notification.");
      } else {
        setMessage(result.error ?? "Could not send the test notification.");
      }
    });
  }

  const badge =
    state === "enabled"
      ? { label: "Enabled", className: "bg-emerald-50 text-emerald-700" }
      : state === "checking"
        ? { label: "Checking…", className: "bg-stone-100 text-ink-muted" }
        : { label: "Off", className: "bg-stone-100 text-ink-muted" };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">
              Phone notifications
            </h2>
            <span className={`badge ${badge.className}`}>{badge.label}</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Get a push alert on this phone whenever a customer books a class
            assigned to you.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {state === "enabled" ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={sendTest}
                disabled={pending || !endpoint}
              >
                {pending ? "Sending…" : "Send test"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={disableNotifications}
                disabled={pending}
              >
                Turn off
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={enableNotifications}
              disabled={pending || state === "checking" || state === "unsupported"}
            >
              {pending ? "Enabling…" : "Enable notifications"}
            </button>
          )}
        </div>
      </div>

      {state === "needs-install" ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>iPhone:</strong> open StudioFlow in Safari, tap Share → Add to
          Home Screen, open StudioFlow from the new Home Screen icon, then tap
          Enable notifications.
        </div>
      ) : null}

      {state === "denied" ? (
        <p className="mt-4 text-sm text-rose-700">
          Notifications are blocked for StudioFlow. Allow them in your phone or
          browser notification settings, then come back here.
        </p>
      ) : null}

      {state === "unsupported" ? (
        <p className="mt-4 text-sm text-ink-muted">
          Push notifications are not available in this browser. Use Safari on a
          recent iPhone/iPad Home Screen app, or a current Chrome/Edge/Android
          browser.
        </p>
      ) : null}

      {message ? (
        <p className="mt-4 text-sm text-ink-muted" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
