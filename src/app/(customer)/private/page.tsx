import Link from "next/link";
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
  return <div className="space-y-5"><div className="rounded-2xl border border-[#d9e4d8] bg-[#f1f6ee] px-5 py-5 sm:flex sm:items-center sm:justify-between sm:gap-5"><div><p className="text-xs font-bold uppercase tracking-widest text-[#668071]">Private Pilates request</p><h2 className="mt-1 font-serif text-xl text-[#354a40]">Prefer a different time?</h2><p className="mt-2 text-sm text-stone-600">Choose your studio and tell our team when you'd like to train.</p></div><Link href="/private/enquiry" className="mt-4 inline-flex shrink-0 items-center justify-center rounded-xl bg-[#354a40] px-5 py-3 text-sm font-semibold text-white sm:mt-0">Request a private class →</Link></div><PrivateAppointmentCalendar data={data} role="customer" notice={params.notice} error={params.error}/></div>;
}
