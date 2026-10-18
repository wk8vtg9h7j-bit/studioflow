import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";

export default async function CustomerHome() {
 const profile=await requireRole("customer","/home");
 const vi=(await getLocale())==="vi";
 const supabase=await createClient();
 const now=new Date().toISOString();
 const [{data:upcoming},{count:attended},{data:customerId}] = await Promise.all([
  supabase.from("bookings").select("id,session:sessions(starts_at,title,studio:studios(name),class_type:class_types(name))").in("status",["booked","waitlisted"]).gte("sessions.starts_at",now).limit(15),
  supabase.from("bookings").select("id",{count:"exact",head:true}).eq("status","attended"),
  supabase.rpc("my_customer_id")
 ]);
 const next=(upcoming??[]).map((x:any)=>x.session).filter((x:any)=>x&&new Date(x.starts_at).getTime()>Date.now()).sort((a:any,b:any)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0] as any;
 let regular=0,privateCredits=0;
 if(customerId){
  const [r,p]=await Promise.all([supabase.rpc("credit_balance",{p_customer:customerId,p_pool:"regular"}),supabase.rpc("credit_balance",{p_customer:customerId,p_pool:"private"})]);
  regular=typeof r.data==="number"?r.data:0;privateCredits=typeof p.data==="number"?p.data:0;
 }
 const firstName=(profile.full_name||"").trim().split(" ")[0]|| (vi?"bạn":"there");
 return <div className="space-y-7">
  <div><p className="customer-eyebrow">{vi?"HÀNH TRÌNH PILATES CỦA BẠN":"YOUR PILATES JOURNEY"}</p><h1 className="mt-2">{vi?"Xin chào":"Welcome back"}, {firstName}</h1><p className="mt-2 text-sm text-stone-600">{vi?"Một không gian dành riêng cho bạn.":"A little space to move, recharge and feel your best."}</p></div>
  <section className="customer-hero"><p className="text-xs uppercase tracking-widest text-[#d8e3da]">{vi?"BUỔI TẬP TIẾP THEO":"YOUR NEXT SESSION"}</p>
  <h2 className="mt-3 font-serif text-3xl">{next?(next.title||next.class_type?.name||"Pilates"):(vi?"Sẵn sàng cho buổi tập tiếp theo?":"Ready for your next class?")}</h2>
  <p className="mt-3 mb-6 text-sm text-[#e8eee9]">{next?new Intl.DateTimeFormat(vi?"vi-VN":"en-GB",{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Ho_Chi_Minh"}).format(new Date(next.starts_at))+" · "+(next.studio?.name||""):(vi?"Hãy chọn thời gian phù hợp với bạn.":"Discover your next moment of movement.")}</p>
  <Link href={next?"/my-bookings":"/book"}>{next?(vi?"Xem lịch đã đặt":"View booking"):(vi?"Đặt lớp ngay":"Explore classes")} →</Link></section>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
   <div className="customer-tile"><p className="text-xs text-stone-500">{vi?"Tín dụng nhóm":"Group credits"}</p><p className="mt-3 text-3xl font-semibold text-[#354a40]">{regular}</p></div>
   <div className="customer-tile"><p className="text-xs text-stone-500">{vi?"Tín dụng riêng":"Private credits"}</p><p className="mt-3 text-3xl font-semibold text-[#354a40]">{privateCredits}</p></div>
   <div className="customer-tile col-span-2 sm:col-span-1"><p className="text-xs text-stone-500">{vi?"Lớp đã tham gia":"Classes attended"}</p><p className="mt-3 text-3xl font-semibold text-[#354a40]">{attended??0}</p></div>
  </div>
  <div className="grid gap-3 sm:grid-cols-2"><Link href="/book" className="customer-tile hover:border-[#9daa98]"><p className="customer-eyebrow">01 / BOOK</p><h2 className="mt-2 font-serif text-2xl">{vi?"Khám phá lớp học":"Find your next class"} →</h2><p className="mt-2 text-sm text-stone-500">{vi?"Khám phá lịch học phù hợp.":"Explore classes across our studios."}</p></Link><Link href="/private/enquiry" className="customer-tile hover:border-[#9daa98]"><p className="customer-eyebrow">02 / PRIVATE PILATES</p><h2 className="mt-2 font-serif text-2xl">{vi?"Yêu cầu lớp riêng":"Request a private class"} →</h2><p className="mt-2 text-sm text-stone-500">{vi?"Chọn studio, ngày và giờ phù hợp để chúng tôi liên hệ xác nhận.":"Choose your studio, preferred date and time. Our team will confirm availability."}</p></Link><Link href="/my-bookings" className="customer-tile hover:border-[#9daa98]"><p className="customer-eyebrow">03 / ACTIVITY</p><h2 className="mt-2 font-serif text-2xl">{vi?"Lịch sử tập luyện":"Your class history"} →</h2><p className="mt-2 text-sm text-stone-500">{vi?"Xem các buổi đã đặt và đã tham gia.":"Everything you've booked, all in one place."}</p></Link></div>
  <div className="grid gap-4 sm:grid-cols-3">{(await supabase.from("studios").select("id,name,cover_image_url").eq("active",true).eq("private_only",false).order("name")).data?.map((st:any)=><div key={st.id} className="overflow-hidden rounded-2xl border border-[#e6ded1] bg-white">{st.cover_image_url?<img src={st.cover_image_url} alt={st.name} className="aspect-[4/3] w-full object-cover"/>:<div className="aspect-[4/3] bg-[#e6ded1]"/>}<div className="p-4"><h3 className="font-serif text-lg">{st.name}</h3></div></div>)}</div>
  <div className="flex flex-wrap gap-5 text-sm"><Link className="underline underline-offset-4" href="/my-packages">{vi?"Gói tập & tín dụng":"Packages & credit history"}</Link><Link className="underline underline-offset-4" href="/profile">{vi?"Hồ sơ":"My profile"}</Link><Link className="underline underline-offset-4" href="/coaching">My private progress</Link><Link className="underline underline-offset-4" href="/private">{vi?"Đặt lịch riêng":"Private sessions"}</Link></div>
 </div>;
}