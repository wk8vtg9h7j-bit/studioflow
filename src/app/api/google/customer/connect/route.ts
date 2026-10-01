import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { buildCustomerConsentUrl } from "@/lib/google/oauth";

export async function GET(request: Request) {
  const profile = await requireRole("customer", "/my-bookings");
  const url = new URL(request.url);
  const service = createServiceClient();

  const { data: customer, error } = await service
    .from("customers")
    .select("id")
    .eq("profile_id", profile.id)
    .single();

  if (error || !customer) {
    return NextResponse.redirect(
      new URL("/my-bookings?error=Customer+profile+not+found", url.origin),
    );
  }

  return NextResponse.redirect(buildCustomerConsentUrl(customer.id));
}
