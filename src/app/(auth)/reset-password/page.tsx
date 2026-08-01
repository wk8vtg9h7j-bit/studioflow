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
import { getDict } from "@/lib/i18n";
import { useLocale } from "@/components/LocaleProvider";

const initial: ResetState = {};

export default function ResetPasswordPage() {
  const [state, formAction] = useFormState(updatePasswordAction, initial);
  const dict = getDict(useLocale());

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {dict.reset_title}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">{dict.reset_intro}</p>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="label">
            {dict.reset_new_password}
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
          <p className="mt-1 text-xs text-ink-soft">
            {dict.reset_password_hint}
          </p>
        </div>

        {state.error ? (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        ) : null}

        <SubmitButton>{dict.reset_submit}</SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        <Link
          href="/forgot-password"
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          {dict.reset_request_new}
        </Link>
      </p>
    </div>
  );
}
