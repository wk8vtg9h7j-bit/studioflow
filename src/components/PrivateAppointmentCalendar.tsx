"use client";

import { useState } from "react";
import Link from "next/link";
import type { PrivateCalendarData, PrivateSlot, PrivateRequest } from "@/lib/privateCalendar.server";
import {
  bookPrivateSlotAction, cancelPrivateRequestAction, closePrivateSlotAction,
  publishPrivateSlotAction, requestPrivateTimeAction, respondPrivateRequestAction,
} from "@/lib/privateCalendarActions";

type Kind = "open"|"reserved"|"booked"|"pending"|"busy"|"request"|"publish"|"closed";
type TimeState = { kind: Kind; slot?: PrivateSlot; request?: PrivateRequest };
const HOURS = Array.from({length:14},(_,i)=>i+7);
const longDate = new Intl.DateTimeFormat("en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"});
const shortDate = new Intl.DateTimeFormat("en-GB",{weekday:"short",timeZone:"UTC"});
const monthDate = new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",timeZone:"UTC"});

function dayUTC(day:string) {return new Date(day+"T12:00:00Z");}
function move(day:string,days:number) {
  return new Date(dayUTC(day).getTime()+days*86400000).toISOString().slice(0,10);
}
function localTime(hour:number) {return String(hour).padStart(2,"0")+":00";}
function dayInstant(day:string,hour:number) {return Date.parse(day+"T"+localTime(hour)+":00+07:00");}
function hourOf(iso:string) {return new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Ho_Chi_Minh"}).format(new Date(iso));}

function HiddenFields({data,hour,slotId,requestId}:{
 data:PrivateCalendarData; hour?:number;slotId?:string;requestId?:string;
}) {
 return <>
  <input type="hidden" name="day" value={data.day}/>
  <input type="hidden" name="studio_id" value={data.studioId}/>
  <input type="hidden" name="instructor_id" value={data.instructorId}/>
  {hour!==undefined && <input type="hidden" name="hour" value={hour}/>}
  {slotId && <input type="hidden" name="slot_id" value={slotId}/>}
  {requestId && <input type="hidden" name="request_id" value={requestId}/>}
 </>;
}

export function PrivateAppointmentCalendar({data,role,notice,error}:{
 data:PrivateCalendarData;role:"instructor"|"customer";notice?:string;error?:string;
}) {
 const [selected,setSelected] = useState<number|null>(null);
 const teacher = data.teachers.find(x=>x.id===data.instructorId)?.display_name || "Instructor";
 const studio = data.studios.find(x=>x.id===data.studioId)?.name || "Studio";
 const base = role==="instructor"?"/instructor/private":"/private";
 function url(day=data.day,studioId=data.studioId,instructorId=data.instructorId) {
  const qs = new URLSearchParams({day,studio:studioId});
  if(role==="customer")qs.set("instructor",instructorId);
  return base+"?"+qs.toString();
 }
 const dow=(dayUTC(data.day).getUTCDay()+6)%7;
 const monday=move(data.day,-dow);
 const today = new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Asia/Ho_Chi_Minh"})
  .formatToParts(new Date());
 const localToday = (today.find(x=>x.type==="year")?.value??"") + "-" +
  (today.find(x=>x.type==="month")?.value??"") + "-" + (today.find(x=>x.type==="day")?.value??"");
 const maxDay = move(localToday,28);
 const days=Array.from({length:7},(_,i)=>move(monday,i));
 const withinNow=(hour:number)=>dayInstant(data.day,hour)>Date.now()+2*3600000;

 function stateFor(hour:number):TimeState {
  const at=dayInstant(data.day,hour);
  const end=at+50*60000;
  const slot=data.slots.find(s=>s.studio_id===data.studioId && Date.parse(s.starts_at)===at && s.status!=="closed");
  const request=data.requests.find(r=>r.studio_id===data.studioId &&
    Date.parse(r.starts_at)===at && ["pending","approved"].includes(r.status));
  if(slot?.status==="booked" && slot.mine && role==="customer")return {kind:"booked",slot};
  if(request?.status==="pending" && role==="customer")return {kind:"pending",request};
  if(slot?.status==="open" && (role==="instructor" || !slot.reserved_for_customer_id || request?.status==="approved")) {
    return {kind:slot.reserved_for_customer_id?"reserved":"open",slot,request};
  }
  const classBusy=data.busy.some(s=>Date.parse(s.starts_at)<end && Date.parse(s.ends_at)>at);
  const otherSlot=data.slots.some(s=>s.status==="open" &&
    (s.studio_id!==data.studioId || Date.parse(s.starts_at)!==at) &&
    Date.parse(s.starts_at)<end && Date.parse(s.ends_at)>at);
  if(slot?.status==="booked" || classBusy || otherSlot || (slot?.status==="open" && !!slot.reserved_for_customer_id))return {kind:"busy",slot};
  if(!withinNow(hour))return {kind:"closed"};
  return {kind:role==="instructor"?"publish":"request"};
 }
 const selectedState=selected===null?null:stateFor(selected);
 const labels:Record<Kind,string>={
  open:"Available",reserved:"Approved",booked:"Your booking",pending:"Pending",
  busy:"Unavailable",request:"Request time",publish:"Open time",closed:"Not available",
 };
 const activeRequests=data.requests.filter(r=>r.status==="pending" && role==="instructor");
 const latestRequests=data.requests.filter(r=>role==="customer" && ["pending","approved","booked","declined"].includes(r.status));

 return <div className="space-y-6">
  <section className="relative overflow-hidden rounded-[28px] bg-[#14242c] px-6 py-8 text-white shadow-xl shadow-[#14242c]/10 sm:px-10 sm:py-10">
   <div className="pointer-events-none absolute -right-16 -top-28 h-80 w-80 rounded-full border border-white/10 bg-[#c4a572]/[0.08]"/>
   <div className="pointer-events-none absolute right-14 top-10 h-48 w-48 rounded-full border border-white/[0.09]"/>
   <p className="relative text-[11px] font-semibold uppercase tracking-[0.35em] text-[#d3b783]">StudioFlow · Private Pilates</p>
   <div className="relative mt-5 flex flex-wrap items-end justify-between gap-6">
    <div className="max-w-xl">
     <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
      {role==="instructor"?"Your private hours.":"A session, entirely yours."}
     </h1>
     <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/65 sm:text-base">
      {role==="instructor"
       ?"Open the appointment times you are free to teach. Requests for other hours appear in your inbox for approval."
       :"Reserve an open private session instantly, or request a different hour and let your instructor confirm availability."}
     </p>
    </div>
    <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur">
     <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">{role==="instructor"?"Duration":"Private credits"}</p>
     <div className="mt-1 text-3xl font-semibold tabular-nums">{role==="instructor"?"50 min":data.creditBalance}</div>
     {role==="customer"&&<p className="mt-1 text-xs text-white/60">1 credit per session</p>}
    </div>
   </div>
  </section>

  {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800">{notice}</div>}
  {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-medium text-rose-700">{error}</div>}

  <section className="rounded-[24px] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
   <div className="flex flex-wrap items-center justify-between gap-4">
    <div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9d865f]">01 / Location</p>
     <h2 className="mt-1 text-lg font-semibold text-[#172831]">Choose your studio</h2></div>
    <p className="text-xs text-stone-400">Da Nang · Vietnam</p>
   </div>
   <div className="mt-4 flex flex-wrap gap-2">
    {data.studios.map(s=><Link key={s.id} href={url(data.day,s.id)}
     className={"rounded-xl border px-4 py-3 text-sm font-medium transition "+(s.id===data.studioId
      ?"border-[#182d36] bg-[#182d36] text-white shadow-md":"border-stone-200 bg-white text-stone-600 hover:border-[#bc9e6a]")}>
     {s.slug.includes("downtown")?"Downtown":s.slug.includes("hideaway")?"Hideaway":s.name}
    </Link>)}
   </div>
   {role==="customer" && <div className="mt-6">
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9d865f]">02 / Instructor</p>
    <div className="flex flex-wrap gap-2">
     {data.teachers.map(t=><Link key={t.id} href={url(data.day,data.studioId,t.id)}
      className={"rounded-full border px-4 py-2 text-sm transition "+(t.id===data.instructorId
       ?"border-[#bea06c] bg-[#faf4e9] font-semibold text-[#553f21]":"border-stone-200 text-stone-600 hover:border-stone-400")}>
      {t.display_name}
     </Link>)}
    </div>
   </div>}
  </section>

  {role==="instructor" && <section className="rounded-[24px] border border-stone-200 bg-white px-5 py-5 shadow-sm sm:px-6">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9d865f]">Awaiting your answer</p>
     <h2 className="mt-1 text-lg font-semibold text-[#172831]">Private requests <span className="ml-1 text-sm font-normal text-stone-500">({activeRequests.length})</span></h2></div>
    <span className="rounded-full bg-[#f5efe4] px-3 py-1 text-xs font-medium text-[#886d40]">Instructor approval</span>
   </div>
   {activeRequests.length===0?<p className="mt-4 text-sm text-stone-500">No pending private session requests. New ones will appear here, and can also reach your phone if push notifications are enabled.</p>
    :<div className="mt-4 divide-y divide-stone-100">
     {activeRequests.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
      <div>
       <p className="font-semibold text-[#172831]">{r.customer_name}</p>
       <p className="mt-1 text-sm text-stone-600">{longDate.format(dayUTC(r.starts_at.slice(0,10)))} · {hourOf(r.starts_at)} · {data.studios.find(s=>s.id===r.studio_id)?.name||"Studio"}</p>
       {r.note && <p className="mt-1 max-w-md text-sm italic text-stone-500">“{r.note}”</p>}
      </div>
      <div className="flex gap-2">
       <form action={respondPrivateRequestAction}>
        <HiddenFields data={data} requestId={r.id}/>
        <input type="hidden" name="response" value="decline"/>
        <button type="submit" className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50">Decline</button>
       </form>
       <form action={respondPrivateRequestAction}>
        <HiddenFields data={data} requestId={r.id}/>
        <input type="hidden" name="response" value="approve"/>
        <button type="submit" className="rounded-xl bg-[#152a32] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#294651]">Approve time</button>
       </form>
      </div>
     </div>)}
    </div>}
  </section>}

  <section className="rounded-[24px] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
   <div className="flex flex-wrap items-center justify-between gap-4">
    <div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9d865f]">{role==="instructor"?"02":"03"} / Calendar</p>
     <h2 className="mt-1 text-xl font-semibold text-[#172831]">{longDate.format(dayUTC(data.day))}</h2>
     <p className="mt-1 text-sm text-stone-500">{teacher} · {studio.split(" - ")[0]} · 50-minute appointments</p>
    </div>
    <div className="flex gap-2">
     {move(monday,-7)>=localToday && <Link href={url(move(monday,-7))} aria-label="Previous week" className="rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50">←</Link>}
     <Link href={url(localToday)} className="rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50">Today</Link>
     {move(monday,7)<=maxDay && <Link href={url(move(monday,7))} aria-label="Next week" className="rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50">→</Link>}
    </div>
   </div>
   <div className="mt-6 grid grid-cols-7 gap-1.5 sm:gap-3">
    {days.map(day=>{
     const active=day===data.day;const valid=day>=localToday&&day<=maxDay;
     return valid?<Link key={day} href={url(day)} className={"rounded-2xl px-1 py-3 text-center transition sm:py-4 "+(active
      ?"bg-[#172c35] text-white shadow-lg":"bg-[#f6f5f2] text-stone-600 hover:bg-[#eeeae3]")}>
      <span className={"block text-[10px] font-medium uppercase tracking-wider "+(active?"text-white/65":"text-stone-400")}>{shortDate.format(dayUTC(day))}</span>
      <span className="mt-1 block text-lg font-semibold tabular-nums sm:text-2xl">{day.slice(-2)}</span>
     </Link>:<div key={day} className="rounded-2xl bg-stone-50 px-1 py-3 text-center opacity-40"><span className="block text-[10px] uppercase">{shortDate.format(dayUTC(day))}</span><span className="mt-1 block text-lg">{day.slice(-2)}</span></div>;
    })}
   </div>
   <div className="mt-7 flex flex-wrap items-center gap-4 border-b border-stone-100 pb-4 text-xs text-stone-500">
    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#609c83]"/>Available</span>
    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#c09c65]"/>Request / approve</span>
    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-stone-300"/>Unavailable</span>
    <span className="ml-auto text-stone-400">All times GMT+7</span>
   </div>
   <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {HOURS.map(hour=>{
     const current=stateFor(hour),kind=current.kind;
     const enabled=!["closed","busy","booked","pending"].includes(kind);
     const chosen=selected===hour;
     const tint=kind==="open"?"border-[#cee8d9] bg-[#f2faf5]":
      kind==="reserved"?"border-[#c9dcf5] bg-[#f1f6fd]":
      kind==="pending"?"border-[#f4dfbc] bg-[#fef9ec]":
      kind==="request"||kind==="publish"?"border-[#e4ddcc] bg-[#fcfaf5]":"border-stone-200 bg-stone-50";
     return <button key={hour} type="button" disabled={!enabled} onClick={()=>setSelected(chosen?null:hour)}
      className={"relative min-h-[94px] rounded-2xl border px-4 py-4 text-left transition-all "+tint+" "+
       (chosen?"ring-2 ring-[#bd9c66] ring-offset-2":enabled?"hover:-translate-y-0.5 hover:shadow-md":"cursor-default opacity-65")}>
      <span className={"block text-xl font-semibold tabular-nums "+(enabled?"text-[#173039]":"text-stone-500")}>{localTime(hour)}</span>
      <span className={"mt-2 block text-xs font-medium "+(kind==="open"?"text-[#307354]":kind==="pending"||kind==="request"||kind==="publish"?"text-[#9a7845]":"text-stone-500")}>{labels[kind]}</span>
      {enabled && <span className="absolute right-3 top-3 text-xs text-[#bfa16d]">↗</span>}
     </button>;
    })}
   </div>

   {selected!==null && selectedState && !["busy","closed","booked","pending"].includes(selectedState.kind) && <div className="mt-6 rounded-[22px] border border-[#ded2bc] bg-[#faf7f0] p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
     <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#96794c]">Selected appointment</p>
      <h3 className="mt-1 text-xl font-semibold text-[#1a2e37]">{localTime(selected)} – {localTime(selected)+""} <span className="text-sm font-normal text-stone-500">· 50 minutes</span></h3>
      <p className="mt-1 text-sm text-stone-500">{teacher} · {studio.split(" - ")[0]} · {monthDate.format(dayUTC(data.day))}</p>
     </div>
     <button type="button" className="text-sm text-stone-500 hover:text-stone-900" onClick={()=>setSelected(null)}>Close ✕</button>
    </div>
    {role==="instructor" ? (
     selectedState.kind==="publish" ?
      <form className="mt-5" action={publishPrivateSlotAction}><HiddenFields data={data} hour={selected}/>
       <button className="rounded-xl bg-[#18333b] px-6 py-3 text-sm font-semibold text-white hover:bg-[#274a54]">Open this time for booking →</button>
      </form> :
      <form className="mt-5" action={closePrivateSlotAction}><HiddenFields data={data} slotId={selectedState.slot?.id}/>
       <p className="mb-3 text-sm text-stone-600">{selectedState.kind==="reserved"?"Approved for one customer. Closing it will decline their approved request.":"This time is currently bookable by customers."}</p>
       <button className="rounded-xl border border-rose-200 bg-white px-5 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50">Close this time</button>
      </form>
    ) : selectedState.kind==="request" ?
      <form className="mt-5 space-y-3" action={requestPrivateTimeAction}><HiddenFields data={data} hour={selected}/>
       <label className="block text-xs font-semibold uppercase tracking-wider text-stone-600" htmlFor="private-note">Message for the instructor (optional)</label>
       <textarea id="private-note" name="note" maxLength={300} rows={2} placeholder="Anything the instructor should know?" className="w-full resize-y rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#c5a572]"/>
       <p className="text-xs text-stone-500">No credits are deducted until the time is approved and you book it.</p>
       <button className="rounded-xl bg-[#18333b] px-6 py-3 text-sm font-semibold text-white hover:bg-[#274a54]">Send availability request →</button>
      </form> :
      <form className="mt-5" action={bookPrivateSlotAction}><HiddenFields data={data} slotId={selectedState.slot?.id}/>
       <p className="mb-4 text-sm text-stone-600">Confirm this private appointment using one private package credit.</p>
       {data.creditBalance>0 ?
        <button className="rounded-xl bg-[#18333b] px-6 py-3 text-sm font-semibold text-white hover:bg-[#274a54]">Confirm private booking · 1 credit →</button> :
        <p className="rounded-xl border border-amber-200 bg-white p-4 text-sm text-amber-800">You need one private credit to confirm. Please purchase a private package from the studio, then return to book.</p>}
      </form>
    }
   </div>}
  </section>

  {role==="customer" && <section className="rounded-[24px] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9d865f]">Your private sessions</p>
    <h2 className="mt-1 text-lg font-semibold text-[#172831]">Requests & confirmations</h2>
    {latestRequests.length===0?<p className="mt-4 text-sm text-stone-500">No private requests yet. Select a time above to get started.</p>:
      <div className="mt-4 divide-y divide-stone-100">
       {latestRequests.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><p className="text-sm font-semibold text-[#172831]">{monthDate.format(dayUTC(r.starts_at.slice(0,10)))} · {hourOf(r.starts_at)} · {data.studios.find(s=>s.id===r.studio_id)?.name?.split(" - ")[0]}</p>
         <p className="mt-1 text-xs text-stone-500">{r.status==="approved"?"Instructor approved — choose this time above to confirm with a private credit.":r.status==="pending"?"Waiting for instructor confirmation":r.status==="booked"?"Booked with private credit":r.status==="declined"?"Instructor unavailable":"Cancelled"}</p>
        </div>
        <div className="flex items-center gap-2">
         <span className={"rounded-full px-3 py-1 text-xs font-semibold "+(r.status==="approved"||r.status==="booked"?"bg-emerald-50 text-emerald-700":r.status==="pending"?"bg-amber-50 text-amber-800":"bg-stone-100 text-stone-600")}>{r.status}</span>
         {["pending","approved"].includes(r.status)&&<form action={cancelPrivateRequestAction}><HiddenFields data={data} requestId={r.id}/><button className="text-xs font-medium text-stone-500 underline hover:text-rose-700">Withdraw</button></form>}
        </div>
       </div>)}
      </div>}
   </section>}

  <p className="pb-6 text-center text-xs leading-relaxed text-stone-400">Private sessions are 50 minutes · Availability is subject to instructor confirmation · All times are Da Nang local time</p>
 </div>;
}
