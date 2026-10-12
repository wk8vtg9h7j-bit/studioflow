import { requireRole } from "@/lib/auth";
import { TodayDesk } from "@/components/TodayDesk";
export const dynamic="force-dynamic";
export default async function AdminTodayPage(){
 const p=await requireRole("admin","/admin/today");
 return <TodayDesk role="admin" profileId={p.id}/>;
}
