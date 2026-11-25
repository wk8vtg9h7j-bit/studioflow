import Link from "next/link";
import {requireRole} from "@/lib/auth";
import {createServiceClient} from "@/lib/supabase/server";
import {sendPrivateEnquiry} from "./actions";
import {formatInTimeZone} from "date-fns-tz";

export default async function PrivateEnquiry({searchParams}:{searchParams?:Promise<{status?:string}>}){
 const profile=await requireRole("customer","/private/enquiry");
 const {status}=(await searchParams)??{};
 const svc=createServiceClient();
 const {data:studios}=await svc.from("studios").select("id,name,slug").eq("active",true).in("slug",["downtown-pilates","hideaway-pilates","an-thuong-pilates"]).order("name");
 return <div className="mx-auto max-w-2xl space-y-6">
  <Link href="/private" className="text-sm font-semibold text-[#354a40] underline underline-offset-4">← Back to private sessions</Link>
  <div><p className="customer-eyebrow">PERSONAL PILATES</p><h1 className="mt-2">Ask for a private time</h1><p className="mt-3 text-sm leading-7 text-stone-600">Tell us your preferred studio and time. Our team will contact you to confirm availability. Sending a request does not reserve a class or deduct credits.</p></div>
  {status==="sent"&&<div role="status" className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-900">Your time request has been received by our team. We will contact you to confirm availability. This is not yet a booking.</div>}
  {status==="invalid"&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Please check your studio, phone number, date and time. Choose a future appointment.</div>}
  {(status==="send_failed"||status==="email_unavailable")&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">We couldn't save the request right now. No booking has been made. Please try again.</div>}
  <form action={sendPrivateEnquiry} className="customer-tile space-y-5">
   <div><label className="label" htmlFor="enquiry-studio">Choose studio</label><select className="input w-full" name="studio_id" id="enquiry-studio" required defaultValue=""><option value="" disabled>Select a location</option>{(studios??[]).map(s=><option key={s.id} value={s.id}>{s.slug==="an-thuong-pilates"?"An Thuong · Private only":s.name}</option>)}</select></div>
   <div className="grid gap-4 sm:grid-cols-2"><div><label className="label" htmlFor="enquiry-date">Preferred date</label><input className="input w-full" type="date" id="enquiry-date" name="date" min={formatInTimeZone(new Date(),"Asia/Ho_Chi_Minh","yyyy-MM-dd")} required/></div><div><label className="label" htmlFor="enquiry-time">Preferred time</label><input className="input w-full" type="time" id="enquiry-time" name="time" required/></div></div>
   <div><label className="label" htmlFor="enquiry-phone">Phone / Zalo number</label><input className="input w-full" id="enquiry-phone" name="phone" type="tel" defaultValue={profile.phone??""} minLength={6} maxLength={50} placeholder="+84..." required/></div>
   <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm"><p className="font-semibold text-[#354a40]">Your account</p><p className="mt-1 break-all text-stone-600">{profile.full_name||"Customer"} · {profile.email}</p></div>
   <div><label className="label" htmlFor="enquiry-notes">Goals or other preferences <span className="font-normal text-stone-500">(optional)</span></label><textarea className="input w-full" name="notes" id="enquiry-notes" rows={4} maxLength={1200} placeholder="e.g. beginner, recovery, preferred instructor or alternative times"/></div>
   <button className="btn-primary w-full px-6 py-3 sm:w-auto" type="submit">Request this time →</button>
   <p className="text-xs leading-5 text-stone-500">Your request appears in the admin inbox and alerts admins with notifications enabled. No payment or credits are taken until a class is confirmed.</p>
  </form>
 </div>;
}
