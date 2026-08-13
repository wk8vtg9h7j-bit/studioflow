// ============================================================================
// Customer (CRM) server actions.
//
// Unlike instructors, customer accounts are created through the public
// sign-up flow — so there is no "create" action here. Admins curate the CRM
// record that hangs off each profile: lifecycle status, segmentation tags,
// internal notes, and the few personal details the studio keeps on file.
//
// Every action re-checks the admin role server-side, so these can never be
// invoked by a customer poking at the network tab.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type CustomerActionState = { error?: string; ok?: boolean };
export type AddCustomerState = { error?: string; ok?: boolean; message?: string };

const STATUSES = ["lead", "active", "inactive"] as const;

// Tags arrive as a single comma-separated string from the form; we normalise
// to a clean, de-duplicated, lower-cased array before it hits the column.
function parseTags(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag) seen.add(tag);
  }
  return Array.from(seen);
}

const CustomerEditSchema = z.object({
  id: z.string().uuid("Could not identify which customer to update."),
  status: z.enum(STATUSES, {
    errorMap: () => ({ message: "Choose a valid status." }),
  }),
  source: z
    .string()
    .trim()
    .max(120, "Source is too long.")
    .optional()
    .transform((v) => (v ? v : null)),
  emergency_contact: z
    .string()
    .trim()
    .max(200, "Emergency contact is too long.")
    .optional()
    .transform((v) => (v ? v : null)),
  date_of_birth: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(2000, "Notes are too long.")
    .optional()
    .transform((v) => (v ? v : null)),
  marketing_opt_in: z.boolean(),
});

// ----------------------------------------------------------------------------
// Grant a package (clip-card) to a customer.
//
// Selling a package writes a single positive row to credit_ledger: delta =
// packages.credits, reason 'purchase', tagged with the package_id, expiring
// validity_days from now. credit_balance() sums non-expired deltas, and
// book_session later deducts a clip per booking. Admin-only, since credit_ledger
// RLS restricts writes to admins.
// ----------------------------------------------------------------------------
const PAYMENT_METHODS = ["qr", "card", "cash"] as const;

const GrantSchema = z.object({
  customer_id: z.string().uuid("Could not identify which customer to credit."),
  package_id: z.string().uuid("Choose a package to grant."),
  payment_method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Choose how it was paid (QR, card, or cash)." }),
  }),
});

