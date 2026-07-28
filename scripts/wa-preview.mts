// ============================================================================
// Dev preview harness — renders the REAL WhatsApp message text and phone
// normalization from the actual source modules, with no database or network.
//
// Run it:  node scripts/wa-preview.mts
// (Node >= 22.6 strips TypeScript types on the fly.)
//
// This is a verification/inspection tool, not part of the app. It imports the
// same templates.ts / phone.ts the dispatcher uses, so what you see here is
// exactly what would be sent.
// ============================================================================
import {
  TEMPLATE_NAME,
  buildParams,
  renderText,
} from "../src/lib/whatsapp/templates.ts";
import { toE164, toWaRecipient } from "../src/lib/whatsapp/phone.ts";
import type { OutboxKind } from "../src/lib/types.ts";

// A representative payload, like one the booking trigger writes to the outbox.
// starts_at is UTC; the studio timezone (+07) renders it as 08:30 local.
const payload: Record<string, unknown> = {
  booking_id: "b-123",
  session_id: "s-456",
  customer_name: "Mai Nguyen",
  instructor_name: "Linh Tran",
  class_name: "Reformer Flow",
  studio_name: "District 1",
  timezone: "Asia/Ho_Chi_Minh",
  starts_at: "2026-06-20T01:30:00Z",
  capacity: 8,
  booked_count: 5,
  status: "booked",
};

const KINDS: OutboxKind[] = [
  "owner_booking_alert",
  "booking_confirmation",
  "booking_cancelled",
  "waitlist_promoted",
  "customer_reminder",
  "instructor_reminder",
];

console.log("=".repeat(72));
console.log("RENDERED WHATSAPP MESSAGES (real templates.ts output)");
console.log("=".repeat(72));
for (const kind of KINDS) {
  console.log(`\n• kind:     ${kind}`);
  console.log(`  template: ${TEMPLATE_NAME[kind]}`);
  console.log(`  params:   ${JSON.stringify(buildParams(kind, payload))}`);
  console.log(`  text:     ${renderText(kind, payload)}`);
}

console.log("\n" + "=".repeat(72));
console.log("PHONE NORMALIZATION (real phone.ts output)");
console.log("=".repeat(72));
const phones = [
  "0901234567",
  "+84 90 123 4567",
  "0084 901 234 567",
  "901234567",
  "(090) 123-4567",
  "+1 415 555 2671",
  "",
];
for (const p of phones) {
  console.log(
    `  ${JSON.stringify(p).padEnd(22)} -> E164 ${String(toE164(p)).padEnd(16)} | recipient ${toWaRecipient(p)}`,
  );
}
console.log("");
