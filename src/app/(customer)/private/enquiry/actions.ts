"use server";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { configuredEmailProvider, escapeHtml, sendEmail } from "@/lib/email";
import { sendStudioFlowPush, webPushConfigured } from "@/lib/webPush";

const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+"T12:00:00Z"))&&new Date(s+"T12:00:00Z").toISOString().slice(0,10)===s;
export async function sendPrivateEnquiry(form:FormData){
 const profile=await requireRole("customer","/private/enquiry");
 const studioId=String(form.get("studio_id")??"");
 const date=String(form.get("date")??"");
 const time=String(form.get("time")??"");
 const phone=String(form.get("phone")??"").trim().slice(0,50);
 const notes=String(form.get("notes")??"").trim().slice(0,1200);
 if(!/^[0-9a-f-]{36}$/i.test(studioId)||!validDate(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||phone.length<6)
  redirect("/private/enquiry?status=invalid");
 const selected=new Date(date+"T"+time+":00+07:00");
 if(selected.getTime()<Date.now()+3600000)redirect("/private/enquiry?status=invalid");
 const svc=createServiceClient();
 const {data:studio}=await svc.from("studios").select("id,name,slug").eq("id",studioId).eq("active",true).maybeSingle();
 if(!studio||!["downtown-pilates","hideaway-pilates","an-thuong-pilates"].includes(studio.slug))
  redirect("/private/enquiry?status=invalid");

 // Record the enquiry before trying optional notification channels; email failures
 // must never erase a valid request or prevent the team from seeing it.
 const {error:saveError}=await svc.from("private_enquiries").insert({
   profile_id:profile.id,studio_id:studio.id,preferred_at:selected.toISOString(),phone,notes
 });
 if(saveError){
   console.error("Private enquiry storage failed",saveError.message);
   redirect("/private/enquiry?status=send_failed");
 }
 const name=profile.full_name||"Customer";
 const email=profile.email||"Not provided";
 const lines=["New private Pilates enquiry","Customer: "+name,"Email: "+email,"Phone: "+phone,
  "Studio: "+studio.name,"Preferred day: "+date,"Preferred time: "+time+" (Vietnam time)",
  "Notes: "+(notes||"None"),"This is a request, not a confirmed booking."];
 // Fan out to every *subscribed admin device*, not only the class instructor.
 if(webPushConfigured()){
   const {data:admins}=await svc.from("profiles").select("id").eq("role","admin");
   const adminIds=(admins??[]).map(a=>a.id);
   if(adminIds.length){
     const {data:subscriptions,error:subscriptionError}=await svc.from("admin_push_subscriptions")
      .select("endpoint,p256dh,auth").in("profile_id",adminIds);
     if(subscriptionError)console.error("Private enquiry push lookup failed",subscriptionError.message);
     else await Promise.allSettled((subscriptions??[]).map(async sub=>{
       try{
         await sendStudioFlowPush({endpoint:sub.endpoint,p256dh:sub.p256dh,auth:sub.auth},{
           title:"Private Pilates time request · "+studio.name,
           body:name+" requested "+date+" at "+time+" · Open admin requests",
           url:"/admin/private-requests",tag:"private-enquiry-"+studio.id+"-"+selected.getTime()
         });
       }catch(err){console.error("Private enquiry push failed",err instanceof Error?err.message:"Unknown delivery error");}
     }));
   }
 }
 const provider=configuredEmailProvider();
 if(provider){
   const destination=process.env.PRIVATE_ENQUIRY_TO_EMAIL||"info@rechargeddanang.com";
   const html='<div style="font-family:Arial,sans-serif;line-height:1.7"><h2>New private Pilates request</h2>'+lines.slice(1).map(l=>"<p>"+escapeHtml(l)+"</p>").join("")+"</div>";
   const sent=await sendEmail(provider,{to:destination,subject:"Private Pilates request - "+studio.name,text:lines.join("\n"),html});
   if(!sent.ok)console.error("Private enquiry email failed",sent.error);
 }
 redirect("/private/enquiry?status=sent");
}