export async function grantPackageAction(
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  await requireRole("admin", "/admin/customers");

  const parsed = GrantSchema.safeParse({
    customer_id: formData.get("customer_id"),
    package_id: formData.get("package_id"),
    payment_method: formData.get("payment_method"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { customer_id, package_id, payment_method } = parsed.data;
  const supabase = await createClient();

  // Look up the package so we know how many clips it grants and how long they
  // stay valid. Only active packages can be sold.
  const { data: pkg, error: pkgError } = await supabase
    .from("packages")
    .select("credits, validity_days, active")
    .eq("id", package_id)
    .single();

  if (pkgError || !pkg) {
    return { error: "That package could not be found." };
  }
  if (!pkg.active) {
    return { error: "That package is no longer available." };
  }

  // Clips expire validity_days after the grant. credit_balance() ignores
  // ledger rows whose expires_at has passed.
  const expiresAt = new Date(
    Date.now() + pkg.validity_days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await supabase.from("credit_ledger").insert({
    customer_id,
    delta: pkg.credits,
    reason: "purchase",
    package_id,
    booking_id: null,
    expires_at: expiresAt,
    payment_method,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Correct how an existing purchase was paid. Reception sometimes records the
// wrong method at the till, so admins can fix it after the fact. Only the
// payment_method column moves — credits, expiry and the package link stay put.
// Uses the service client because credit_ledger RLS allows admin inserts but is
// not proven to allow updates.
// ----------------------------------------------------------------------------
const PaymentMethodSchema = z.object({
  ledger_id: z.string().uuid("Could not identify which purchase to update."),
  payment_method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Choose how it was paid (QR, card, or cash)." }),
  }),
});

export async function updatePaymentMethodAction(
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  await requireRole("admin", "/admin/customers");

  const parsed = PaymentMethodSchema.safeParse({
    ledger_id: formData.get("ledger_id"),
    payment_method: formData.get("payment_method"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { ledger_id, payment_method } = parsed.data;
  const service = createServiceClient();

  const { error } = await service
    .from("credit_ledger")
    .update({ payment_method })
    .eq("id", ledger_id)
    .eq("reason", "purchase");

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Add a customer manually (reception).
//   • Walk-in   → a CRM record with no login (profile_id null), basic contact
//     details stored on the customer row.
//   • With login → create an auth user; the handle_new_user trigger then creates
//     the profile + customer record (+ starter credit).
// ----------------------------------------------------------------------------
const WalkInSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z
    .string()
    .trim()
    .email("Enter a valid email.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function createWalkInCustomerAction(
  _prev: AddCustomerState,
  formData: FormData,
): Promise<AddCustomerState> {
  await requireRole("admin", "/admin/customers");

  const parsed = WalkInSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({
    ...parsed.data,
    status: "active",
    source: "walk-in",
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/customers");
  return { ok: true, message: "Walk-in customer added." };
}

const WithLoginSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z.string().trim().email("A valid email is required for a login."),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function createCustomerWithLoginAction(
  _prev: AddCustomerState,
  formData: FormData,
): Promise<AddCustomerState> {
  await requireRole("admin", "/admin/customers");

  const parsed = WithLoginSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { name, email, phone } = parsed.data;
  const svc = createServiceClient();
  // Create the auth user; the handle_new_user trigger makes the profile +
  // customer record (+ starter credit). A random password is set — the member
  // can reset it via "forgot password" when they first log in.
  const { error } = await svc.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { role: "customer", full_name: name, phone },
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/customers");
  return {
    ok: true,
    message: `Account created for ${email}. They can set a password via "forgot password".`,
  };
}

const AttachLoginSchema = z.object({
  customer_id: z.string().uuid("Could not identify the customer."),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z.string().trim().email("A valid email is required."),
});

export async function attachLoginAction(
  _prev: AddCustomerState,
  formData: FormData,
): Promise<AddCustomerState> {
  await requireRole("admin", "/admin/customers");

  const parsed = AttachLoginSchema.safeParse({
    customer_id: formData.get("customer_id"),
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { customer_id, name, email } = parsed.data;
  const svc = createServiceClient();

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { role: "customer", full_name: name },
  });
  if (createErr || !created.user) {
    return { error: createErr?.message ?? "Could not create the login." };
  }
  const profileId = created.user.id;

  // The trigger created a fresh customer row for this new profile. Remove it and
  // point the existing walk-in record at the new profile instead, so the member's
  // in-studio history (credits, bookings) stays on the same customer.
  await svc.from("customers").delete().eq("profile_id", profileId);
  const { error: linkErr } = await svc
    .from("customers")
    .update({ profile_id: profileId })
    .eq("id", customer_id);
  if (linkErr) return { error: linkErr.message };

  revalidatePath("/admin/customers");
  return {
    ok: true,
    message: `Login attached — ${email} can now sign in (via "forgot password").`,
  };
}

// ----------------------------------------------------------------------------
// Delete a customer outright.
//
// Reception occasionally creates a duplicate or mistyped walk-in; this removes
// the CRM record and everything hanging off it. The customer's own auth user is
// left alone — deleting a login is a separate, heavier decision.
//
// Uses the service client because RLS on customers/credit_ledger/bookings does
// not grant admins a blanket delete (same approach as attachLoginAction).
// ----------------------------------------------------------------------------
const DeleteCustomerSchema = z.object({
  id: z.string().uuid("Could not identify which customer to delete."),
  confirm: z.literal("DELETE", {
    errorMap: () => ({ message: "Type DELETE to confirm." }),
  }),
});

export async function deleteCustomerAction(
  _prev: AddCustomerState,
  formData: FormData,
): Promise<AddCustomerState> {
  await requireRole("admin", "/admin/customers");

  const parsed = DeleteCustomerSchema.safeParse({
    id: formData.get("id"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { id } = parsed.data;
  const svc = createServiceClient();

  // There is no ON DELETE CASCADE from customers, so clear the dependent rows
  // first or the delete fails on a foreign-key violation.
  await svc.from("credit_ledger").delete().eq("customer_id", id);
  await svc.from("bookings").delete().eq("customer_id", id);

  const { error } = await svc.from("customers").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/customers");
  return { ok: true, message: "Customer deleted." };
}

export async function updateCustomerAction(
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  await requireRole("admin", "/admin/customers");

  const parsed = CustomerEditSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    source: formData.get("source") ?? undefined,
    emergency_contact: formData.get("emergency_contact") ?? undefined,
    date_of_birth: formData.get("date_of_birth") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    marketing_opt_in: formData.get("marketing_opt_in") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { id, ...fields } = parsed.data;
  const tags = parseTags(formData.get("tags"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ ...fields, tags })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true };
}
