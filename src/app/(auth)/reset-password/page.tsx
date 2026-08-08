// ============================================================================
// Reset-password page — the user arrives here from the recovery link after
// /auth/callback has exchanged the code for a session. They set a new password
// via updatePasswordAction, which then redirects to their dashboard.
// ============================================================================
"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { updatePasswordAction, type ResetState } from "../actions";
import { SubmitButton } from "../SubmitButton";

const initial: ResetState = {};

export default function ResetPasswordPage() {
  const [state, formAction] = useFormState(updatePasswordAction, initial);

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        Set a new password
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Choose a new password for your account.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="label">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="input"
            placeholder="••••••••"
          />
          <p className="mt-1 text-xs text-ink-soft">At least 8 characters.</p>
        </div>

        {state.error ? (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        ) : null}

        <SubmitButton>Update password</SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        <Link
          href="/forgot-password"
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Request a new link
        </Link>
      </p>
    </div>
  );
}
