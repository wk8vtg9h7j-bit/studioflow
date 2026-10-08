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

export type PushActionResult = {
  ok: boolean;
  error?: string;
};

async function currentInstructor() {
  const profile = await requireRole("instructor", "/instructor");
  const service = createServiceClient();

  const { data: instructor, error } = await service
    .from("instructors")
    .select("id")
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (error || !instructor) {
    return {
      service,
      instructorId: null as string | null,
      error: error?.message ?? "Instructor profile is not linked.",
    };
  }

  return {
    service,
    instructorId: instructor.id as string,
    error: null as string | null,
  };
}

export async function saveInstructorPushSubscriptionAction(
  input: unknown,
): Promise<PushActionResult> {
  const parsed = PushSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid push subscription." };
  }

  const { service, instructorId, error: instructorError } =
    await currentInstructor();

  if (!instructorId) {
    return { ok: false, error: instructorError ?? "Instructor not found." };
  }

  const { error } = await service
    .from("instructor_push_subscriptions")
    .upsert(
      {
        instructor_id: instructorId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/instructor");
  return { ok: true };
}

export async function removeInstructorPushSubscriptionAction(
  endpoint: string,
): Promise<PushActionResult> {
  const parsed = EndpointSchema.safeParse(endpoint);
  if (!parsed.success) {
    return { ok: false, error: "Invalid push subscription." };
  }

  const { service, instructorId, error: instructorError } =
    await currentInstructor();

  if (!instructorId) {
    return { ok: false, error: instructorError ?? "Instructor not found." };
  }

  const { error } = await service
    .from("instructor_push_subscriptions")
    .delete()
    .eq("instructor_id", instructorId)
    .eq("endpoint", parsed.data);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/instructor");
  return { ok: true };
}

export async function sendInstructorTestPushAction(
  endpoint: string,
): Promise<PushActionResult> {
  const parsed = EndpointSchema.safeParse(endpoint);
  if (!parsed.success) {
    return { ok: false, error: "Invalid push subscription." };
  }

  if (!webPushConfigured()) {
    return { ok: false, error: "Push notifications are not configured." };
  }

  const { service, instructorId, error: instructorError } =
    await currentInstructor();

  if (!instructorId) {
    return { ok: false, error: instructorError ?? "Instructor not found." };
  }

  const { data: subscription, error } = await service
    .from("instructor_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("instructor_id", instructorId)
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
        title: "StudioFlow notifications are on",
        body: "You will get an alert when someone books or cancels a class assigned to you.",
        url: "/instructor",
        tag: "studioflow-push-test",
      },
    );

    return { ok: true };
  } catch (pushError) {
    const statusCode = webPushStatusCode(pushError);
    if (statusCode === 404 || statusCode === 410) {
      await service
        .from("instructor_push_subscriptions")
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
