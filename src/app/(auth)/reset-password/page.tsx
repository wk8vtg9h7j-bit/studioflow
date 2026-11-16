"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { updatePasswordAction, type ResetState } from "../actions";
import { SubmitButton } from "../SubmitButton";
import { useLanguage } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";

const initial: ResetState = {};

type RecoveryStatus = "checking" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const [state, formAction] = useFormState(updatePasswordAction, initial);
  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const { locale } = useLanguage();
  const vi = locale === "vi";

  useEffect(() => {
    let active = true;

    async function establishRecoverySession() {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const tokenHash = url.searchParams.get("token_hash") || hash.get("token_hash");
      const type = url.searchParams.get("type") || hash.get("type");
      const code = url.searchParams.get("code");

      try {
        // Some email clients deliver the recovery credentials in the URL
        // fragment instead of routing through /auth/callback.
        if (hash.get("error") || url.searchParams.get("error")) {
          if (active) setStatus("invalid");
          return;
        }
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else if (tokenHash && type === "recovery") {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        // Never show an actionable password form without a valid session.
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) throw error || new Error("Missing recovery session");

        if (accessToken || refreshToken || tokenHash || code) {
          window.history.replaceState(null, "", url.pathname);
        }
        if (active) setStatus("ready");
      } catch {
        if (active) setStatus("invalid");
      }
    }

    void establishRecoverySession();
    return () => { active = false; };
  }, []);

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {vi ? "Tạo mật khẩu mới" : "Set a new password"}
      </h1>

      {status === "checking" ? (
        <p className="mt-4 text-sm text-ink-muted" role="status">
          {vi ? "Đang xác minh liên kết đặt lại…" : "Verifying your reset link…"}
        </p>
      ) : status === "invalid" ? (
        <div className="mt-4" role="alert">
          <p className="text-sm text-red-600">
            {vi
              ? "Liên kết đặt lại không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới và mở trong cùng trình duyệt."
              : "This reset link is invalid or has expired. Request a new link and open it in the same browser."}
          </p>
          <Link href="/forgot-password" className="mt-4 inline-block font-medium text-brand-600 hover:text-brand-700">
            {vi ? "Yêu cầu liên kết mới" : "Request a new link"}
          </Link>
        </div>
      ) : (
        <>
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
              <p className="text-sm text-red-600" role="alert">{state.error}</p>
            ) : null}
            <SubmitButton pendingLabel={vi ? "Vui lòng đợi…" : "Please wait…"}>
              {vi ? "Lưu mật khẩu" : "Save password"}
            </SubmitButton>
          </form>
          <p className="mt-6 text-center text-sm text-ink-muted">
            <Link href="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">
              {vi ? "Yêu cầu liên kết mới" : "Request a new link"}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
