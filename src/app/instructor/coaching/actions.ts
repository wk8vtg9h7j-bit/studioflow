"use server";
import {revalidatePath} from "next/cache";
import {requireRole} from "@/lib/auth";
import {createServiceClient} from "@/lib/supabase/server";
import {instructorCoachingAccess} from "@/lib/privateCoaching.server";
const uid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function saveCoachingProgram(form:FormData){
 const customerId=String(form.get("customer_id")??"");
 if(!uid.test(customerId))throw Error("Invalid customer");
 const {svc}=await instructorCoachingAccess(customerId);
 const {data:studio}=await svc.from("studios").select("id").eq("slug","an-thuong-pilates").single();
 if(!studio)throw Error("An Thuong is not configured.");
 const goals=String(form.get("goals")??"").slice(0,4000);
 const program=String(form.get("program")??"").slice(0,12000);
 const {error}=await svc.from("private_coaching").update({goals,program,updated_at:new Date().toISOString()}).eq("customer_id",customerId).eq("studio_id",studio.id);
 if(error)throw Error(error.message);
 revalidatePath("/coaching");revalidatePath("/instructor/coaching/"+customerId);
}
export async function saveWeeklyReview(form:FormData){
 const customerId=String(form.get("customer_id")??"");
 if(!uid.test(customerId))throw Error("Invalid customer");
 const {svc}=await instructorCoachingAccess(customerId);
 const {data:coaching}=await svc.from("private_coaching").select("id").eq("customer_id",customerId).maybeSingle();
 if(!coaching)throw Error("No coaching record");
 const week=String(form.get("week_start")??"");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(week))throw Error("Invalid review week");
 const {error}=await svc.from("private_coaching_reviews").upsert({coaching_id:coaching.id,week_start:week,progress:String(form.get("progress")??"").slice(0,4000),notes:String(form.get("notes")??"").slice(0,4000)},{onConflict:"coaching_id,week_start"});
 if(error)throw Error(error.message);
 revalidatePath("/coaching");revalidatePath("/instructor/coaching/"+customerId);
}
export async function addProgressPhoto(form:FormData){
 const customerId=String(form.get("customer_id")??"");
 if(!uid.test(customerId))throw Error("Invalid customer");
 const {svc}=await instructorCoachingAccess(customerId);
 const {data:coaching}=await svc.from("private_coaching").select("id").eq("customer_id",customerId).maybeSingle();
 if(!coaching)throw Error("No coaching record");
 const photo=form.get("photo");
 if(!(photo instanceof File)||!["image/jpeg","image/png","image/webp"].includes(photo.type)||photo.size>10*1024*1024||photo.size===0)throw Error("Choose a JPEG, PNG or WebP under 10 MB.");
 const extension=photo.type==="image/png"?"png":photo.type==="image/webp"?"webp":"jpg";
 const path=`${coaching.id}/${crypto.randomUUID()}.${extension}`;
 const {error:uploadError}=await svc.storage.from("coaching-progress").upload(path,photo,{contentType:photo.type,upsert:false});
 if(uploadError)throw Error(uploadError.message);
 const {error}=await svc.from("private_coaching_photos").insert({coaching_id:coaching.id,object_path:path,caption:String(form.get("caption")??"").slice(0,300)});
 if(error){await svc.storage.from("coaching-progress").remove([path]);throw Error(error.message);}
 revalidatePath("/coaching");revalidatePath("/instructor/coaching/"+customerId);
}
export async function assignPrivateCoach(form:FormData){
 await requireRole("admin","/admin/customers");
 const customerId=String(form.get("customer_id")??""),instructorId=String(form.get("instructor_id")??"");
 if(!uid.test(customerId)||!uid.test(instructorId))throw Error("Invalid selection.");
 const svc=createServiceClient();
 const {data:studio}=await svc.from("studios").select("id").eq("slug","an-thuong-pilates").single();
 const {data:instructor}=await svc.from("instructors").select("id").eq("id",instructorId).maybeSingle();
 const {data:customer}=await svc.from("customers").select("id").eq("id",customerId).maybeSingle();
 if(!studio||!instructor||!customer)throw Error("Studio, instructor or client not found.");
 const {error}=await svc.from("private_coaching").upsert({customer_id:customerId,studio_id:studio.id,instructor_id:instructorId},{onConflict:"customer_id,studio_id"});
 if(error)throw Error(error.message);
 revalidatePath("/instructor/coaching");revalidatePath("/coaching");revalidatePath("/admin/coaching");
}
