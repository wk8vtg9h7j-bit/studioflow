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
import { getDict } from "@/lib/i18n";
import { useLocale } from "@/components/LocaleProvider";

const initial: ResetState = {};

export default function ForgotPasswordPage() {
  const [state, formAction] = useFormState(requestPasswordResetAction, initial);
  const dict = getDict(useLocale());

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {dict.forgot_title}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {dict.forgot_intro}
      </p>

      {state.ok ? (
        <div className="mt-6 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
          {dict.forgot_success}
        </div>
      ) : (
        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="label">
              {dict.auth_email}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              placeholder={dict.email_placeholder}
            />
          </div>

          {state.error ? (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          ) : null}

          <SubmitButton>{dict.forgot_submit}</SubmitButton>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">
        {dict.forgot_remembered}{" "}
        <Link
          href="/login"
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          {dict.forgot_back_to_login}
        </Link>
      </p>
    </div>
  );
}
