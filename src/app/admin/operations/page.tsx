import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createServiceClient } from "@/lib/supabase/server";
import { OperationsDashboard, type OperationClass, type BlockHistory } from "./OperationsDashboard";

export const dynamic = "force-dynamic";
const TZ = "Asia/Ho_Chi_Minh";

export default async function OperationsPage() {
  const service = createServiceClient();
  const now = new Date();
  const dayKey = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const dayStart = fromZonedTime(dayKey + "T00:00:00", TZ);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const [sessionsRes, studiosRes, blocksRes] = await Promise.all([
    service.from("sessions")
      .select("id,studio_id,title,starts_at,capacity,filler_seats,status,studio:studios(name,slug,private_only),instructor:instructors(display_name),class_type:class_types(name)")
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString())
      .order("starts_at", { ascending: true }),
    service.from("studios").select("id,name").eq("active",true).order("name"),
    service.from("automatic_class_blocks")
      .select("session_id,blocked_at,original_starts_at")
      .gte("original_starts_at", dayStart.toISOString())
      .lt("original_starts_at", dayEnd.toISOString())
      .order("blocked_at", { ascending: false }),
  ]);

  const sessionRows = (sessionsRes.data ?? []) as unknown as Array<{
    id:string; studio_id:string; title:string|null; starts_at:string;
    capacity:number; filler_seats:number|null; status:string;
    studio:{name:string;slug:string;private_only:boolean}|null;
    instructor:{display_name:string}|null;
    class_type:{name:string}|null;
  }>;
  const ids = sessionRows.map(row => row.id);
  const bookingsRes = ids.length
    ? await service.from("bookings")
       .select("session_id,status,spots_count")
       .in("session_id",ids)
    : { data: [], error: null };
  const counts = new Map<string,{booked:number;reserved:number}>();
  for (const b of bookingsRes.data ?? []) {
    const entry = counts.get(b.session_id) ?? {booked:0,reserved:0};
    if (b.status === "booked" || b.status === "attended")
      entry.booked += Math.max(1,Number(b.spots_count ?? 1));
    if (b.status !== "cancelled")
      entry.reserved += Math.max(1,Number(b.spots_count ?? 1));
    counts.set(b.session_id,entry);
  }

  const blockedIds = new Set((blocksRes.data ?? []).map(b => b.session_id));
  const rows:OperationClass[] = sessionRows.map(s => ({
    id:s.id, studioId:s.studio_id,
    studio:s.studio?.name ?? "Studio",
    className:s.title || s.class_type?.name || "Pilates class",
    instructor:s.instructor?.display_name ?? "Unassigned",
    startsAt:s.starts_at, capacity:s.capacity,
    fillerSeats:s.filler_seats ?? 0,
    booked:counts.get(s.id)?.booked ?? 0,
    activeReservations:counts.get(s.id)?.reserved ?? 0,
    status:s.status,
    privateOnly:Boolean(s.studio?.private_only),
    autoBlocked:blockedIds.has(s.id),
  }));

  const blocks:BlockHistory[] = (blocksRes.data ?? []).map(row => ({
    sessionId:row.session_id, blockedAt:row.blocked_at,
    startsAt:row.original_starts_at,
  }));
  const errors = [sessionsRes.error, studiosRes.error, bookingsRes.error, blocksRes.error]
    .filter(Boolean).map(e=>e!.message);
  return <OperationsDashboard
    initialClasses={rows}
    studios={(studiosRes.data ?? []).map(s=>({id:s.id,name:s.name}))}
    blocks={blocks} dayKey={dayKey} nowIso={now.toISOString()}
    errors={errors}
  />;
}
