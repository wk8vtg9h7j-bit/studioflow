import { requireRole } from "@/lib/auth";
import { TodayDesk } from "@/components/TodayDesk";
export const dynamic="force-dynamic";
export default async function AdminTodayPage({searchParams}:{searchParams?:Promise<{date?:string}>}){
 const p=await requireRole("admin","/admin/today");
 const params=await searchParams;
 return <TodayDesk role="admin" profileId={p.id} date={params?.date}/>;
}
