import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
export const dynamic="force-dynamic";
const FROM="2026-10-12T00:00:00+07:00";
type Visit={id:string;customer_id:string;session:{starts_at:string;studio:{name:string}|null}|null};
type Receipt={id:string;kind:string;booking_id:string;amount_cents:number;currency:string;
 created_at:string;booking:{customer_id:string;session:{starts_at:string;studio:{name:string}|null}|null}|null;
 purchase:{package:{name:string|null}|null}|null;
 seller:{full_name:string|null;email:string|null}|null};
const money=(value:number)=>formatMoney(value,"VND");
export default async function InsightsPage(){
 await requireRole("admin","/admin/insights");
 const svc=createServiceClient();
 const [visitsRes,receiptsRes,studiosRes]=await Promise.all([
  svc.from("bookings").select("id,customer_id,session:sessions(starts_at,studio:studios(name))")
   .eq("status","attended").order("booked_at",{ascending:true}).limit(1000),
  svc.from("class_checkouts").select("id,kind,booking_id,amount_cents,currency,created_at,booking:bookings(customer_id,session:sessions(starts_at,studio:studios(name))),seller:profiles(full_name,email),purchase:credit_ledger(package:packages(name))")
   .gte("created_at",FROM).order("created_at",{ascending:false}).limit(1000),
  svc.from("studios").select("name").eq("active",true),
 ]);
 if(visitsRes.error)throw visitsRes.error;
 if(receiptsRes.error)throw receiptsRes.error;
 const visits=(visitsRes.data||[]) as unknown as Visit[];
 const receipts=(receiptsRes.data||[]) as unknown as Receipt[];
 // A first visit is the earliest attended session, not simply a customer signup.
 const earliest=new Map<string,Visit>();
 for(const v of visits){
  const prior=earliest.get(v.customer_id);
  if(!prior||(v.session?.starts_at||"")<(prior.session?.starts_at||""))earliest.set(v.customer_id,v);
 }
 const first=[...earliest.values()].filter(v=>(v.session?.starts_at||"")>=new Date(FROM).toISOString());
 const firstIds=new Set(first.map(v=>v.id));
 const firstPaid=receipts.filter(r=>firstIds.has(r.booking_id));
 const firstPackage=firstPaid.filter(r=>r.kind==="package");
 const percent=first.length?Math.round(firstPackage.length/first.length*100):0;
 const overview=new Map<string,{first:number;converted:number;revenue:number;checkouts:number}>();
 for(const r of studiosRes.data||[])overview.set(r.name,{first:0,converted:0,revenue:0,checkouts:0});
 for(const v of first){
  const key=v.session?.studio?.name||"Other";
  const x=overview.get(key)||{first:0,converted:0,revenue:0,checkouts:0};x.first++;overview.set(key,x);
 }
 for(const r of receipts){
  const key=r.booking?.session?.studio?.name||"Other";
  const x=overview.get(key)||{first:0,converted:0,revenue:0,checkouts:0};
  x.revenue+=r.currency==="VND"?r.amount_cents:0;x.checkouts++;
  if(firstIds.has(r.booking_id)&&r.kind==="package")x.converted++;
  overview.set(key,x);
 }
 const totalCheckoutRevenue=receipts.filter(r=>r.currency==="VND").reduce((a,r)=>a+r.amount_cents,0);
 const sellers=new Map<string,{count:number;revenue:number}>();
 const packages=new Map<string,{count:number;revenue:number}>();
 for(const r of receipts.filter(r=>r.kind==="package")){
  const seller=r.seller?.full_name||r.seller?.email||"Staff";
  const s=sellers.get(seller)||{count:0,revenue:0};s.count++;
  if(r.currency==="VND")s.revenue+=r.amount_cents;
  sellers.set(seller,s);
  const packageName=r.purchase?.package?.name||"Other package";
  const detail=packages.get(packageName)||{count:0,revenue:0};
  detail.count++;
  if(r.currency==="VND")detail.revenue+=r.amount_cents;
  packages.set(packageName,detail);
 }
 return <div className="space-y-6">
  <header className="flex flex-wrap items-start justify-between gap-4">
   <div><h1 className="text-2xl font-semibold text-ink">Business insights</h1>
    <p className="mt-1 text-sm text-ink-muted">First-visit conversion, checkout revenue and performance by studio.</p></div>
   <Link href="/admin/today" className="btn-primary">Today's classes →</Link>
  </header>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
   {[
    ["New first visits",String(first.length)],
    ["First-visit packages",String(firstPackage.length)],
    ["Package conversion",percent+"%"],
    ["Tracked checkout revenue",money(totalCheckoutRevenue)]
   ].map(([label,value])=><section key={label} className="card p-4">
    <p className="text-xs text-ink-muted">{label}</p>
    <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
   </section>)}
  </div>
  <section className="card overflow-hidden">
   <div className="border-b border-stone-200 p-4"><h2 className="font-semibold text-ink">Downtown vs Hideaway</h2>
    <p className="mt-1 text-xs text-ink-muted">Only first visits and explicitly recorded checkouts since 12 October 2026 are included. Legacy sales are not guessed or attributed.</p></div>
   <div className="overflow-x-auto"><table className="min-w-full text-sm">
    <thead className="bg-stone-50 text-left text-xs text-ink-muted"><tr>
     <th className="p-3">Studio</th><th className="p-3">First visits</th><th className="p-3">Packages</th>
     <th className="p-3">Conversion</th><th className="p-3">Checkouts</th><th className="p-3">Revenue</th>
    </tr></thead><tbody className="divide-y divide-stone-100">
     {[...overview.entries()].map(([name,x])=><tr key={name}>
      <td className="p-3 font-semibold">{name}</td><td className="p-3">{x.first}</td>
      <td className="p-3">{x.converted}</td><td className="p-3">{x.first?Math.round(x.converted/x.first*100):0}%</td>
      <td className="p-3">{x.checkouts}</td><td className="p-3">{money(x.revenue)}</td>
     </tr>)}
    </tbody>
   </table></div>
  </section>
  <section className="grid gap-4 lg:grid-cols-2">
   <div className="card p-4"><h2 className="font-semibold">Sales by team member</h2>
    {sellers.size===0?<p className="mt-3 text-sm text-ink-muted">No first-visit package checkouts yet.</p>:
     <ul className="mt-3 divide-y divide-stone-100">{[...sellers.entries()].sort((a,b)=>b[1].revenue-a[1].revenue).map(([name,s])=>
      <li key={name} className="flex justify-between gap-2 py-2 text-sm">
       <span>{name} · {s.count} packages</span><strong>{money(s.revenue)}</strong></li>)}</ul>}
   </div>
   <div className="card p-4"><h2 className="font-semibold">Most popular first-visit packages</h2>
     {packages.size===0?<p className="mt-3 text-sm text-ink-muted">No linked package checkouts yet.</p>:
     <ul className="mt-3 divide-y divide-stone-100">
       {[...packages.entries()].sort((a,b)=>b[1].count-a[1].count).map(([name,p])=>
       <li key={name} className="flex justify-between gap-3 py-2 text-sm">
         <span>{name} · {p.count} sold</span><strong>{money(p.revenue)}</strong>
       </li>)}
     </ul>}
   </div>
   <div className="card p-4"><h2 className="font-semibold">What these figures mean</h2>
    <p className="mt-2 text-sm text-ink-muted">A conversion occurs when a customer buys a package at checkout that explicitly covers their first attended class. The revenue above includes single-class payments and those linked package purchases, but not unlinked package sales or retail sales. Historic records are left unchanged.</p>
    <p className="mt-3 text-sm text-ink-muted">{first.filter(v=>!receipts.some(r=>r.booking_id===v.id)).length} first visits do not yet have a linked checkout receipt; review them in the daily desk before treating all of them as unpaid.</p>
   </div>
  </section>
 </div>;
}
