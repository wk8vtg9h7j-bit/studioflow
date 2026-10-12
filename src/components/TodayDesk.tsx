import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { loadTodayDesk, type DeskSession } from "@/lib/checkout/desk.server";
import { CheckInActions, CheckoutControl } from "@/components/CheckoutControl";
const TZ="Asia/Ho_Chi_Minh";
export async function TodayDesk({role,profileId,date}:{role:"admin"|"instructor";profileId:string;date?:string}){
 const data=await loadTodayDesk(role,profileId,date);
 const route=role==="admin"?"/admin/today":"/instructor/today";
 const at=Date.parse(data.day+"T12:00:00Z");
 const previous=new Date(at-86400000).toISOString().slice(0,10);
 const next=new Date(at+86400000).toISOString().slice(0,10);

 const groups=new Map<string,DeskSession[]>();
 for(const session of data.sessions){
  const key=session.slug||session.studio;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key)!.push(session);
 }
 return <div className="space-y-6">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div><h1 className="text-2xl font-semibold text-ink">Today's classes</h1>
    <p className="mt-1 text-sm text-ink-muted">{data.day} · Live roster, check-in and first-visit checkout, separated by studio.</p>
   </div>
   <Link href={role==="admin"?"/admin/insights":"/instructor/salary"} className="btn-secondary">
    {role==="admin"?"Business insights →":"My salary →"}
   </Link>
  </header>
  <nav className="card flex flex-wrap items-center justify-between gap-3 p-3">
    <Link href={route+"?date="+previous} className="btn-secondary">← Previous day</Link>
    <span className="text-sm font-semibold text-ink">{data.day}</span>
    <div className="flex flex-wrap gap-2">
      <Link href={route} className="btn-secondary">Today</Link>
      <Link href={route+"?date="+next} className="btn-secondary">Next day →</Link>
    </div>
  </nav>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
   {[["Classes",data.sessions.length],["Booked spots",data.booked],["Checked in",data.attended],["Payments to review",data.due]]
    .map(([label,val])=><div key={label} className="card p-4"><p className="text-xs text-ink-muted">{label}</p>
     <p className="mt-1 text-2xl font-semibold tabular-nums">{val}</p></div>)}
  </div>
  {data.sessions.length===0 && <div className="card p-8 text-sm text-ink-muted">No classes on your calendar today.</div>}
  {[...groups.entries()].map(([slug,sessions])=><section key={slug} className="space-y-3">
   <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-ink">{sessions[0]?.studio}</h2>
    <span className="text-xs text-ink-muted">{sessions.length} classes</span></div>
   {sessions.map(session=><article key={session.id} className="card overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-4 py-3">
     <div><h3 className="font-semibold text-ink">{formatInTimeZone(new Date(session.at),TZ,"HH:mm")} · {session.name}</h3>
      <p className="text-xs text-ink-muted">{session.instructor}</p></div>
     <span className="text-xs text-ink-soft">{session.bookings.filter(b=>["booked","attended"].includes(b.status)).reduce((n,b)=>n+b.spots,0)+session.filler}/{session.capacity} filled</span>
    </div>
    {session.bookings.length===0?<p className="px-4 py-6 text-sm text-ink-muted">No bookings yet.</p>:
     <ul className="divide-y divide-stone-100">
      {session.bookings.map(b=><li key={b.id} className="space-y-3 px-4 py-4">
       <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-medium text-ink">{b.name}{b.spots>1?" · "+b.spots+" spots":""}</p>
         <p className="mt-1 text-xs text-ink-muted">{b.status.replaceAll("_"," ")} · {b.creditsSpent} booking credit(s) · {b.firstVisit?"First visit":b.pool==="private"?"Private":"Regular"}</p>
        </div>
        <span className={"badge "+(b.payment==="package"?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-800")}>
         {b.payment==="package"?"PAID / PACKAGE":"PAYMENT DUE"}
        </span>
       </div>
       <div className="flex flex-wrap items-start gap-3">
        <CheckInActions bookingId={b.id} status={b.status} canMark={Date.parse(session.at)<=Date.now()}/>
        {b.status==="attended"&&b.payment==="payment_due"&&<CheckoutControl
           bookingId={b.id} pool={b.pool} creditsSpent={b.creditsSpent}
           eligibleStarter={b.eligibleStarter} packages={data.packages} instructorName={session.instructor}/>}
       </div>
      </li>)}
     </ul>}
   </article>)}
  </section>)}
  <p className="text-xs text-ink-soft">Starter credit reserves the first class; it does not mean the class was paid. When a package includes the attended first visit, its remaining credits are reduced accordingly. Paid packages and single-class payments are recorded separately.</p>
 </div>;
}
