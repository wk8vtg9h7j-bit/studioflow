// ============================================================================
// Cancel button for a booking. When the class is less than 3 hours away, a
// booked member forfeits their credit on cancellation — so we pop a confirm
// dialog making that explicit before the server action runs. Outside the
// window (or for waitlist spots with no credit at stake) it cancels directly.
// ============================================================================
"use client";

import type { Dict } from "@/lib/i18n";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { cancelBookingAction } from "./actions";

export function CancelBookingForm({
  bookingId,
  warnNoRefund,
  dict,
}: {
  bookingId: string;
  warnNoRefund: boolean;
  dict: Dict;
}) {
  return (
    <form
      action={cancelBookingAction}
      onSubmit={(e) => {
        if (warnNoRefund && !window.confirm(dict.booking_cancel_warning)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="booking_id" value={bookingId} />
      <SubmitButton>{dict.booking_cancel}</SubmitButton>
    </form>
  );
}
