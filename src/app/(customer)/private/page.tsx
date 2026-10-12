import { requireRole } from "@/lib/auth";
import { loadPrivateCalendar } from "@/lib/privateCalendar.server";
import { PrivateAppointmentCalendar } from "@/components/PrivateAppointmentCalendar";

export const dynamic = "force-dynamic";

export default async function PrivateAppointmentsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    day?: string; studio?: string; instructor?: string; notice?: string; error?: string;
  }>;
}) {
  const profile = await requireRole("customer", "/private");
  const params = (await searchParams) ?? {};
  const data = await loadPrivateCalendar("customer", profile.id, params);
  return <PrivateAppointmentCalendar data={data} role="customer" notice={params.notice} error={params.error} />;
}
