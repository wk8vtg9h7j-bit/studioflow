import { requireRole } from "@/lib/auth";
import { TodayDesk } from "@/components/TodayDesk";
export const dynamic="force-dynamic";
export default async function InstructorTodayPage(){
 const p=await requireRole("instructor","/instructor/today");
 return <TodayDesk role="instructor" profileId={p.id}/>;
}
