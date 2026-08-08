// ============================================================================
// Forgot-password page — enter your email to receive a reset link. Posts to the
// requestPasswordResetAction; on success we show a "check your inbox" message
// without revealing whether the address is registered.
// ============================================================================
"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { requestPasswordResetAction, type ResetState } from "../actions";
import { SubmitButton } from "../SubmitButton";

const initial: ResetState = {};

export default function ForgotPasswordPage() {
  const [state, formAction] = useFormState(requestPasswordResetAction, initial);

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        Reset your password
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Enter your email and we&rsquo;ll send you a link to set a new password.
      </p>

      {state.ok ? (
        <div className="mt-6 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
          If an account exists for that email, a reset link is on its way. Check
          your inbox (and spam).
        </div>
      ) : (
        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              placeholder="you@studio.com"
            />
          </div>

          {state.error ? (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          ) : null}

          <SubmitButton>Send reset link</SubmitButton>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Back to login
        </Link>
      </p>
    </div>
  );
}
