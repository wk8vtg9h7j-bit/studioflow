// ============================================================================
// "Continue with Google" — posts to signInWithGoogleAction, which redirects the
// browser to Google. Rendered above the email/password form on both the login
// and signup pages, with the divider included so those pages stay tidy.
//
// Inert in preview mode: the auth endpoints are stubbed there, so the button is
// hidden rather than left to fail.
// ============================================================================
"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signInWithGoogleAction, type AuthState } from "./actions";
import { useLanguage } from "@/components/LanguageProvider";

const initial: AuthState = { error: null };

const PREVIEW_MODE = process.env.NEXT_PUBLIC_PREVIEW_MODE === "1";

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function GoogleSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-secondary flex w-full items-center justify-center gap-2"
      disabled={pending}
    >
      {pending ? null : <GoogleMark />}
      <span>{pending ? pendingLabel : label}</span>
    </button>
  );
}

export function GoogleButton({ next = "" }: { next?: string }) {
  const [state, formAction] = useFormState(signInWithGoogleAction, initial);
  const { locale } = useLanguage();
  const vi = locale === "vi";

  if (PREVIEW_MODE) return null;

  return (
    <div className="mt-6">
      <form action={formAction}>
        <input type="hidden" name="next" value={next} />
        <GoogleSubmit
          label={vi ? "Tiếp tục với Google" : "Continue with Google"}
          pendingLabel={vi ? "Đang chuyển…" : "Redirecting…"}
        />
      </form>

      {state.error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {vi ? "hoặc" : "or"}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
