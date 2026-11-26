// ============================================================================
// Set a new password.
//
// The form is rendered immediately and the recovery token is carried through
// to the server action in a hidden field, where it is exchanged on submit.
//
// It used to work the other way round: the token was spent when the link was
// opened, and the form only appeared if a follow-up getUser() succeeded. That
// failed in two ways at once — email scanners opening the link first spent the
// single-use token, and any hiccup reading the session back left the member
// staring at "invalid or expired" with no way forward. In five days of
// production logs not one member reached the point of saving a password.
// ============================================================================
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { updatePasswordAction, type ResetState } from "../actions";
import { SubmitButton } from "../SubmitButton";
import { useLanguage } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";

const initial: ResetState = {};

export default function ResetPasswordPage() {
  const [state, formAction] = useFormState(updatePasswordAction, initial);
  const [code, setCode] = useState("");
  const [tokenHash, setTokenHash] = useState("");
  const [linkError, setLinkError] = useState(false);
  const { locale } = useLanguage();
  const vi = locale === "vi";

  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));

    // Supabase reports a dead or malformed link this way.
    if (hash.get("error") || url.searchParams.get("error")) {
      setLinkError(true);
      return;
    }

    const nextCode = url.searchParams.get("code") ?? "";
    const nextTokenHash =
      url.searchParams.get("token_hash") ?? hash.get("token_hash") ?? "";
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    if (nextCode) setCode(nextCode);
    if (nextTokenHash) setTokenHash(nextTokenHash);

    // Some mail clients deliver the session in the URL fragment rather than as
    // a code. A fragment never reaches the server, so establish the session
    // here — the browser client writes the same cookies the server action
    // reads on submit.
    if (accessToken && refreshToken) {
      void createClient().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
    }

    // Keep the token out of the address bar (and out of any Referer header)
    // now that we are holding it in state.
    if (nextCode || nextTokenHash || accessToken || refreshToken) {
      window.history.replaceState(null, "", url.pathname);
    }
  }, []);

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {vi ? "Tạo mật khẩu mới" : "Set a new password"}
      </h1>

      {linkError ? (
        <div className="mt-4" role="alert">
          <p className="text-sm text-red-600">
            {vi
              ? "Liên kết đặt lại không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới."
              : "This reset link is invalid or has expired. Please request a new one."}
          </p>
          <Link
            href="/forgot-password"
            className="mt-4 inline-block font-medium text-brand-600 hover:text-brand-700"
          >
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
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="token_hash" value={tokenHash} />
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
            <SubmitButton pendingLabel={vi ? "Vui lòng đợi…" : "Please wait…"}>
              {vi ? "Lưu mật khẩu" : "Save password"}
            </SubmitButton>
          </form>
          <p className="mt-6 text-center text-sm text-ink-muted">
            <Link
              href="/forgot-password"
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              {vi ? "Yêu cầu liên kết mới" : "Request a new link"}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
