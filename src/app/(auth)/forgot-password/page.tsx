// ============================================================================
// Forgot-password page — enter your email to receive a reset link. Posts to the
// requestPasswordResetAction; on success we show a "check your inbox" message
// without revealing whether the address is registered.
// ============================================================================
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormState } from "react-dom";
import { requestPasswordResetAction, type ResetState } from "../actions";
import { SubmitButton } from "../SubmitButton";

const initial: ResetState = {};

function ForgotPasswordForm() {
  const [state, formAction] = useFormState(requestPasswordResetAction, initial);
  // The callback route bounces expired/invalid recovery links back here.
  const expired = useSearchParams().get("error") === "expired";

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        Reset your password
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Enter the email you book with and we&apos;ll send you a link to set a new
        password.
      </p>

      {expired && !state.ok && (
        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          That reset link has expired or was already used. Request a new one
          below.
        </div>
      )}

      {state.ok ? (
        <div className="mt-6 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
          If that email is registered, a reset link is on its way. Check your
          inbox — and your spam folder.
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
          Back to log in
        </Link>
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
