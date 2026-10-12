import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { sendStudioFlowPush, webPushConfigured, webPushStatusCode } from "@/lib/webPush";

// Notifications are best-effort. In-app requests are always authoritative.
export async function notifyInstructor(
  instructorId: string,
  title: string,
  body: string,
  url = "/instructor/private",
  tag?: string,
) {
  if (!webPushConfigured()) return;
  const service = createServiceClient();
  const { data } = await service
    .from("instructor_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("instructor_id", instructorId);
  const devices = data ?? [];
  await Promise.allSettled(devices.map(async (device) => {
    try {
      await sendStudioFlowPush(device, { title, body, url, tag });
    } catch (error) {
      if ([404, 410].includes(webPushStatusCode(error) ?? 0)) {
        await service.from("instructor_push_subscriptions").delete().eq("id", device.id);
      }
    }
  }));
}
