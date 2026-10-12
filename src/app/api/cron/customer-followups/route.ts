import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { configuredEmailProvider, sendEmail, escapeHtml } from "@/lib/email";
import { getBookingPaymentStatuses } from "@/lib/bookingPaymentStatus.server";
import { sendConnectedStudioEmail, type ConnectedStudioMail } from "@/lib/emailGoogle";
export const maxDuration=60;
type Customer={id:string;name:string|null;email:string|null;marketing_opt_in:boolean;profile:{full_name:string|null;email:string|null}|null};
type Booking={id:string;customer_id:string;status:string;session:{starts_at:string;class_type:{pool:string|null}|null}|null};
type Followup={customer:Customer;kind:"unpaid_first_visit"|"last_credit"|"inactive_30";eventKey:string};
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret || request.headers.get("authorization")!=="Bearer "+secret){
  return NextResponse.json({error:"Unauthorized"},{status:401});
 }
 const provider=configuredEmailProvider();
 const svc=createServiceClient();
 const {data:studioMail}=provider?{data:null}:await svc.from("studios")
  .select("id,google_account_email,google_refresh_token,google_token_status")
  .eq("google_token_status","connected").not("google_refresh_token","is",null)
  .not("google_account_email","is",null).order("name",{ascending:true}).limit(1).maybeSingle();
 if(!provider&&!studioMail)return NextResponse.json({enabled:false,reason:"No connected email provider or studio Gmail",sent:0});

 const now=new Date();
 const month=now.toISOString().slice(0,7);
 const since=new Date(now.getTime()-65*86400000).toISOString();
 const overdueCutoff=new Date(now.getTime()-24*3600000).toISOString();
 const [{data:customerRows,error:customerError},{data:bookingRows,error:bookingError},{data:purchases,error:purchaseError}]=await Promise.all([
  svc.from("customers").select("id,name,email,marketing_opt_in,profile:profiles(full_name,email)")
   .eq("marketing_opt_in",true).limit(1000),
  svc.from("bookings")
   .select("id,customer_id,status,session:sessions(starts_at,class_type:class_types(pool))")
   .eq("status","attended").limit(1000),
  svc.from("credit_ledger").select("customer_id,created_at")
   .in("reason",["purchase","single_class_credit"]).gte("created_at",new Date(now.getTime()-180*86400000).toISOString()).limit(1000),
 ]);
 if(customerError||bookingError||purchaseError){
  return NextResponse.json({error:customerError?.message||bookingError?.message||purchaseError?.message},{status:500});
 }
 const customers=(customerRows||[]) as unknown as Customer[];
 const bookings=(bookingRows||[]) as unknown as Booking[];
 const customerById=new Map(customers.map(c=>[c.id,c]));
 const purchased=new Set((purchases||[]).map(p=>p.customer_id));
 const latestVisit=new Map<string,string>();
 for(const b of bookings)if(b.session?.starts_at){
  const last=latestVisit.get(b.customer_id);
  if(!last||b.session.starts_at>last)latestVisit.set(b.customer_id,b.session.starts_at);
 }
 const candidates:Followup[]=[];
 // Transactional first-visit reminder; only first visits after rollout, at
 // least 24 hours old, never on a booking with a recorded checkout.
 const eligible=bookings.filter(b=>b.session&&b.session.starts_at>="2026-10-12T00:00:00+07:00"&&b.session.starts_at<overdueCutoff&&customerById.has(b.customer_id));
 const applicable=await getBookingPaymentStatuses(eligible.map(b=>({
  id:b.id,customerId:b.customer_id,creditsSpent:1,pool:b.session?.class_type?.pool||"regular"
 })));
 const starterFlags=await Promise.all(eligible.map(async b=>{
  const {data}=await svc.rpc("eligible_starter_checkout",{p_booking:b.id});
  return [b.id,data===true] as const;
 }));
 const flags=new Map(starterFlags);
 for(const b of eligible){
  const c=customerById.get(b.customer_id)!;
  if(flags.get(b.id)&&applicable.get(b.id)==="payment_due"){
   candidates.push({customer:c,kind:"unpaid_first_visit",eventKey:"unpaid:"+b.id});
  }
 }
 const ids=customers.map(c=>c.id);
 const {data:balances,error:balanceError}=ids.length?await svc.rpc("instructor_customer_balances",{p_customer_ids:ids}):{data:[],error:null};
 if(balanceError)return NextResponse.json({error:balanceError.message},{status:500});
 const balanceById=new Map(((balances||[]) as Array<{customer_id:string;regular_balance:number}>).map(b=>[b.customer_id,b.regular_balance]));
 const pendingIds=new Set(candidates.map(c=>c.customer.id));
 for(const c of customers){
  if(pendingIds.has(c.id))continue;
  const last=latestVisit.get(c.id);
  if(!last)continue;
  if(purchased.has(c.id)&&balanceById.get(c.id)===1&&last>=since){
   candidates.push({customer:c,kind:"last_credit",eventKey:"last-credit:"+c.id+":"+month});
  }else if(last<new Date(now.getTime()-30*86400000).toISOString()&&
   last>=new Date(now.getTime()-60*86400000).toISOString()){
   candidates.push({customer:c,kind:"inactive_30",eventKey:"inactive:"+c.id+":"+month});
  }
 }
 // Rate limit daily outreach; payment reminders take precedence.
 let sent=0,failed=0,claimed=0;
 for(const lead of candidates.slice(0,12)){
  const to=lead.customer.profile?.email||lead.customer.email;
  if(!to||!to.includes("@"))continue;
  const {data:reservation,error:insertError}=await svc.from("customer_followup_log").insert({
   customer_id:lead.customer.id,kind:lead.kind,event_key:lead.eventKey,recipient_email:to,status:"claimed"
  }).select("id").maybeSingle();
  // UNIQUE conflict means another worker already claimed this message.
  if(insertError){if(insertError.code==="23505")continue;failed++;continue;}
  if(!reservation)continue;claimed++;
  const who=(lead.customer.profile?.full_name||lead.customer.name||"there").trim();
  const title=lead.kind==="unpaid_first_visit"?"A quick note about your first Pilates class":
   lead.kind==="last_credit"?"You have one Pilates class left":"We would love to see you again";
  const body=lead.kind==="unpaid_first_visit"?
   "Thanks for joining us for Pilates! Your first-class booking credit reserved the spot but did not cover payment. You can pay for this class or include it in a package during your next visit. Please contact the studio if you have already paid.":
   lead.kind==="last_credit"?
    "You have one class remaining in your Pilates package. We would love to help you continue your practice.":
    "We have missed seeing you at Pilates by Recharged. Whenever you are ready, you can book another class at Downtown or Hideaway.";
  const textBody="Hi "+who+",\n\n"+body+"\n\nPilates by Recharged\nTo stop marketing emails, reply with unsubscribe.";
  const message={to,subject:title,text:textBody,
   html:"<p>Hi "+escapeHtml(who)+",</p><p>"+escapeHtml(body)+"</p><p>Pilates by Recharged</p><small>To stop marketing emails, reply with unsubscribe.</small>"};
  const result=provider?await sendEmail(provider,message):
   await sendConnectedStudioEmail(studioMail as ConnectedStudioMail,message);
  if(result.ok){
   await svc.from("customer_followup_log").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",reservation.id);
   sent++;
  }else{
   await svc.from("customer_followup_log").update({status:"failed",last_error:result.error.slice(0,400)}).eq("id",reservation.id);
   failed++;
  }
 }
 return NextResponse.json({enabled:true,candidates:candidates.length,claimed,sent,failed});
}
