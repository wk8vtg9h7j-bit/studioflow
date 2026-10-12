import { requireRole } from "@/lib/auth";
import { loadPrivateCalendar } from "@/lib/privateCalendar.server";
import { PrivateAppointmentCalendar } from "@/components/PrivateAppointmentCalendar";
import { PushNotificationsCard } from "../PushNotificationsCard";

export const dynamic = "force-dynamic";

export default async function InstructorPrivateCalendar({
  searchParams,
}: {
  searchParams?: Promise<{
    day?: string; studio?: string; notice?: string; error?: string;
  }>;
}) {
  const profile = await requireRole("instructor", "/instructor/private");
  const params = (await searchParams) ?? {};
  const data = await loadPrivateCalendar("instructor", profile.id, params);
  return (
    <div className="space-y-6">
      <PrivateAppointmentCalendar role="instructor" data={data} notice={params.notice} error={params.error}/>
      <PushNotificationsCard vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null}/>
    </div>
  );
}
