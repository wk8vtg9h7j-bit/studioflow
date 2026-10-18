import Link from "next/link";
import {createServiceClient} from "@/lib/supabase/server";
import {getLocale} from "@/lib/locale-server";
export default async function CustomerStudios(){
 const vi=(await getLocale())==="vi";
 const svc=createServiceClient();
 const [{data:studios},{data:photos}]=await Promise.all([
  svc.from("studios").select("id,name,address,cover_image_url,private_only").eq("active",true).eq("private_only",false).order("name"),
  svc.from("studio_photos").select("id,studio_id,caption,object_path").order("created_at",{ascending:false}).limit(200)
 ]);
 return <div className="space-y-8">
  <div><p className="customer-eyebrow">{vi?"KHÁM PHÁ STUDIO":"OUR SPACES"}</p><h1 className="mt-2">{vi?"Các studio":"Explore our studios"}</h1><p className="mt-2 text-sm text-stone-600">{vi?"Không gian để bạn tập luyện và thư giãn.":"Thoughtful spaces to move, grow and recharge."}</p></div>
  {(studios??[]).map(st=><section key={st.id} className="overflow-hidden rounded-3xl border border-[#e6ded1] bg-[#fffefa]">
    {st.cover_image_url?<img src={st.cover_image_url} alt={st.name} className="h-48 w-full object-cover sm:h-72"/>:<div className="h-40 bg-[#e6ded1]"/>}
    <div className="space-y-4 p-5 sm:p-7">
     <div><p className="customer-eyebrow">{st.private_only?"PRIVATE PILATES":"PILATES STUDIO"}</p><h2 className="mt-1 font-serif text-2xl">{st.name}</h2>{st.address&&<p className="mt-1 text-sm text-stone-500">{st.address}</p>}</div>
     <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(photos??[]).filter(p=>p.studio_id===st.id).map(p=><div key={p.id}><img src={svc.storage.from("studio-gallery").getPublicUrl(p.object_path).data.publicUrl} alt={p.caption||st.name} className="aspect-square w-full rounded-xl object-cover"/>{p.caption&&<p className="mt-1 text-xs text-stone-500">{p.caption}</p>}</div>)}</div>
     <Link href={st.private_only?"/private":"/book"} className="inline-flex rounded-xl bg-[#354a40] px-5 py-3 text-sm font-semibold text-white">{st.private_only?(vi?"Đặt lớp riêng":"Explore private sessions"):(vi?"Xem lịch học":"View classes")} →</Link>
    </div>
   </section>)}
 </div>;
}
