import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const LOOKBACK_DAYS = 45;
const BATCH_SIZE = 200;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  const { data: sessionData, error: sessionError } = await service
    .from("sessions")
    .select("id")
    .neq("status", "cancelled")
    .not("instructor_id", "is", null)
    .gte("ends_at", since.toISOString())
    .lte("ends_at", now.toISOString())
    .order("ends_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  const sessionIds = (sessionData ?? []).map((row) => row.id);
  if (sessionIds.length === 0) {
    return NextResponse.json({ scanned: 0, created: 0, failed: 0 });
  }

  const { data: payrollData, error: payrollError } = await service
    .from("session_payroll")
    .select("session_id")
    .in("session_id", sessionIds);

  if (payrollError) {
    return NextResponse.json({ error: payrollError.message }, { status: 500 });
  }

  const existing = new Set((payrollData ?? []).map((row) => row.session_id));
  const missing = sessionIds.filter((id) => !existing.has(id));

  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const sessionId of missing) {
    const { error } = await service.rpc("recalc_payroll", {
      p_session_id: sessionId,
      p_attendance: null,
    });

    if (error) {
      failed += 1;
      errors.push(`${sessionId}: ${error.message}`);
    } else {
      created += 1;
    }
  }

  return NextResponse.json({
    scanned: sessionIds.length,
    missing: missing.length,
    created,
    failed,
    errors: errors.slice(0, 10),
  });
}
