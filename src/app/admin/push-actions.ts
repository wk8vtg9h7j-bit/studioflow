"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  sendStudioFlowPush,
  webPushConfigured,
  webPushErrorMessage,
  webPushStatusCode,
} from "@/lib/webPush";

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().min(1).max(1024),
    auth: z.string().min(1).max(1024),
  }),
});

const EndpointSchema = z.string().url().max(4096);

export type AdminPushActionResult = {
  ok: boolean;
  error?: string;
};

async function currentAdmin() {
  const profile = await requireRole("admin", "/admin");
  return {
    profile,
    service: createServiceClient(),
  };
}

export async function saveAdminPushSubscriptionAction(
  input: unknown,
): Promise<AdminPushActionResult> {
  const parsed = PushSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid push subscription." };
  }

  const { profile, service } = await currentAdmin();

  const { error } = await service
    .from("admin_push_subscriptions")
    .upsert(
      {
        profile_id: profile.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function removeAdminPushSubscriptionAction(
  endpoint: string,
): Promise<AdminPushActionResult> {
  const parsed = EndpointSchema.safeParse(endpoint);
  if (!parsed.success) {
    return { ok: false, error: "Invalid push subscription." };
  }

  const { profile, service } = await currentAdmin();

  const { error } = await service
    .from("admin_push_subscriptions")
    .delete()
    .eq("profile_id", profile.id)
    .eq("endpoint", parsed.data);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function sendAdminTestPushAction(
  endpoint: string,
): Promise<AdminPushActionResult> {
  const parsed = EndpointSchema.safeParse(endpoint);
  if (!parsed.success) {
    return { ok: false, error: "Invalid push subscription." };
  }

  if (!webPushConfigured()) {
    return { ok: false, error: "Push notifications are not configured." };
  }

  const { profile, service } = await currentAdmin();

  const { data: subscription, error } = await service
    .from("admin_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("profile_id", profile.id)
    .eq("endpoint", parsed.data)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!subscription) {
    return {
      ok: false,
      error: "This phone is not registered. Enable notifications again.",
    };
  }

  try {
    await sendStudioFlowPush(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
      {
        title: "StudioFlow admin notifications are on",
        body: "You will get an alert for every new confirmed class booking.",
        url: "/admin",
        tag: "studioflow-admin-push-test",
      },
    );

    return { ok: true };
  } catch (pushError) {
    const statusCode = webPushStatusCode(pushError);
    if (statusCode === 404 || statusCode === 410) {
      await service
        .from("admin_push_subscriptions")
        .delete()
        .eq("id", subscription.id);

      return {
        ok: false,
        error: "This notification subscription expired. Enable it again.",
      };
    }

    return { ok: false, error: webPushErrorMessage(pushError) };
  }
}
