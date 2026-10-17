"use server";
import {requireRole} from "@/lib/auth";
import {createServiceClient} from "@/lib/supabase/server";
import {revalidatePath} from "next/cache";
export async function uploadStudioCover(form:FormData){
 await requireRole("admin","/admin/studio-images");
 const id=String(form.get("studio_id")??"");
 if(!/^[a-f0-9-]{36}$/i.test(id))throw Error("Invalid studio");
 const image=form.get("image");
 if(!(image instanceof File)||!["image/jpeg","image/png","image/webp"].includes(image.type)||image.size>10485760||!image.size)throw Error("Choose a valid photo under 10MB.");
 const svc=createServiceClient();
 const {data:studio}=await svc.from("studios").select("id").eq("id",id).single();
 if(!studio)throw Error("Unknown studio");
 const ext=image.type==="image/png"?"png":image.type==="image/webp"?"webp":"jpg";
 const path=`${id}/${crypto.randomUUID()}.${ext}`;
 const {error:uploadError}=await svc.storage.from("studio-gallery").upload(path,image,{contentType:image.type});
 if(uploadError)throw Error(uploadError.message);
 const url=svc.storage.from("studio-gallery").getPublicUrl(path).data.publicUrl;
 const {error}=await svc.from("studios").update({cover_image_url:url}).eq("id",id);
 if(error){await svc.storage.from("studio-gallery").remove([path]);throw Error(error.message);}
 revalidatePath("/admin/studio-images");revalidatePath("/home");
}