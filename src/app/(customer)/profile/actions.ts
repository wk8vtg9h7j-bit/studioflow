"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient,createServiceClient } from "@/lib/supabase/server";

export async function saveCustomerProfile(formData: FormData) {
 const profile=await requireRole("customer","/profile");
 const full_name=String(formData.get("full_name")??"").trim();
 const phone=String(formData.get("phone")??"").trim();
 if(full_name.length<2||full_name.length>100||phone.length>30) redirect("/profile?status=invalid");
 const supabase=await createClient();
 const {error}=await supabase.from("profiles").update({full_name,phone:phone||null}).eq("id",profile.id);
 if(error) redirect("/profile?status=error");
 revalidatePath("/profile");revalidatePath("/home");redirect("/profile?status=saved");
}
export async function savePreferredStudio(formData:FormData){
 const profile=await requireRole("customer","/profile");
 const slug=String(formData.get("studio_slug")??"");
 if(!["downtown-pilates","hideaway-pilates","an-thuong-pilates"].includes(slug))redirect("/profile?status=invalid");
 const svc=createServiceClient();
 const {data:studio}=await svc.from("studios").select("id").eq("slug",slug).eq("active",true).maybeSingle();
 if(!studio)redirect("/profile?status=error");
 const {error}=await svc.from("customers").update({preferred_studio_id:studio.id}).eq("profile_id",profile.id);
 if(error)redirect("/profile?status=error");
 revalidatePath("/profile");revalidatePath("/home");redirect("/profile?status=studio");
}
