// ============================================================================
// Submit button that reflects the surrounding form's pending state, so the user
// gets immediate feedback while a server action runs.
// ============================================================================
"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Please wait…" : children}
    </button>
  );
}
