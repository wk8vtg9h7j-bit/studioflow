import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createServiceClient } from "@/lib/supabase/server";
import { loadTodayDesk } from "@/lib/checkout/desk.server";
import { OperationsDashboard, type OperationClass, type BlockHistory, type ForecastClass, type PaymentAlert, type PushHealth } from "./OperationsDashboard";

export const dynamic = "force-dynamic";
const TZ = "Asia/Ho_Chi_Minh";

export default async function OperationsPage() {
  const service = createServiceClient();
  const now = new Date();
  const dayKey = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const dayStart = fromZonedTime(dayKey + "T00:00:00", TZ);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const forecastEnd = new Date(dayStart.getTime() + 7*86_400_000);
  const historyStart = new Date(dayStart.getTime() - 28*86_400_000);
  const [sessionsRes, studiosRes, blocksRes, forecastSessionsRes, historySessionsRes, pushQueueRes, pushInstructorRes, pushAdminRes, instructorNamesRes, deskResult] = await Promise.all([
    service.from("sessions")
      .select("id,studio_id,title,starts_at,capacity,filler_seats,status,studio:studios(name,slug,private_only),instructor:instructors(display_name),class_type:class_types(name)")
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString())
      .order("starts_at", { ascending: true }),
    service.from("studios").select("id,name").eq("active",true).order("name"),
    service.from("automatic_class_blocks")
      .select("session_id,blocked_at,original_starts_at")
      .gte("original_starts_at", dayStart.toISOString())
      .lt("original_starts_at", dayEnd.toISOString())
      .order("blocked_at", { ascending: false }),
    service.from("sessions")
      .select("id,studio_id,title,starts_at,capacity,filler_seats,status,studio:studios(name,private_only),class_type:class_types(name)")
      .gte("starts_at",dayStart.toISOString()).lt("starts_at",forecastEnd.toISOString())
      .eq("status","scheduled").order("starts_at",{ascending:true}).limit(500),
    service.from("sessions")
      .select("id,studio_id,starts_at,capacity,status")
      .gte("starts_at",historyStart.toISOString()).lt("starts_at",dayStart.toISOString())
      .neq("status","cancelled").limit(1000),
    service.from("booking_email_notifications")
      .select("id,booking_status,instructor_push_sent_at,instructor_push_attempts,instructor_push_last_error,created_at")
      .in("booking_status",["booked","cancelled"])
      .gte("created_at",new Date(now.getTime()-24*60*60*1000).toISOString())
      .order("created_at",{ascending:false}).limit(500),
    service.from("instructor_push_subscriptions").select("instructor_id"),
    service.from("admin_push_subscriptions").select("profile_id"),
    service.from("instructors").select("id,display_name,active"),
    loadTodayDesk("admin","").catch((error:unknown)=>({error:error instanceof Error?error.message:"Payment desk unavailable",sessions:[] as never[]}))

  ]);

  const sessionRows = (sessionsRes.data ?? []) as unknown as Array<{
    id:string; studio_id:string; title:string|null; starts_at:string;
    capacity:number; filler_seats:number|null; status:string;
    studio:{name:string;slug:string;private_only:boolean}|null;
    instructor:{display_name:string}|null;
    class_type:{name:string}|null;
  }>;
  const ids = sessionRows.map(row => row.id);
  const bookingsRes = ids.length
    ? await service.from("bookings")
       .select("session_id,status,spots_count")
       .in("session_id",ids)
    : { data: [], error: null };
  const counts = new Map<string,{booked:number;reserved:number}>();
  for (const b of bookingsRes.data ?? []) {
    const entry = counts.get(b.session_id) ?? {booked:0,reserved:0};
    if (b.status === "booked" || b.status === "attended")
      entry.booked += Math.max(1,Number(b.spots_count ?? 1));
    if (b.status !== "cancelled")
      entry.reserved += Math.max(1,Number(b.spots_count ?? 1));
    counts.set(b.session_id,entry);
  }

  const blockedIds = new Set((blocksRes.data ?? []).map(b => b.session_id));
  const rows:OperationClass[] = sessionRows.map(s => ({
    id:s.id, studioId:s.studio_id,
    studio:s.studio?.name ?? "Studio",
    className:s.title || s.class_type?.name || "Pilates class",
    instructor:s.instructor?.display_name ?? "Unassigned",
    startsAt:s.starts_at, capacity:s.capacity,
    fillerSeats:s.filler_seats ?? 0,
    booked:counts.get(s.id)?.booked ?? 0,
    activeReservations:counts.get(s.id)?.reserved ?? 0,
    status:s.status,
    privateOnly:Boolean(s.studio?.private_only),
    autoBlocked:blockedIds.has(s.id),
  }));

  const blocks:BlockHistory[] = (blocksRes.data ?? []).map(row => ({
    sessionId:row.session_id, blockedAt:row.blocked_at,
    startsAt:row.original_starts_at,
  }));

  type ForecastSessionRow = {
    id:string;studio_id:string;title:string|null;starts_at:string;capacity:number;
    filler_seats:number|null;status:string;
    studio:{name:string;private_only:boolean}|null;class_type:{name:string}|null;
  };
  const future = (forecastSessionsRes.data ?? []) as unknown as ForecastSessionRow[];
  const historic = (historySessionsRes.data ?? []) as Array<{id:string;studio_id:string;starts_at:string;capacity:number}>;
  const futureIds = future.map(s=>s.id);
  const historyIds = historic.map(s=>s.id);
  const [futureBookingsRes,historyBookingsRes] = await Promise.all([
    futureIds.length ? service.from("bookings").select("session_id,status,spots_count").in("session_id",futureIds)
      : Promise.resolve({data:[],error:null}),
    historyIds.length ? service.from("bookings").select("session_id,status,spots_count").in("session_id",historyIds)
      : Promise.resolve({data:[],error:null})
  ]);
  const aggregate = (rows: Array<{session_id:string;status:string;spots_count:number|null}>) => {
    const result = new Map<string,{seats:number;reserved:number}>();
    for(const b of rows){
      const entry=result.get(b.session_id)??{seats:0,reserved:0};
      if(["booked","attended"].includes(b.status))entry.seats+=Math.max(1,b.spots_count??1);
      if(b.status!=="cancelled")entry.reserved+=Math.max(1,b.spots_count??1);
      result.set(b.session_id,entry);
    }
    return result;
  };
  const fcounts=aggregate((futureBookingsRes.data??[]) as Array<{session_id:string;status:string;spots_count:number|null}>);
  const hcounts=aggregate((historyBookingsRes.data??[]) as Array<{session_id:string;status:string;spots_count:number|null}>);
  const slot=(studioId:string,at:string)=>{
    const d=new Date(at);
    return studioId+":"+formatInTimeZone(d,TZ,"i-HH:mm");
  };
  const historyBySlot=new Map<string,number[]>();
  for(const s of historic){
    const key=slot(s.studio_id,s.starts_at);
    const sample=Math.round(100*(hcounts.get(s.id)?.seats??0)/Math.max(1,s.capacity));
    historyBySlot.set(key,[...(historyBySlot.get(key)??[]),sample]);
  }
  const forecast:ForecastClass[]=future.map(s=>{
    const count=fcounts.get(s.id)??{seats:0,reserved:0};
    const samples=historyBySlot.get(slot(s.studio_id,s.starts_at))??[];
    const average=samples.length?Math.round(samples.reduce((a,b)=>a+b,0)/samples.length):null;
    return {
      id:s.id,studioId:s.studio_id,studio:s.studio?.name??"Studio",
      name:s.title||s.class_type?.name||"Pilates class",startsAt:s.starts_at,
      booked:count.seats,reserved:count.reserved,capacity:s.capacity,
      averageOccupancy:average,sampleCount:samples.length,
      privateOnly:Boolean(s.studio?.private_only),fillerSeats:s.filler_seats??0
    };
  });
  const desk=deskResult as {error?:string;sessions?:Array<{
    id:string;name:string;at:string;studio:string;slug:string;
    bookings:Array<{id:string;name:string;status:string;payment:string;paymentReview:boolean;renewalDue:boolean}>
  }>};
  const payments:PaymentAlert[]=(desk.sessions??[]).flatMap(session=>session.bookings
    .filter(b=>["booked","attended"].includes(b.status)&&(b.payment==="payment_due"||b.paymentReview))
    .map(b=>({id:b.id,customer:b.name,studio:session.studio,className:session.name,
      startsAt:session.at,review:b.paymentReview,status:b.status})));
  const relevantQueue=(pushQueueRes.data??[]) as Array<{
    instructor_push_sent_at:string|null;instructor_push_attempts:number|null;instructor_push_last_error:string|null
  }>;
  const namedInstructors=(instructorNamesRes.data??[]).filter(r=>r.active);
  const pushHealth:PushHealth={
    processed:relevantQueue.filter(r=>r.instructor_push_sent_at!==null).length,
    pending:relevantQueue.filter(r=>r.instructor_push_sent_at===null&&(r.instructor_push_attempts??0)<12).length,
    errors:relevantQueue.filter(r=>Boolean(r.instructor_push_last_error)).length,
    exhausted:relevantQueue.filter(r=>r.instructor_push_sent_at===null&&(r.instructor_push_attempts??0)>=12).length,
    windowCount:relevantQueue.length,
    subscribers:namedInstructors.map(r=>({name:r.display_name,
      devices:(pushInstructorRes.data??[]).filter(x=>x.instructor_id===r.id).length})),
    adminDevices:(pushAdminRes.data??[]).length
  };

  const errors = [sessionsRes.error, studiosRes.error, bookingsRes.error, blocksRes.error, forecastSessionsRes.error, historySessionsRes.error, futureBookingsRes.error, historyBookingsRes.error, pushQueueRes.error, pushInstructorRes.error, pushAdminRes.error, instructorNamesRes.error]
    .filter(Boolean).map(e=>e!.message);
  if(desk.error) errors.push(desk.error);
  return <OperationsDashboard
    initialClasses={rows}
    studios={(studiosRes.data ?? []).map(s=>({id:s.id,name:s.name}))}
    blocks={blocks} dayKey={dayKey} nowIso={now.toISOString()}
    errors={errors} forecast={forecast} payments={payments} pushHealth={pushHealth}
  />;
}
