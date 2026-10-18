import "server-only";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createServiceClient } from "@/lib/supabase/server";

export const PRIVATE_TZ = "Asia/Ho_Chi_Minh";
export const PRIVATE_HOURS = Array.from({ length: 14 }, (_, i) => i + 7);

export type PrivateTeacher = { id: string; display_name: string };
export type PrivateStudio = { id: string; name: string; slug: string };
export type PrivateSlot = {
  id: string; instructor_id: string; studio_id: string;
  starts_at: string; ends_at: string;
  status: "open" | "booked" | "closed";
  reserved_for_customer_id: string | null;
  booked_session_id: string | null;
  mine: boolean;
};
export type PrivateRequest = {
  id: string; customer_id: string; instructor_id: string; studio_id: string;
  starts_at: string; ends_at: string;
  note: string | null; status: string; slot_id: string | null;
  customer_name: string;
};
export type BusySession = {
  starts_at: string; ends_at: string;
};
export type PrivateCalendarData = {
  day: string; studioId: string; instructorId: string;
  studios: PrivateStudio[]; teachers: PrivateTeacher[];
  slots: PrivateSlot[]; requests: PrivateRequest[];
  busy: BusySession[]; creditBalance: number; creditCost: number;
};

function dayIsValid(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = new Date(value + "T12:00:00Z");
  return !Number.isNaN(stamp.getTime()) && stamp.toISOString().slice(0,10) === value;
}

