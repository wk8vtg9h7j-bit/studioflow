import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export async function customerCoaching() {
 const profile=await requireRole("customer","/coaching");
 const svc=createServiceClient();
 const {data:customer}=await svc.from("customers").select("id,preferred_studio_id").eq("profile_id",profile.id).maybeSingle();
 if(!customer)return null;
 const {data:studio}=await svc.from("studios").select("id,name").eq("slug","an-thuong-pilates").maybeSingle();
 if(!studio)return null;
 const {data:coaching}=await svc.from("private_coaching").select("*").eq("customer_id",customer.id).eq("studio_id",studio.id).maybeSingle();
 const {data:reviews}=coaching?await svc.from("private_coaching_reviews").select("*").eq("coaching_id",coaching.id).order("week_start",{ascending:false}).limit(20):{data:[]};
 const {data:photos}=coaching?await svc.from("private_coaching_photos").select("*").eq("coaching_id",coaching.id).order("taken_at",{ascending:false}):{data:[]};
 const photoItems=await Promise.all((photos??[]).map(async (p:any)=>({id:p.id,caption:p.caption,url:(await svc.storage.from("coaching-progress").createSignedUrl(p.object_path,900)).data?.signedUrl??null})));
 return {studio,customer,coaching,reviews:reviews??[],photos:photoItems};
}

export async function instructorCoachingAccess(customerId:string) {
 const profile=await requireRole(["instructor","admin"],"/instructor/coaching");
 const svc=createServiceClient();
 if(profile.role==="instructor"){
  const {data:instructor}=await svc.from("instructors").select("id").eq("profile_id",profile.id).maybeSingle();
  if(!instructor)throw new Error("Instructor account not found.");
  const {data:assigned}=await svc.from("private_coaching").select("id").eq("customer_id",customerId).eq("instructor_id",instructor.id).maybeSingle();
  if(!assigned)throw new Error("You can only edit your assigned coaching clients.");
 }
 return {profile,svc};
}
