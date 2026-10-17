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
export async function uploadStudioGalleryPhoto(form:FormData){
 await requireRole("admin","/admin/studio-images");
 const id=String(form.get("studio_id")??"");
 if(!/^[a-f0-9-]{36}$/i.test(id))throw Error("Invalid studio");
 const image=form.get("image");
 if(!(image instanceof File)||!["image/jpeg","image/png","image/webp"].includes(image.type)||!image.size||image.size>10485760)throw Error("Choose a JPEG, PNG or WebP under 10 MB.");
 const svc=createServiceClient();
 const {data:studio}=await svc.from("studios").select("id").eq("id",id).single();
 if(!studio)throw Error("Unknown studio");
 const ext=image.type==="image/png"?"png":image.type==="image/webp"?"webp":"jpg";
 const path=`${id}/gallery/${crypto.randomUUID()}.${ext}`;
 const {error:up}=await svc.storage.from("studio-gallery").upload(path,image,{contentType:image.type});
 if(up)throw Error(up.message);
 const {error}=await svc.from("studio_photos").insert({studio_id:id,object_path:path,caption:String(form.get("caption")??"").slice(0,300)});
 if(error){await svc.storage.from("studio-gallery").remove([path]);throw Error(error.message);}
 revalidatePath("/admin/studio-images");revalidatePath("/home");
}
export async function deleteStudioGalleryPhoto(form:FormData){
 await requireRole("admin","/admin/studio-images");
 const id=String(form.get("photo_id")??"");
 if(!/^[a-f0-9-]{36}$/i.test(id))throw Error("Invalid photo");
 const svc=createServiceClient();
 const {data:photo}=await svc.from("studio_photos").select("id,object_path").eq("id",id).maybeSingle();
 if(!photo)throw Error("Photo not found");
 const {error}=await svc.from("studio_photos").delete().eq("id",id);
 if(error)throw Error(error.message);
 await svc.storage.from("studio-gallery").remove([photo.object_path]);
 revalidatePath("/admin/studio-images");revalidatePath("/home");
}
