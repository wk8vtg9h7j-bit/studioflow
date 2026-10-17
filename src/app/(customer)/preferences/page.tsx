import Link from "next/link";import {requireRole} from "@/lib/auth";import {createServiceClient} from "@/lib/supabase/server";import {savePreferredStudio} from "../profile/actions";
export default async function StudioPreference(){
 const profile=await requireRole("customer","/preferences");
 const svc=createServiceClient();
 const [{data:studios},{data:customer}]=await Promise.all([
  svc.from("studios").select("id,name,slug,private_only").eq("active",true).order("name"),
  svc.from("customers").select("preferred_studio_id").eq("profile_id",profile.id).maybeSingle()
 ]);
 return <div className="mx-auto max-w-2xl space-y-6"><Link href="/profile" className="text-sm underline">← My profile</Link><div><p className="customer-eyebrow">MEMBERSHIP</p><h1 className="mt-2">My studio</h1><p className="mt-2 text-sm text-stone-500">Choose your preferred studio. An Thuong is reserved for private Pilates.</p></div>
 <form action={savePreferredStudio} className="customer-tile space-y-4"><label htmlFor="member-studio" className="label">Preferred location</label><select id="member-studio" name="studio_slug" required className="input w-full" defaultValue={studios?.find(s=>s.id===customer?.preferred_studio_id)?.slug??""}><option value="" disabled>Choose a studio</option>{(studios??[]).map(s=><option key={s.id} value={s.slug}>{s.name}{s.private_only?" · Private only":""}</option>)}</select><button className="btn-primary px-6 py-3">Save studio</button></form></div>;
}