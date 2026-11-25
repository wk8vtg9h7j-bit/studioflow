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
  return <div className="space-y-5"><nav aria-label="Choose booking type" className="grid grid-cols-2 gap-2 rounded-2xl border border-stone-200 bg-white p-2"><Link href="/book" className="flex min-h-14 items-center justify-center rounded-xl px-3 text-center text-sm font-semibold text-[#354a40] hover:bg-stone-100">← Group Reformer classes</Link><span aria-current="page" className="flex min-h-14 items-center justify-center rounded-xl bg-[#354a40] px-3 text-center text-sm font-semibold text-white">Private sessions</span></nav><div className="rounded-2xl border border-[#d9e4d8] bg-[#f1f6ee] px-5 py-5 sm:flex sm:items-center sm:justify-between sm:gap-5"><div><p className="text-xs font-bold uppercase tracking-widest text-[#668071]">Private Pilates sessions</p><h2 className="mt-1 font-serif text-xl text-[#354a40]">Choose your private Pilates time</h2><p className="mt-2 text-sm text-stone-600">Browse available private times below, or request a preferred date and time. Our team will confirm your request before booking.</p></div><Link href="/private/enquiry" className="mt-4 inline-flex shrink-0 items-center justify-center rounded-xl bg-[#354a40] px-5 py-3 text-sm font-semibold text-white sm:mt-0">Ask for a preferred time →</Link></div><PrivateAppointmentCalendar data={data} role="customer" notice={params.notice} error={params.error}/></div>;
}
