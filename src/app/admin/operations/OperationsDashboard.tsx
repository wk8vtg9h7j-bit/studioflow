"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type OperationClass = {
  id:string; studioId:string; studio:string; className:string; instructor:string;
  startsAt:string; capacity:number; fillerSeats:number; booked:number;
  activeReservations:number; status:string; privateOnly:boolean; autoBlocked:boolean;
};
export type BlockHistory = { sessionId:string; blockedAt:string; startsAt:string };
type Section = "attention" | "schedule" | "blocks" | "quicklinks";
const OPTIONS: {key:Section; label:string; description:string}[] = [
  {key:"attention",label:"Needs attention",description:"Empty and low-booking classes"},
  {key:"schedule",label:"Today's schedule",description:"Upcoming classes, occupancy and instructors"},
  {key:"blocks",label:"Auto-block history",description:"Classes closed by the 90-minute rule"},
  {key:"quicklinks",label:"Quick actions",description:"Payments, roster and other admin tools"},
];
const TZ = "Asia/Ho_Chi_Minh";
const time = (value:string) => new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
const dateTime = (value:string) => new Intl.DateTimeFormat("en-GB",{timeZone:TZ,day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
function classify(row:OperationClass, now:number) {
  if(row.status==="cancelled") return row.autoBlocked ? "blocked" : "cancelled";
  if(row.status!=="scheduled" || Date.parse(row.startsAt)<=now) return "finished";
  if(row.activeReservations>0) return "protected";
  if(row.privateOnly || row.fillerSeats>0) return "excluded";
  return Date.parse(row.startsAt)-now<=90*60*1000 ? "due" : "watch";
}
export function OperationsDashboard({initialClasses,studios,blocks,dayKey,nowIso,errors}:{
  initialClasses:OperationClass[]; studios:{id:string;name:string}[];
  blocks:BlockHistory[]; dayKey:string; nowIso:string; errors:string[];
}){
  const [studio,setStudio] = useState("all");
  const [showSettings,setShowSettings] = useState(false);
  const [sections,setSections] = useState<Section[]>(["attention","schedule","blocks","quicklinks"]);
  const [onlyUpcoming,setOnlyUpcoming] = useState(true);
  const [hydrated,setHydrated] = useState(false);
  const now = Date.parse(nowIso);
  useEffect(()=>{
    try {
      const stored = localStorage.getItem("studioflow-admin-operations-v1");
      if (stored) {
        const parsed = JSON.parse(stored) as {sections?:Section[];studio?:string;onlyUpcoming?:boolean};
        if(Array.isArray(parsed.sections)) setSections(OPTIONS.map(o=>o.key).filter(k=>parsed.sections!.includes(k)));
        if(typeof parsed.studio==="string") setStudio(parsed.studio);
        if(typeof parsed.onlyUpcoming==="boolean") setOnlyUpcoming(parsed.onlyUpcoming);
      }
    } catch {}
    setHydrated(true);
  },[]);
  useEffect(()=>{
    if(!hydrated)return;
    try{localStorage.setItem("studioflow-admin-operations-v1",JSON.stringify({sections,studio,onlyUpcoming}));}catch{}
  },[hydrated,sections,studio,onlyUpcoming]);
  const filtered = useMemo(()=>initialClasses.filter(row=>studio==="all" || row.studioId===studio),[initialClasses,studio]);
  const upcoming = filtered.filter(row=>row.status==="scheduled" && Date.parse(row.startsAt)>now);
  const watch = upcoming.filter(row=>["watch","due"].includes(classify(row,now)));
  const low = upcoming.filter(row=>row.activeReservations>0 && row.booked>0 && row.booked<=2);
  const protectedCount = upcoming.filter(row=>row.activeReservations>0).length;
  const autoBlocked = filtered.filter(row=>row.autoBlocked);
  const seats = upcoming.reduce((total,row)=>total+row.booked,0);
  const capacity = upcoming.reduce((total,row)=>total+row.capacity,0);
  const visible = onlyUpcoming ? upcoming : filtered;
  const shown = (key:Section)=>sections.includes(key);
  const toggle=(key:Section)=>setSections(current=>current.includes(key)?current.filter(k=>k!==key):[...current,key]);
  return <div className="mx-auto max-w-5xl space-y-5 pb-24">
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Studioflow / Operations</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Daily control</h1>
          <p className="mt-1 text-xs text-ink-muted">{dayKey} · Vietnam time · Refresh for live counts</p>
        </div>
        <button type="button" onClick={()=>setShowSettings(v=>!v)} aria-expanded={showSettings}
          className="btn-secondary min-h-11 shrink-0">⚙ Customize</button>
      </div>
      <div className="flex items-center gap-2">
        <select aria-label="Filter studio" value={studio} onChange={e=>setStudio(e.target.value)}
          className="input min-h-11 flex-1">
          <option value="all">All studios</option>
          {studios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn-secondary min-h-11" type="button" onClick={()=>window.location.reload()}>↻ Refresh</button>
      </div>
    </header>
    {showSettings && <section className="card space-y-3 p-4" aria-label="Dashboard preferences">
      <div><h2 className="font-semibold">Your dashboard sections</h2>
        <p className="mt-1 text-xs text-ink-muted">Choose what appears on this device. Changes save automatically.</p></div>
      {OPTIONS.map(option=><label key={option.key} className="flex min-h-12 items-center gap-3 rounded-lg border border-stone-200 p-3">
        <input type="checkbox" checked={shown(option.key)} onChange={()=>toggle(option.key)} className="h-5 w-5 accent-stone-800"/>
        <span className="min-w-0"><span className="block text-sm font-medium">{option.label}</span><span className="block text-xs text-ink-muted">{option.description}</span></span>
      </label>)}
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={onlyUpcoming}
        onChange={e=>setOnlyUpcoming(e.target.checked)} className="h-5 w-5 accent-stone-800"/>Hide past classes in schedule</label>
    </section>}
    {errors.length>0&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      Could not load all live data. Do not use counts for blocking decisions. {errors.join(" · ")}
    </div>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        ["Upcoming classes",upcoming.length],
        ["Booked spots",seats],
        ["Occupancy",capacity?Math.round(seats/capacity*100)+"%":"—"],
        ["Empty to monitor",watch.length],
      ].map(([name,value])=><div className="card p-3 sm:p-4" key={name}><p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-ink-muted">{name}</p></div>)}
    </div>
    {shown("attention")&&<section className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Needs attention</h2>
        <span className="badge bg-amber-50 text-amber-800">{watch.length} empty</span></div>
      <div className="card divide-y divide-stone-100">
        {watch.length===0?<p className="p-4 text-sm text-ink-muted">No eligible empty upcoming classes.</p>:
          watch.map(row=><div key={row.id} className="p-4">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0">
              <p className="font-semibold">{time(row.startsAt)} · {row.className}</p>
              <p className="mt-1 text-xs text-ink-muted">{row.studio} · {row.instructor}</p>
            </div><span className={"badge shrink-0 "+(classify(row,now)==="due"?"bg-red-50 text-red-700":"bg-amber-50 text-amber-800")}>
              {classify(row,now)==="due"?"Past cutoff · check job":"90-min auto block"}
            </span></div>
            <p className="mt-2 text-xs text-ink-muted">0 bookings · {Math.max(0,Math.ceil((Date.parse(row.startsAt)-now)/60000))} minutes to class. Automatically closes at 90 minutes if still empty.</p>
            <Link href={"/admin/sessions?date="+dayKey} className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-brand-600">Open schedule →</Link>
          </div>)}
      </div>
      {low.length>0&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-800">{low.length} low-occupancy classes are protected</p>
        <p className="mt-1 text-xs text-emerald-800">They have real bookings and must remain open. No customer relocation required.</p>
      </div>}
      <p className="text-xs text-ink-muted">{protectedCount} upcoming classes have active reservations and cannot be automatically blocked. Private classes and filler-seat sessions are excluded.</p>
    </section>}
    {shown("schedule")&&<section className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">Today's classes</h2>
        <label className="flex items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={onlyUpcoming}
          onChange={e=>setOnlyUpcoming(e.target.checked)} />Upcoming only</label></div>
      {visible.length===0?<div className="card p-5 text-sm text-ink-muted">No classes to display.</div>:
      <div className="space-y-2">{visible.map(row=>{
        const state=classify(row,now);
        const occupancy=row.capacity>0?Math.min(100,Math.round(row.booked/row.capacity*100)):0;
        return <article key={row.id} className="card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-base font-semibold">{time(row.startsAt)} · {row.className}</p>
              <p className="mt-1 text-xs text-ink-muted">{row.studio} · {row.instructor}</p></div>
            <span className={"badge shrink-0 "+(state==="blocked"?"bg-stone-200 text-stone-700":
              state==="watch"||state==="due"?"bg-amber-50 text-amber-800":
              state==="protected"?"bg-emerald-50 text-emerald-800":"bg-stone-100 text-ink-muted")}>
              {state==="protected"?"Keep open":state==="blocked"?"Auto-blocked":state==="watch"?"Empty":state==="due"?"Check auto block":state==="excluded"?"Excluded":row.status}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs"><span>{row.booked}/{row.capacity} spots booked</span><span>{occupancy}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-stone-700" style={{width:occupancy+"%"}}/></div>
        </article>;
      })}</div>}
    </section>}
    {shown("blocks")&&<section className="space-y-3">
      <h2 className="text-lg font-semibold">Automatic blocks today</h2>
      <div className="card divide-y divide-stone-100">
      {autoBlocked.length===0?<p className="p-4 text-sm text-ink-muted">No automatic blocks recorded for this studio today.</p>:
        autoBlocked.map(row=><div key={row.id} className="flex items-center justify-between gap-3 p-4">
          <div><p className="text-sm font-semibold">{time(row.startsAt)} · {row.className}</p>
            <p className="text-xs text-ink-muted">{row.studio} · {row.instructor}</p></div>
          <span className="badge bg-stone-100 text-stone-700">Blocked</span>
        </div>)}
      </div>
      <p className="text-xs text-ink-soft">{blocks.length} automatic blocks recorded system-wide for this date.</p>
    </section>}
    {shown("quicklinks")&&<section className="space-y-3"><h2 className="text-lg font-semibold">Quick actions</h2>
      <div className="grid grid-cols-2 gap-3">
        {[["Check-in & payment","/admin/today"],["Manage classes","/admin/sessions"],["Customers","/admin/customers"],["Payroll","/admin/payroll"],["Notifications","/admin/notifications"],["Business overview","/admin"]].map(([label,href])=>
          <Link key={href} href={href} className="card flex min-h-16 items-center justify-between gap-2 p-3 text-sm font-medium">{label}<span aria-hidden="true">→</span></Link>)}
      </div>
    </section>}
    <p className="text-xs leading-relaxed text-ink-soft">Operations dashboard is read-only. The automatic 90-minute block runs separately in Studioflow; classes with any active booking are always protected. Times use Vietnam time.</p>
  </div>;
}
