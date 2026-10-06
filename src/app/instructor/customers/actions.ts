"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { queueCustomerBookingCalendarSync } from "@/lib/bookingPaymentStatus.server";

export type InstructorPackageState = {
  ok?: boolean;
  error?: string;
  regularBalance?: number;
  privateBalance?: number;
  commissionAmount?: number;
  commissionCurrency?: string;
};

const PAYMENT_METHODS = ["qr", "card", "cash"] as const;

const IssuePackageSchema = z.object({
  customer_id: z.string().uuid("Customer not found."),
  package_id: z.string().uuid("Choose a package."),
  payment_method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Choose QR, card, or cash." }),
  }),
  sale_price_cents: z.coerce
    .number()
    .int("Sale price must be a whole number.")
    .min(1, "Instructor package sales must have a positive price.")
    .max(100_000_000, "Sale price is too large."),
});

export async function issuePackageAction(
  _prev: InstructorPackageState,
  formData: FormData,
): Promise<InstructorPackageState> {
  const profile = await requireRole("instructor", "/instructor/customers");

  const parsed = IssuePackageSchema.safeParse({
    customer_id: formData.get("customer_id"),
    package_id: formData.get("package_id"),
    payment_method: formData.get("payment_method"),
    sale_price_cents: formData.get("sale_price_cents"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { customer_id, package_id, payment_method, sale_price_cents } =
    parsed.data;

  const service = createServiceClient();

  const [{ data: customer }, { data: pkg, error: packageError }] =
    await Promise.all([
      service.from("customers").select("id").eq("id", customer_id).maybeSingle(),
      service
        .from("packages")
        .select(
          "id,name,credits,price_cents,currency,validity_days,pool,active",
        )
        .eq("id", package_id)
        .maybeSingle(),
    ]);

  if (!customer) {
    return { error: "Customer not found." };
  }

  if (packageError || !pkg || !pkg.active) {
    return { error: "That package is not available." };
  }

  // Instructors can sell normal paid packages, but free/marketing packages stay
  // admin-only.
  if (pkg.price_cents <= 0) {
    return { error: "Free or promotional packages are admin-only." };
  }

  if (sale_price_cents > pkg.price_cents) {
    return {
      error: "Sale price cannot be higher than the package list price.",
    };
  }

  const expiresAt = new Date(
    Date.now() + pkg.validity_days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await service.from("credit_ledger").insert({
    customer_id,
    delta: pkg.credits,
    reason: "purchase",
    package_id,
    booking_id: null,
    expires_at: expiresAt,
    payment_method,
    pool: pkg.pool ?? "regular",
    sale_amount_cents: sale_price_cents,
    sale_currency: pkg.currency ?? "VND",
    sold_by: profile.id,
    commission_rate_bps: 250,
    commission_amount_cents: Math.round(sale_price_cents * 0.025),
  });

  if (error) {
    return { error: error.message };
  }

  const [regularRes, privateRes] = await Promise.all([
    service.rpc("credit_balance", {
      p_customer: customer_id,
      p_pool: "regular",
    }),
    service.rpc("credit_balance", {
      p_customer: customer_id,
      p_pool: "private",
    }),
  ]);

  await queueCustomerBookingCalendarSync(customer_id);

  revalidatePath("/instructor/customers");
  revalidatePath("/instructor/salary");
  revalidatePath("/admin/customers");
  revalidatePath("/admin/payments");
  revalidatePath("/admin/payroll");

  return {
    ok: true,
    regularBalance:
      typeof regularRes.data === "number" ? regularRes.data : undefined,
    privateBalance:
      typeof privateRes.data === "number" ? privateRes.data : undefined,
    commissionAmount: Math.round(sale_price_cents * 0.025),
    commissionCurrency: pkg.currency ?? "VND",
  };
}
