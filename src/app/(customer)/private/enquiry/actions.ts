"use server";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { configuredEmailProvider, escapeHtml, sendEmail } from "@/lib/email";

const validDate = (s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+"T12:00:00Z")) && new Date(s+"T12:00:00Z").toISOString().slice(0,10)===s;
export async function sendPrivateEnquiry(form:FormData){
 const profile=await requireRole("customer","/private/enquiry");
 const studioId=String(form.get("studio_id")??"");
 const date=String(form.get("date")??"");
 const time=String(form.get("time")??"");
 const phone=String(form.get("phone")??"").trim().slice(0,50);
 const notes=String(form.get("notes")??"").trim().slice(0,1200);
 if(!/^[0-9a-f-]{36}$/i.test(studioId)||!validDate(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||phone.length<6){
  redirect("/private/enquiry?status=invalid");
 }
 const selected=new Date(date+"T"+time+":00+07:00");
 if(selected.getTime()<Date.now()+3600000)redirect("/private/enquiry?status=invalid");
 const svc=createServiceClient();
 const {data:studio}=await svc.from("studios").select("id,name,slug").eq("id",studioId).eq("active",true).maybeSingle();
 if(!studio||!["downtown-pilates","hideaway-pilates","an-thuong-pilates"].includes(studio.slug)) redirect("/private/enquiry?status=invalid");
 const provider=configuredEmailProvider();
 if(!provider)redirect("/private/enquiry?status=email_unavailable");
 const destination=process.env.PRIVATE_ENQUIRY_TO_EMAIL||"info@rechargeddanang.com";
 const name=profile.full_name||"Customer";
 const email=profile.email||"Not provided";
 const lines=["New private Pilates enquiry","Customer: "+name,"Email: "+email,"Phone: "+phone,"Studio: "+studio.name,"Preferred day: "+date,"Preferred time: "+time+" (Vietnam time)","Notes: "+(notes||"None"),"This is a request, not a confirmed booking."];
 const subject="Private Pilates request - "+studio.name;
 const text=lines.join("\n");
 const html='<div style="font-family:Arial,sans-serif;line-height:1.7"><h2>New private Pilates request</h2>'+lines.slice(1).map(l=>"<p>"+escapeHtml(l)+"</p>").join("")+"</div>";
 const sent=await sendEmail(provider,{to:destination,subject,text,html});
 if(!sent.ok){console.error("Private enquiry email failed",sent.error);redirect("/private/enquiry?status=send_failed")}
 redirect("/private/enquiry?status=sent");
}
