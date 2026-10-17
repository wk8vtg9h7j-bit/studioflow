import Link from "next/link";import {requireRole} from "@/lib/auth";import {createServiceClient} from "@/lib/supabase/server";
export default async function InstructorCoaching(){
 const profile=await requireRole("instructor","/instructor/coaching");
 const svc=createServiceClient();
 const {data:instructor}=await svc.from("instructors").select("id").eq("profile_id",profile.id).maybeSingle();
 const {data:clients}=instructor?await svc.from("private_coaching").select("customer_id,goals,customer:customers(name,profile:profiles(full_name,email))").eq("instructor_id",instructor.id):{data:[]};
 return <div className="space-y-6"><div><p className="text-xs font-semibold uppercase tracking-widest text-stone-500">AN THUONG · PRIVATE</p><h1 className="text-3xl font-semibold">Client progress</h1><p className="mt-2 text-sm text-stone-500">Manage personalized plans, weekly follow-ups and private progress photos.</p></div>
 <div className="grid gap-3 md:grid-cols-2">{clients?.length?clients.map((c:any)=><Link key={c.customer_id} href={`/instructor/coaching/${c.customer_id}`} className="card p-5 hover:border-emerald-300"><p className="font-semibold">{c.customer?.profile?.full_name||c.customer?.name||"Private client"}</p><p className="mt-2 line-clamp-2 text-sm text-stone-500">{c.goals||"Add client's personal goals"}</p><p className="mt-4 text-sm text-emerald-800">Open coaching profile →</p></Link>):<div className="card p-6 text-sm text-stone-500">No assigned private clients yet. An admin can assign them under Admin → Private coaching.</div>}</div></div>;
}
