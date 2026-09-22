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
import { useLanguage } from "@/components/LanguageProvider";

const initial: ResetState = {};

function ForgotPasswordForm() {
  const [state, formAction] = useFormState(requestPasswordResetAction, initial);
  const { locale } = useLanguage();
  const vi = locale === "vi";
  // The callback route bounces expired/invalid recovery links back here.
  const expired = useSearchParams().get("error") === "expired";

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {vi ? "Đặt lại mật khẩu" : "Reset your password"}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {vi
          ? "Nhập email bạn dùng để đặt lớp và chúng tôi sẽ gửi liên kết để tạo mật khẩu mới."
          : "Enter the email you book with and we'll send you a link to set a new password."}
      </p>

      {expired && !state.ok && (
        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {vi
            ? "Liên kết đặt lại đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu liên kết mới bên dưới."
            : "That reset link has expired or was already used. Request a new one below."}
        </div>
      )}

      {state.ok ? (
        <div className="mt-6 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
          {vi
            ? "Nếu email đã được đăng ký, liên kết đặt lại đang được gửi. Hãy kiểm tra hộp thư đến và thư rác."
            : "If that email is registered, a reset link is on its way. Check your inbox — and your spam folder."}
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

          <SubmitButton pendingLabel={vi ? "Vui lòng đợi…" : "Please wait…"}>{vi ? "Gửi liên kết" : "Send reset link"}</SubmitButton>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">
        {vi ? "Nhớ mật khẩu rồi? " : "Remembered it? "}
        <Link
          href="/login"
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          {vi ? "Quay lại đăng nhập" : "Back to log in"}
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
