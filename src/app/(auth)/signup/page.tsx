// ============================================================================
// Signup page — public customer registration. Posts to signUpAction, which
// stamps the `customer` role and redirects to the booking page on success.
// ============================================================================
"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { signUpAction, type AuthState } from "../actions";
import { SubmitButton } from "../SubmitButton";
import { getDict } from "@/lib/i18n";
import { useLocale } from "@/components/LocaleProvider";

const initial: AuthState = { error: null };

// Preview-only: render plain links that set a role cookie and drop straight
// into the matching dashboard. Inert in production (flag unset).
const PREVIEW_MODE = process.env.NEXT_PUBLIC_PREVIEW_MODE === "1";

function PreviewRolePicker() {
  if (!PREVIEW_MODE) return null;
  const roles: { role: string; label: string }[] = [
    { role: "admin", label: "Continue as Admin" },
    { role: "instructor", label: "Continue as Instructor" },
    { role: "customer", label: "Continue as Member" },
  ];
  return (
    <div className="mt-6 border-t border-line pt-6">
      <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-ink-muted">
        Preview mode — skip sign up
      </p>
      <div className="space-y-2">
        {roles.map(({ role, label }) => (
          <a
            key={role}
            href={`/api/preview/login?role=${role}`}
            className="btn btn-secondary w-full justify-center"
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function SignupPage() {
  const [state, formAction] = useFormState(signUpAction, initial);
  const dict = getDict(useLocale());

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {dict.signup_title}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">{dict.signup_intro}</p>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="fullName" className="label">
            {dict.signup_full_name}
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            className="input"
            placeholder={dict.signup_name_placeholder}
          />
        </div>

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
            placeholder="you@studio.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="label">
            {dict.auth_password}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="input"
            placeholder={dict.signup_password_hint}
          />
        </div>

        {state.error ? (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        ) : null}

        <SubmitButton>{dict.signup_submit}</SubmitButton>
      </form>

      <PreviewRolePicker />

      <p className="mt-6 text-center text-sm text-ink-muted">
        {dict.signup_have_account}{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
          {dict.signup_login_link}
        </Link>
      </p>
    </div>
  );
}
