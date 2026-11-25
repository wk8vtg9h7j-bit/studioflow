import Link from "next/link";
import {createServiceClient} from "@/lib/supabase/server";
import {formatInTimeZone} from "date-fns-tz";
export const dynamic="force-dynamic";
export default async function AdminPrivateRequests(){
 const svc=createServiceClient();
 const {data,error}=await svc.from("private_enquiries")
 .select("id,profile_id,preferred_at,phone,notes,status,created_at,studio:studios(name),profile:profiles(full_name,email)")
 .order("created_at",{ascending:false}).limit(150);
 type RequestRow={id:string;preferred_at:string;phone:string;notes:string|null;status:string;created_at:string;
  studio:{name:string}|null;profile:{full_name:string|null;email:string|null}|null};
 const rows=(data??[]) as unknown as RequestRow[];
 const dt=(s:string)=>formatInTimeZone(new Date(s),"Asia/Ho_Chi_Minh","EEE, d MMM · HH:mm");
 return <div className="mx-auto max-w-4xl space-y-5 pb-16">
 <header><p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Private Pilates</p>
 <h1 className="mt-1 text-2xl font-semibold">Customer time requests</h1>
 <p className="mt-2 text-sm text-ink-muted">Preferred appointment times are enquiries, not confirmed bookings. Contact the customer before scheduling.</p></header>
 {error?<p role="alert" className="card p-4 text-sm text-red-700">Unable to load private requests: {error.message}</p>:null}
 <div className="grid grid-cols-2 gap-3">
 <div className="card p-4"><p className="text-2xl font-semibold">{rows.filter(r=>r.status==="new").length}</p><p className="text-xs text-ink-muted">New requests</p></div>
 <div className="card p-4"><p className="text-2xl font-semibold">{rows.length}</p><p className="text-xs text-ink-muted">Recent requests</p></div>
 </div>
 {rows.length===0?<div className="card p-6 text-sm text-ink-muted">No private enquiries yet.</div>:
 <div className="space-y-3">{rows.map(r=><article key={r.id} className="card space-y-3 p-4">
 <div className="flex items-start justify-between gap-2">
 <div><p className="font-semibold">{r.profile?.full_name||r.profile?.email||"Customer"}</p>
 <p className="mt-1 text-xs text-ink-muted">Requested {dt(r.created_at)}</p></div>
 <span className={"badge "+(r.status==="new"?"bg-amber-50 text-amber-800":"bg-stone-100 text-stone-700")}>{r.status}</span>
 </div>
 <div className="rounded-lg bg-stone-50 p-3"><p className="text-sm font-semibold">{r.studio?.name||"Studio"} · {dt(r.preferred_at)}</p>
 <p className="mt-1 text-xs text-ink-muted">Preferred time · Not yet confirmed</p></div>
 <p className="break-all text-sm">Phone / Zalo: <a className="font-semibold text-brand-600 underline" href={"tel:"+r.phone}>{r.phone}</a></p>
 {r.profile?.email?<p className="break-all text-sm">Email: <a className="text-brand-600 underline" href={"mailto:"+r.profile.email}>{r.profile.email}</a></p>:null}
 {r.notes?<p className="whitespace-pre-wrap text-sm text-ink-muted">Notes: {r.notes}</p>:null}
 <Link href="/admin/sessions" className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-600">View class schedule →</Link>
 </article>)}</div>}
 </div>;
}