import CoachingDetail from "@/app/instructor/coaching/[customerId]/page";
import {requireRole} from "@/lib/auth";
import Link from "next/link";
export default async function AdminCoachingDetail({params}:{params:{customerId:string}}){
 await requireRole("admin","/admin/coaching");
 return <div className="space-y-5"><Link href="/admin/coaching" className="text-sm text-emerald-800 underline">← An Thuong coaching</Link><CoachingDetail params={params}/></div>;
}
