import { requireRole } from "@/lib/auth";
import { TodayDesk } from "@/components/TodayDesk";
export const dynamic="force-dynamic";
export default async function InstructorTodayPage({searchParams}:{searchParams?:Promise<{date?:string}>}){
 const p=await requireRole("instructor","/instructor/today");
 const params=await searchParams;
 return <TodayDesk role="instructor" profileId={p.id} date={params?.date}/>;
}
