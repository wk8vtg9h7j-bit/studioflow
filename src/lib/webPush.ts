import webPush from "web-push";

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type StudioFlowPushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

let vapidFingerprint: string | null = null;

function configureVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not configured.");
  }

  const fingerprint = `${publicKey}:${privateKey}`;
  if (vapidFingerprint !== fingerprint) {
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || "https://studioflow.fitness",
      publicKey,
      privateKey,
    );
    vapidFingerprint = fingerprint;
  }
}

function absoluteNavigateUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const deploymentHost = process.env.VERCEL_URL?.trim();
  const origin =
    configuredOrigin ||
    (productionHost ? `https://${productionHost}` : null) ||
    (deploymentHost ? `https://${deploymentHost}` : null) ||
    "https://studioflow-steel.vercel.app";

  return new URL(value || "/", origin).toString();
}

export function webPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function sendStudioFlowPush(
  subscription: StoredPushSubscription,
  payload: StudioFlowPushPayload,
) {
  configureVapid();

  const declarativePayload = {
    web_push: 8030,
    notification: {
      title: payload.title,
      body: payload.body,
      navigate: absoluteNavigateUrl(payload.url),
      silent: false,
      ...(payload.tag ? { tag: payload.tag } : {}),
    },
  };

  return webPush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    },
    JSON.stringify(declarativePayload),
    {
      TTL: 60 * 60,
      urgency: "high",
    },
  );
}

export function webPushStatusCode(error: unknown): number | null {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }

  return null;
}

export function webPushErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Push delivery failed.";
}
