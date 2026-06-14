// ============================================================================
// Admin pay-rule server actions.
//
// A pay rule answers one question: "for THIS instructor, at THIS studio, for
// (optionally) THIS class type, how much do they earn when N students show up?"
// That is exactly the `tiered` pay model — `compute_pay()` walks the rule's
// `tiers` jsonb and picks the band whose [min, max] contains the attendance,
// then `resolve_pay_rule()` picks the most specific active rule (instructor +
// class_type + studio, priority desc) when a session is recalculated.
//
// The admin only ever authors per-headcount bands here, so we keep the UI
// honest by exposing four amounts — the pay for 1, 2, 3, and 4-or-more students
// — and assembling them into the canonical tier shape the engine reads:
//
//   [{ "min": 1, "max": 1, "amount": a1 },
//    { "min": 2, "max": 2, "amount": a2 },
//    { "min": 3, "max": 3, "amount": a3 },
//    { "min": 4,           "amount": a4 }]   // 4+ (no max = open-ended)
//
// A class with 0 students matches no band, so compute_pay returns 0 — nobody is
// paid for a class nobody attended. model is always "tiered" from this surface;
// the other models (flat / per_head / base_plus_per_head) still exist in the DB
// for rules authored directly, we just don't expose them here.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PayRuleActionState = { error?: string; ok?: boolean };

// Each headcount amount is a decimal (numeric(10,2)) — e.g. 25.00, or 100000
// for a VND studio. Coerce from the form string, clamp to >= 0.
const amount = z.coerce
  .number({ invalid_type_error: "Enter an amount" })
  .min(0, "Amount can't be negative")
  .max(99999999, "Amount is too large");

const PayRuleSchema = z.object({
  name: z.string().trim().min(1, "Give this rule a name").max(120),
  studio_id: z.string().uuid("Pick a studio"),
  instructor_id: z.string().uuid("Pick an instructor"),
  // Optional — blank means the rule applies to every class type at the studio.
  class_type_id: z.string().uuid().optional().or(z.literal("")),
  currency: z
    .string()
    .trim()
    .min(3, "Use a 3-letter currency code")
    .max(3, "Use a 3-letter currency code")
    .transform((v) => v.toUpperCase()),
  amount_1: amount,
  amount_2: amount,
  amount_3: amount,
  amount_4: amount,
  priority: z.coerce.number().int().min(0).max(1000),
  active: z.boolean(),
});

function parseForm(formData: FormData) {
  return PayRuleSchema.safeParse({
    name: formData.get("name"),
    studio_id: formData.get("studio_id"),
    instructor_id: formData.get("instructor_id"),
    class_type_id: formData.get("class_type_id"),
    currency: formData.get("currency"),
    amount_1: formData.get("amount_1"),
    amount_2: formData.get("amount_2"),
    amount_3: formData.get("amount_3"),
    amount_4: formData.get("amount_4"),
    priority: formData.get("priority"),
    // An unchecked checkbox sends nothing; presence of the field = active.
    active: formData.get("active") != null,
  });
}

// Round to 2dp so the jsonb mirrors the numeric(10,2) precision the rest of the
// engine assumes.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type Parsed = z.infer<typeof PayRuleSchema>;

// Assemble the four per-headcount amounts into the tier bands compute_pay reads.
function buildTiers(p: Parsed) {
  return [
    { min: 1, max: 1, amount: round2(p.amount_1) },
    { min: 2, max: 2, amount: round2(p.amount_2) },
    { min: 3, max: 3, amount: round2(p.amount_3) },
    { min: 4, amount: round2(p.amount_4) },
  ];
}

// The row payload shared by insert and update. model is pinned to "tiered" and
// base/per_head stay 0 — they're unused by this model but the columns are NOT
// NULL with defaults, so we leave them at their defaults on insert.
function rulePayload(p: Parsed) {
  return {
    name: p.name,
    model: "tiered" as const,
    currency: p.currency,
    tiers: buildTiers(p),
    studio_id: p.studio_id,
    instructor_id: p.instructor_id,
    class_type_id: p.class_type_id ? p.class_type_id : null,
    priority: p.priority,
    active: p.active,
  };
}

export async function createPayRuleAction(
  _prev: PayRuleActionState,
  formData: FormData,
): Promise<PayRuleActionState> {
  await requireRole("admin", "/admin/pay-rules");

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("pay_rules").insert(rulePayload(parsed.data));
  if (error) return { error: error.message };

  revalidatePath("/admin/pay-rules");
  return { ok: true };
}

export async function updatePayRuleAction(
  _prev: PayRuleActionState,
  formData: FormData,
): Promise<PayRuleActionState> {
  await requireRole("admin", "/admin/pay-rules");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing pay rule id" };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("pay_rules")
    .update(rulePayload(parsed.data))
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/pay-rules");
  return { ok: true };
}

// Toggle a rule active/inactive without opening the editor. Inactive rules are
// skipped by resolve_pay_rule, so this is the quick "retire this rate" switch.
export async function setPayRuleActiveAction(formData: FormData) {
  await requireRole("admin", "/admin/pay-rules");

  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const active = String(formData.get("active") ?? "") === "true";

  const supabase = await createClient();
  await supabase.from("pay_rules").update({ active }).eq("id", id);

  revalidatePath("/admin/pay-rules");
}
