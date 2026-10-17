import {PhotoPicker} from "@/components/PhotoPicker";
import Link from "next/link";
import {requireRole} from "@/lib/auth";
import {createServiceClient} from "@/lib/supabase/server";
import {uploadStudioGalleryPhoto,deleteStudioGalleryPhoto} from "../actions";
export default async function StudioGalleryPage(){
 await requireRole("admin","/admin/studio-images/gallery");
 const svc=createServiceClient();
 const [{data:studios},{data:photos}]=await Promise.all([
  svc.from("studios").select("id,name").order("name"),
  svc.from("studio_photos").select("*").order("created_at",{ascending:false}).limit(200)
 ]);
 return <div className="space-y-6">
  <Link href="/admin/studio-images" className="text-sm underline">← Studio cover photos</Link>
  <div><h1 className="text-2xl font-semibold">Studio galleries</h1><p className="mt-1 text-sm text-stone-500">Upload and remove photos for each studio individually.</p></div>
  {(studios??[]).map(st=><section key={st.id} className="card p-5">
   <h2 className="text-lg font-semibold">{st.name}</h2>
   <form action={uploadStudioGalleryPhoto} className="mt-3 flex flex-wrap items-end gap-3">
    <input type="hidden" name="studio_id" value={st.id}/>
    <div><label className="label">New photo</label><PhotoPicker/></div>
    <div><label className="label">Caption</label><input className="input" name="caption" maxLength={300}/></div>
    <button className="btn-primary">Add photo</button>
   </form>
   <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
    {photos?.filter(p=>p.studio_id===st.id).map(p=><div key={p.id} className="overflow-hidden rounded-xl border border-stone-200">
     <img src={svc.storage.from("studio-gallery").getPublicUrl(p.object_path).data.publicUrl} alt={p.caption||st.name} className="aspect-square w-full object-cover"/>
     <div className="p-2"><p className="truncate text-xs">{p.caption||"Studio photo"}</p>
      <form action={deleteStudioGalleryPhoto}><input type="hidden" name="photo_id" value={p.id}/><button className="mt-1 text-xs text-red-600">Delete</button></form>
     </div>
    </div>)}
   </div>
  </section>)}
 </div>;
}
