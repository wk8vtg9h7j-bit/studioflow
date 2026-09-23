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

export type CustomerBookingHistoryItem = {
  id: string;
  status: string;
  spots: number;
  creditsSpent: number;
  bookedAt: string;
  cancelledAt: string | null;
  checkedInAt: string | null;
  session: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    studio: string;
    timezone: string;
    pool: string;
  } | null;
};

export type CustomerCreditHistoryItem = {
  id: string;
  delta: number;
  reason: string;
  pool: string;
  createdAt: string;
  expiresAt: string | null;
  paymentMethod: string | null;
  packageName: string | null;
};

export type CustomerHistoryResult = {
  bookings: CustomerBookingHistoryItem[];
  credits: CustomerCreditHistoryItem[];
  error?: string;
};

export async function getCustomerHistoryAction(
  customerId: string,
): Promise<CustomerHistoryResult> {
  await requireRole("admin", "/admin/customers");

  if (!z.string().uuid().safeParse(customerId).success) {
    return { bookings: [], credits: [], error: "Invalid customer." };
  }

  const svc = createServiceClient();

  const [bookingsRes, creditsRes] = await Promise.all([
    svc
      .from("bookings")
      .select(
        "id,status,spots_count,credits_spent,booked_at,cancelled_at,checked_in_at,session:sessions(id,title,starts_at,ends_at,studio:studios(name,timezone),class_type:class_types(name,pool))",
      )
      .eq("customer_id", customerId)
      .order("booked_at", { ascending: false })
      .limit(100),
    svc
      .from("credit_ledger")
      .select(
        "id,delta,reason,pool,created_at,expires_at,payment_method,package:packages(name)",
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (bookingsRes.error || creditsRes.error) {
    return {
      bookings: [],
      credits: [],
      error:
        bookingsRes.error?.message ??
        creditsRes.error?.message ??
        "Could not load customer history.",
    };
  }

  const bookings = ((bookingsRes.data ?? []) as unknown as {
    id: string;
    status: string;
    spots_count: number | null;
    credits_spent: number | null;
    booked_at: string;
    cancelled_at: string | null;
    checked_in_at: string | null;
    session:
      | {
          id: string;
          title: string | null;
          starts_at: string;
          ends_at: string;
          studio: { name: string; timezone: string } | null;
          class_type: { name: string; pool: string | null } | null;
        }
      | null;
  }[]).map((item) => ({
    id: item.id,
    status: item.status,
    spots: item.spots_count ?? 1,
    creditsSpent: item.credits_spent ?? 0,
    bookedAt: item.booked_at,
    cancelledAt: item.cancelled_at,
    checkedInAt: item.checked_in_at,
    session: item.session
      ? {
          id: item.session.id,
          title:
            item.session.title?.trim() ||
            item.session.class_type?.name ||
            "Class",
          startsAt: item.session.starts_at,
          endsAt: item.session.ends_at,
          studio: item.session.studio?.name ?? "Studio",
          timezone: item.session.studio?.timezone ?? "Asia/Ho_Chi_Minh",
          pool: item.session.class_type?.pool ?? "regular",
        }
      : null,
  }));

  const credits = ((creditsRes.data ?? []) as unknown as {
    id: string;
    delta: number;
    reason: string;
    pool: string | null;
    created_at: string;
    expires_at: string | null;
    payment_method: string | null;
    package: { name: string } | null;
  }[]).map((item) => ({
    id: item.id,
    delta: item.delta,
    reason: item.reason,
    pool: item.pool ?? "regular",
    createdAt: item.created_at,
    expiresAt: item.expires_at,
    paymentMethod: item.payment_method,
    packageName: item.package?.name ?? null,
  }));

  return { bookings, credits };
}

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
    .select("credits, validity_days, active, pool")
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
    pool: pkg.pool ?? "regular",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Adjust credits manually.
//
// A correction, goodwill gesture, or comped class — anything that moves a
// balance without money changing hands. Writes one signed row with reason
// 'adjustment', which is exactly what the signup trigger already does for the
// starter credit (see 0004_customer_on_signup.sql). Two consequences:
//
//   • expires_at is null, so the adjustment never lapses. Package clips expire;
//     a manual correction should not silently undo itself.
//   • /admin/payments filters on reason = 'purchase', so adjustments stay out of
//     revenue — they are credits, not income.
//
// Admin-only; credit_ledger RLS restricts writes to admins regardless.
// ----------------------------------------------------------------------------
const AdjustSchema = z.object({
  customer_id: z.string().uuid("Could not identify which customer to adjust."),
  pool: z.enum(["regular", "private"], {
    errorMap: () => ({ message: "Choose regular or private credits." }),
  }),
  delta: z.coerce
    .number({ invalid_type_error: "Enter a whole number of credits." })
    .int("Credits must be a whole number.")
    .refine((n) => n !== 0, "Enter a non-zero number of credits.")
    .refine((n) => Math.abs(n) <= 500, "That is too large an adjustment."),
});

export async function adjustCreditsAction(
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  await requireRole("admin", "/admin/customers");

  const parsed = AdjustSchema.safeParse({
    customer_id: formData.get("customer_id"),
    pool: formData.get("pool"),
    delta: formData.get("delta"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { customer_id, pool, delta } = parsed.data;
  const supabase = await createClient();

  // Guard against pushing a balance negative — book_session would refuse to
  // spend from it anyway, and a negative balance reads as a bug to reception.
  if (delta < 0) {
    const { data: balance } = await supabase.rpc("credit_balance", {
      p_customer: customer_id,
      p_pool: pool,
    });
    const current = typeof balance === "number" ? balance : 0;
    if (current + delta < 0) {
      return {
        error: `That would leave a negative balance (currently ${current}).`,
      };
    }
  }

  const { error } = await supabase.from("credit_ledger").insert({
    customer_id,
    delta,
    reason: "adjustment",
    package_id: null,
    booking_id: null,
    pool,
    expires_at: null,
  });

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
// Permanently delete a customer.
//
// This is deliberately admin-only and requires an explicit DELETE confirmation.
// Walk-ins have no auth account, so deleting the customer row is enough.
// Customers with a login are removed through Supabase Auth; profiles.id matches
// the auth user id, and the existing ON DELETE CASCADE chain removes the linked
// profile, customer, bookings, and credit ledger so ensure_customer() cannot
// silently recreate the account on the next booking attempt.
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

  const { data: customer, error: lookupError } = await svc
    .from("customers")
    .select("id, profile_id")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) return { error: lookupError.message };
  if (!customer) return { error: "That customer no longer exists." };

  const profileId = (customer as { profile_id: string | null }).profile_id;

  if (profileId) {
    const { error: authError } = await svc.auth.admin.deleteUser(profileId);
    if (authError) {
      return {
        error:
          "Could not delete the linked login account. Nothing was removed. " +
          authError.message,
      };
    }
  } else {
    const { error: deleteError } = await svc
      .from("customers")
      .delete()
      .eq("id", id);

    if (deleteError) return { error: deleteError.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true, message: "Customer permanently deleted." };
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
