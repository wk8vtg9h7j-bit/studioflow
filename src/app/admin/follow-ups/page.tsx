import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
export const dynamic="force-dynamic";
export default async function FollowupsPage(){
 await requireRole("admin","/admin/follow-ups");
 const svc=createServiceClient();
 const [{data:rows,error},{count:optedIn}]=await Promise.all([
  svc.from("customer_followup_log")
   .select("id,kind,status,recipient_email,created_at,sent_at,last_error")
   .order("created_at",{ascending:false}).limit(80),
  svc.from("customers").select("id",{head:true,count:"exact"}).eq("marketing_opt_in",true)
 ]);
 if(error)throw error;
 return <div className="space-y-6">
  <header className="flex flex-wrap items-start justify-between gap-3"><div>
   <h1 className="text-2xl font-semibold text-ink">Follow-up automations</h1>
   <p className="mt-1 text-sm text-ink-muted">Daily capped outreach for first-visit payment reminders, last credits and inactive customers.</p></div>
   <Link href="/admin/marketing" className="btn-secondary">Marketing segments →</Link>
  </header>
  <div className="card p-5"><p className="font-semibold">{optedIn||0} customers opted in</p>
   <p className="mt-2 text-sm text-ink-muted">Runs each morning in Vietnam, up to 12 emails daily. It sends only when an email provider is configured. Each customer/event is deduplicated; failed sends are logged, not repeatedly retried.</p>
   <p className="mt-2 text-xs text-ink-soft">Only marketing-opted-in customers receive automatic messages. Existing bookings and credit balances are read-only for follow-up targeting.</p>
  </div>
  <section className="card overflow-hidden"><h2 className="border-b border-stone-200 px-4 py-3 font-semibold">Recent delivery log</h2>
   {!rows?.length?<p className="p-5 text-sm text-ink-muted">No messages sent or attempted yet.</p>:
    <ul className="divide-y divide-stone-100">{rows.map(row=><li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
     <div><strong>{row.recipient_email}</strong><p className="text-xs text-ink-muted">{row.kind.replaceAll("_"," ")} · {new Date(row.created_at).toLocaleString("en-GB")}</p>
     {row.last_error&&<p className="text-xs text-rose-700">{row.last_error}</p>}</div>
     <span className={"badge "+(row.status==="sent"?"bg-emerald-50 text-emerald-700":row.status==="failed"?"bg-rose-50 text-rose-700":"bg-stone-100")}>{row.status}</span>
    </li>)}</ul>}
  </section>
 </div>;
}
