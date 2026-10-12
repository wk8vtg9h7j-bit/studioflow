import "server-only";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createServiceClient } from "@/lib/supabase/server";
import { getBookingPaymentStatuses } from "@/lib/bookingPaymentStatus.server";
import { type CheckoutPackage } from "@/components/CheckoutControl";

const TZ = "Asia/Ho_Chi_Minh";
export type DeskBooking = {
  id: string; customerId: string; name: string; status: string;
  spots: number; creditsSpent: number; payment: "package" | "payment_due";
  eligibleStarter: boolean; firstVisit:boolean; pool: string;
};
export type DeskSession = {
  id:string; name:string; at:string; studio:string; slug:string;
  capacity:number; filler:number; instructor:string; pool:string;
  bookings:DeskBooking[];
};
export type DeskData = {
  day: string; sessions:DeskSession[]; packages:CheckoutPackage[];
  booked:number; attended:number; due:number;
};
type Session = {
 id:string;title:string|null;starts_at:string;capacity:number;filler_seats:number|null;
 studio:{name:string;slug:string;timezone:string|null}|null;
 class_type:{name:string;pool:string|null}|null;
 instructor:{id:string;display_name:string}|null;
};
type Booking = {
 id:string; customer_id:string;session_id:string;status:string;spots_count:number|null;
 credits_spent:number; booked_at:string;
 customer:{name:string|null;email:string|null;profile:{full_name:string|null;email:string|null}|null}|null;
};

export async function loadTodayDesk(role:"admin"|"instructor",profileId:string,requestedDay?:string):Promise<DeskData>{
 const svc=createServiceClient();
 const now=new Date();
 const today=formatInTimeZone(now,TZ,"yyyy-MM-dd");
 const valid=requestedDay&&/^\\d{4}-\\d{2}-\\d{2}$/.test(requestedDay)&&
   !Number.isNaN(Date.parse(requestedDay+"T12:00:00Z"));
 const day=valid?requestedDay!:today;
 const from=fromZonedTime(day+"T00:00:00",TZ).toISOString();
 const until=fromZonedTime(formatInTimeZone(new Date(Date.parse(from)+86400000),TZ,"yyyy-MM-dd")+"T00:00:00",TZ).toISOString();
 let instructorId:string|null=null;
 if(role==="instructor"){
  const {data}=await svc.from("instructors").select("id").eq("profile_id",profileId).maybeSingle();
  instructorId=data?.id||null;
 }
 let query=svc.from("sessions")
  .select("id,title,starts_at,capacity,filler_seats,studio:studios(name,slug,timezone),class_type:class_types(name,pool),instructor:instructors(id,display_name)")
  .gte("starts_at",from).lt("starts_at",until).neq("status","cancelled")
  .order("starts_at",{ascending:true});
 if(role==="instructor")query=query.eq("instructor_id",instructorId||"00000000-0000-0000-0000-000000000000");
 const [sessionRes,packageRes]=await Promise.all([
  query,svc.from("packages").select("id,name,credits,price_cents,currency,pool")
   .eq("active",true).gt("price_cents",0).order("price_cents",{ascending:true})
 ]);
 if(sessionRes.error)throw sessionRes.error;
 const all=(sessionRes.data||[]) as unknown as Session[];
 const ids=all.map(s=>s.id);
 const {data:bookingData,error:bookingError}=ids.length?await svc.from("bookings")
  .select("id,customer_id,session_id,status,spots_count,credits_spent,booked_at,customer:customers(name,email,profile:profiles(full_name,email))")
  .in("session_id",ids).in("status",["booked","attended","no_show","waitlisted"])
  .order("booked_at",{ascending:true}):{data:[],error:null};
 if(bookingError)throw bookingError;
 const bookings=(bookingData||[]) as unknown as Booking[];
 const poolById=new Map(all.map(s=>[s.id,s.class_type?.pool||"regular"]));
 const {data:attendedHistory}=await svc.from("bookings").select("id,customer_id")
  .eq("status","attended").limit(1000);
 const visitedCount=new Map<string,number>();
 for(const row of attendedHistory||[])visitedCount.set(row.customer_id,(visitedCount.get(row.customer_id)||0)+1);
 const paymentMap=await getBookingPaymentStatuses(bookings.map(b=>({
  id:b.id,customerId:b.customer_id,creditsSpent:b.credits_spent,
  pool:poolById.get(b.session_id)||"regular",bookedAt:b.booked_at,status:b.status
 })));
 const paymentDue=bookings.filter(b=>b.status==="attended"&&paymentMap.get(b.id)==="payment_due");
 // Eligibility reads only matching booked credit sources. Requests run in
 // parallel rather than holding up the page one network trip per customer.
 const flags=await Promise.all(paymentDue.map(async b=>{
  const {data}=await svc.rpc("eligible_starter_checkout",{p_booking:b.id});
  return [b.id, data===true] as const;
 }));
 const starter=new Map<string,boolean>(flags);
 const rowsBySession=new Map<string,DeskBooking[]>();
 for(const b of bookings){
  const list=rowsBySession.get(b.session_id)||[];
  list.push({id:b.id,customerId:b.customer_id,
   name:b.customer?.profile?.full_name||b.customer?.name||b.customer?.profile?.email||b.customer?.email||"Customer",
   status:b.status,spots:b.spots_count||1,creditsSpent:b.credits_spent||1,
   payment:paymentMap.get(b.id)||"payment_due",eligibleStarter:starter.get(b.id)||false,
   firstVisit:(visitedCount.get(b.customer_id)||0)<=(b.status==="attended"?1:0),
   pool:poolById.get(b.session_id)||"regular"});
  rowsBySession.set(b.session_id,list);
 }
 const sessions=all.map(s=>({
  id:s.id,name:s.title||s.class_type?.name||"Pilates class",at:s.starts_at,
  studio:s.studio?.name||"Studio",slug:s.studio?.slug||"",
  capacity:s.capacity,filler:s.filler_seats||0,instructor:s.instructor?.display_name||"Unassigned",
  pool:s.class_type?.pool||"regular",bookings:rowsBySession.get(s.id)||[]
 }));
 return {day,sessions,packages:(packageRes.data||[]) as CheckoutPackage[],
  booked:bookings.filter(b=>b.status==="booked"||b.status==="attended").reduce((n,b)=>n+(b.spots_count||1),0),
  attended:bookings.filter(b=>b.status==="attended").reduce((n,b)=>n+(b.spots_count||1),0),
  due:paymentDue.length};
}
