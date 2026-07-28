// ============================================================================
// Cancel button for a booking. When the class is less than 3 hours away, a
// booked member forfeits their credit on cancellation — so we pop a confirm
// dialog making that explicit before the server action runs. Outside the
// window (or for waitlist spots with no credit at stake) it cancels directly.
// ============================================================================
"use client";

import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { cancelBookingAction } from "./actions";

export function CancelBookingForm({
  bookingId,
  warnNoRefund,
}: {
  bookingId: string;
  warnNoRefund: boolean;
}) {
  return (
    <form
      action={cancelBookingAction}
      onSubmit={(e) => {
        if (
          warnNoRefund &&
          !window.confirm(
            "This class starts in less than 3 hours.\n\n" +
              "If you cancel now your credit will NOT be refunded.\n\n" +
              "Cancel anyway?",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="booking_id" value={bookingId} />
      <SubmitButton>Cancel</SubmitButton>
    </form>
  );
}
