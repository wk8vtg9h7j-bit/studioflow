// ============================================================================
// Login page — email/password form posting to the signInAction server action.
// Honors a `next` query param so guarded routes can bounce users back here and
// return them afterward.
// ============================================================================
"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signInAction, type AuthState } from "../actions";
import { SubmitButton } from "../SubmitButton";
import { getDict } from "@/lib/i18n";
import { useLocale } from "@/components/LocaleProvider";

const initial: AuthState = { error: null };

// Preview-only: render plain links that set a role cookie and drop straight
// into the matching dashboard. Inert in production (flag unset).
const PREVIEW_MODE = process.env.NEXT_PUBLIC_PREVIEW_MODE === "1";

function PreviewRolePicker({ next }: { next: string }) {
  if (!PREVIEW_MODE) return null;
  const roles: { role: string; label: string }[] = [
    { role: "admin", label: "Continue as Admin" },
    { role: "instructor", label: "Continue as Instructor" },
    { role: "customer", label: "Continue as Member" },
  ];
  const q = next ? `&next=${encodeURIComponent(next)}` : "";
  return (
    <div className="mt-6 border-t border-line pt-6">
      <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-ink-muted">
        Preview mode — skip login
      </p>
      <div className="space-y-2">
        {roles.map(({ role, label }) => (
          <a
            key={role}
            href={`/api/preview/login?role=${role}${q}`}
            className="btn btn-secondary w-full justify-center"
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}

function LoginForm() {
  const [state, formAction] = useFormState(signInAction, initial);
  const next = useSearchParams().get("next") ?? "";
  const dict = getDict(useLocale());

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {dict.login_title}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">{dict.login_intro}</p>

      <form action={formAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />

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
            autoComplete="current-password"
            required
            className="input"
            placeholder="••••••••"
          />
        </div>

        {state.error ? (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        ) : null}

        <SubmitButton>{dict.login_submit}</SubmitButton>
      </form>

      <PreviewRolePicker next={next} />

      <p className="mt-6 text-center text-sm text-ink-muted">
        {dict.login_new_here}{" "}
        <Link href="/signup" className="font-medium text-brand-600 hover:text-brand-700">
          {dict.login_create_account}
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