export async function loadPrivateCalendar(
  role: "customer" | "instructor",
  profileId: string,
  params: { day?: string; studio?: string; instructor?: string },
): Promise<PrivateCalendarData> {
  const svc = createServiceClient();
  const today = formatInTimeZone(new Date(), PRIVATE_TZ, "yyyy-MM-dd");
  const limit = formatInTimeZone(new Date(Date.now() + 28 * 86400000), PRIVATE_TZ, "yyyy-MM-dd");
  const day = dayIsValid(params.day) && params.day >= today && params.day <= limit
    ? params.day : today;
  const from = fromZonedTime(day+"T00:00:00", PRIVATE_TZ).toISOString();
  const until = new Date(Date.parse(from) + 86400000).toISOString();

  const [studiosRes, teachersRes, ownInstructorRes, customerRes, costRes] = await Promise.all([
    svc.from("studios").select("id,name,slug").eq("active", true).order("name"),
    svc.from("instructors").select("id,display_name").eq("active", true).order("display_name"),
    role === "instructor"
      ? svc.from("instructors").select("id,display_name").eq("profile_id",profileId).maybeSingle()
      : Promise.resolve({data:null,error:null}),
    role === "customer"
      ? svc.from("customers").select("id").eq("profile_id",profileId).maybeSingle()
      : Promise.resolve({data:null,error:null}),
    svc.from("class_types").select("credits_cost").eq("pool","private").eq("active",true)
      .order("created_at").limit(1).maybeSingle(),
  ]);

  const creditCost = Number(costRes.data?.credits_cost ?? 1);
  const studios = (studiosRes.data ?? []) as PrivateStudio[];
  const allTeachers = (teachersRes.data ?? []) as PrivateTeacher[];
  const ownInstructor = ownInstructorRes.data?.id ?? "";
  const customerId = customerRes.data?.id ?? "";
  const ownName = ownInstructorRes.data?.display_name ?? "";
  const allowedStudios = role === "instructor"
    ? studios.filter(s => ownName === "Ruby" || (ownName === "Violet" && s.slug === "an-thuong-pilates"))
    : studios;
  const selectedStudio = allowedStudios.find(s => s.id === params.studio) ?? allowedStudios[0];
  const studioId = selectedStudio?.id ?? "";
  const teachers = role === "customer"
    ? allTeachers.filter(t => t.display_name === "Ruby" || (selectedStudio?.slug === "an-thuong-pilates" && t.display_name === "Violet"))
    : allTeachers.filter(t => t.id === ownInstructor);
  const instructorId = role === "instructor" ? ownInstructor
    : teachers.find(t => t.id === params.instructor)?.id ?? teachers[0]?.id ?? "";

  if (!instructorId || !studioId) {
    return { day, studioId, instructorId, studios: allowedStudios, teachers, slots: [], requests: [], busy: [], creditBalance: 0, creditCost };
  }

  // Scope every source to the selected teacher and only a single day.
  const [slotsRes, sessionsRes, requestRes, balanceRes] = await Promise.all([
    svc.from("private_slots")
      .select("id,instructor_id,studio_id,starts_at,ends_at,status,reserved_for_customer_id,booked_session_id")
      .eq("instructor_id",instructorId)
      .gte("starts_at",from).lt("starts_at",until)
      .order("starts_at"),
    svc.from("sessions")
      .select("id,starts_at,ends_at,status,capacity,filler_seats,bookings(status)")
      .eq("instructor_id",instructorId)
      .eq("status","scheduled")
      .lt("starts_at",until).gt("ends_at",from),
    role==="instructor"
      ? svc.from("private_requests")
          .select("id,customer_id,instructor_id,studio_id,starts_at,ends_at,note,status,slot_id,customer:customers(name,email,profile:profiles(full_name,email))")
          .eq("instructor_id",instructorId)
          .in("status",["pending","approved"])
          .gte("starts_at",new Date().toISOString())
          .order("starts_at").limit(100)
      : svc.from("private_requests")
          .select("id,customer_id,instructor_id,studio_id,starts_at,ends_at,note,status,slot_id,customer:customers(name,email,profile:profiles(full_name,email))")
          .eq("customer_id",customerId || "00000000-0000-0000-0000-000000000000")
          .eq("instructor_id",instructorId)
          .gte("starts_at",from)
          .order("starts_at").limit(100),
    role==="customer" && customerId
      ? svc.rpc("credit_balance",{p_customer:customerId,p_pool:"private"})
      : Promise.resolve({data:0,error:null}),
  ]);

  if (slotsRes.error) throw slotsRes.error;
  if (sessionsRes.error) throw sessionsRes.error;
  if (requestRes.error) throw requestRes.error;

  const slotRows = (slotsRes.data ?? []) as Omit<PrivateSlot,"mine">[];
  const bookedIds = slotRows.flatMap(s=>s.booked_session_id ? [s.booked_session_id] : []);
  const ownBookingRes = role==="customer" && bookedIds.length && customerId
    ? await svc.from("bookings").select("session_id").eq("customer_id",customerId)
        .in("session_id",bookedIds).in("status",["booked","attended"])
    : { data: [] as {session_id:string}[] };
  const mine = new Set((ownBookingRes.data ?? []).map(b=>b.session_id));

  const slots: PrivateSlot[] = slotRows.map(s=>({
    ...s,
    // An approved time reserved for another customer must read as unavailable,
    // never as a public open slot or a requestable time.
    status: role==="customer" && s.reserved_for_customer_id &&
      s.reserved_for_customer_id!==customerId && s.status==="open"
      ? "booked" as const : s.status,
    reserved_for_customer_id: role==="instructor" || s.reserved_for_customer_id===customerId
      ? s.reserved_for_customer_id : null,
    mine: !!s.booked_session_id && mine.has(s.booked_session_id),
  }));
  const rawRequests = (requestRes.data ?? []) as unknown as {
    id:string;customer_id:string;instructor_id:string;studio_id:string;
    starts_at:string;ends_at:string;note:string|null;status:string;slot_id:string|null;
    customer:{name:string|null;email:string|null;profile:{full_name:string|null;email:string|null}|null}|null;
  }[];
  const requests = rawRequests.map(r=>({
    id:r.id,customer_id:r.customer_id,instructor_id:r.instructor_id,
    studio_id:r.studio_id,starts_at:r.starts_at,ends_at:r.ends_at,
    note:r.note,status:r.status,slot_id:r.slot_id,
    customer_name:r.customer?.profile?.full_name || r.customer?.name ||
      r.customer?.profile?.email || r.customer?.email || "Customer",
  }));
  const busy = ((sessionsRes.data ?? []) as {
    starts_at:string;ends_at:string;capacity:number;filler_seats:number|null;
    bookings:{status:string}[]|null;
  }[]).filter(s=>!( (s.filler_seats??0)>=s.capacity &&
    !(s.bookings ?? []).some(b=>["booked","attended"].includes(b.status))
  )).map(s=>({starts_at:s.starts_at,ends_at:s.ends_at}));

  return {
    day,studioId,instructorId,studios:allowedStudios,teachers,slots,requests,busy,
    creditBalance:typeof balanceRes.data === "number" ? balanceRes.data : 0,
    creditCost,
  };
}
