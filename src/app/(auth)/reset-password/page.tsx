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
import { useLanguage } from "@/components/LanguageProvider";

const initial: ResetState = {};

export default function ResetPasswordPage() {
  const [state, formAction] = useFormState(updatePasswordAction, initial);
  const { locale } = useLanguage();
  const vi = locale === "vi";

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {vi ? "Tạo mật khẩu mới" : "Set a new password"}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {vi
          ? "Chọn mật khẩu mới cho tài khoản của bạn. Bạn sẽ được đăng nhập ngay sau đó."
          : "Choose a new password for your account. You'll be signed in straight away."}
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="label">
            {vi ? "Mật khẩu mới" : "New password"}
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
            {vi ? "Ít nhất 8 ký tự." : "At least 8 characters."}
          </p>
        </div>

        {state.error ? (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        ) : null}

        <SubmitButton pendingLabel={vi ? "Vui lòng đợi…" : "Please wait…"}>{vi ? "Lưu mật khẩu" : "Save password"}</SubmitButton>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        <Link
          href="/forgot-password"
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          {vi ? "Yêu cầu liên kết mới" : "Request a new link"}
        </Link>
      </p>
    </div>
  );
}
