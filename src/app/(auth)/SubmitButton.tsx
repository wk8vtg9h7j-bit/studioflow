// ============================================================================
// Submit button that reflects the surrounding form's pending state, so the user
// gets immediate feedback while a server action runs.
// ============================================================================
"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  disabled,
}: {
  children: React.ReactNode;
  // Callers can force-disable the button when the action can't succeed — a held
  // full class, for example — so the user never spends a round-trip on a no.
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-primary w-full"
      disabled={pending || disabled}
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}
