import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { createServiceClient } from "@/lib/supabase/server";
/** Prevent selling a full package on top of a recent unpaid starter class.
 * Staff should settle that class explicitly from its date in Today's desk.
 */
export async function pendingStarterVisit(customerId:string,pool:string):Promise<string|null>{
 const svc=createServiceClient();
 const min=new Date(Date.now()-30*86400000).toISOString();
 const {data:rows,error}=await svc.from("bookings")
  .select("id,session:sessions!inner(starts_at,class_type:class_types(pool))")
  .eq("customer_id",customerId).eq("status","attended")
  .gte("session.starts_at",min).order("booked_at",{ascending:false}).limit(25);
 if(error)throw error;
 type Booking={id:string;session:{starts_at:string;class_type:{pool:string|null}|null}|null};
 for(const r of (rows||[]) as unknown as Booking[]){
  if((r.session?.class_type?.pool||"regular")!==pool)continue;
  const {data, error:eligibleError}=await svc.rpc("eligible_starter_checkout",{p_booking:r.id});
  if(eligibleError)throw eligibleError;
  if(data===true)return (r.session?.starts_at?formatInTimeZone(new Date(r.session.starts_at),"Asia/Ho_Chi_Minh","yyyy-MM-dd"):"today");
 }
 return null;
}
