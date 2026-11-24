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
import { useLanguage } from "@/components/LanguageProvider";

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

// Reuse the publicly available cover photographs already configured for
// StudioFlow's two customer-facing studios. No extra database dependency
// is introduced into the authentication flow.
const STUDIO_PHOTOS = [
  {
    name: "Hideaway Pilates",
    address: "460 Trưng Nữ Vương",
    image: "https://znrjjqkjpcabcilyhwdk.supabase.co/storage/v1/object/public/studio-gallery/29a71d53-effe-4343-8da2-f523d6f109f8/1390141e-bd08-40f8-aa56-4deb24320032.jpg",
  },
  {
    name: "Downtown Pilates",
    address: "89 Lê Thanh Nghị",
    image: "https://znrjjqkjpcabcilyhwdk.supabase.co/storage/v1/object/public/studio-gallery/3f017a73-cf60-4c97-a8c6-f683f4041c7c/4b4f5f11-e242-42d1-bea9-3f6758395de5.jpg",
  },
] as const;

function StudioPhotography({ vi }: { vi: boolean }) {
  return (
    <section
      aria-label={vi ? "Các studio Pilates của chúng tôi" : "Our Pilates studios"}
      className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-1"
    >
      {STUDIO_PHOTOS.map((studio) => (
        <figure
          key={studio.name}
          className="relative isolate aspect-[4/3] overflow-hidden rounded-xl bg-[#55594b] sm:aspect-[16/9] lg:aspect-[2.15/1] lg:rounded-2xl"
        >
          {/* The same public Storage image URLs are used by the studio gallery.
              Keep a normal image element to avoid requiring new Next image host configuration. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={studio.image}
            alt={studio.name}
            className="absolute inset-0 h-full w-full object-cover"
            decoding="async"
            onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent"
          />
          <figcaption className="absolute inset-x-0 bottom-0 p-2.5 text-white sm:p-4 lg:p-6">
            <p className="text-[10px] font-semibold uppercase leading-snug tracking-[0.08em] sm:text-sm lg:text-base">
              {studio.name}
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-white/95 sm:text-xs lg:text-sm">
              {studio.address}
            </p>
          </figcaption>
        </figure>
      ))}
    </section>
  );
}

function LoginForm() {
  const [state, formAction] = useFormState(signInAction, initial);
  const next = useSearchParams().get("next") ?? "";
  const { locale } = useLanguage();
  const vi = locale === "vi";

  return (
    <div className="studio-login grid items-center gap-7 lg:grid-cols-[1.15fr_1fr] lg:gap-12 xl:gap-16">
      <StudioPhotography vi={vi} />
      <div className="mx-auto w-full max-w-md min-w-0 px-1 sm:px-0 [&_.btn-primary]:min-h-[46px] [&_.btn-primary]:bg-[#34402c] [&_.btn-primary:hover]:bg-[#263222] [&_.input]:min-h-[44px] [&_.input]:border-[#cfcac0] [&_.input]:bg-white/65 [&_.input:focus]:border-[#657559] [&_.input:focus]:ring-[#657559]">
      <h1 className="font-serif text-3xl tracking-tight text-[#263222] sm:text-4xl lg:text-5xl">
        {vi ? "Chào mừng trở lại" : "Welcome back"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
        {vi ? "Đăng nhập để đặt lớp và quản lý tài khoản của bạn." : "Log in to manage your studio or book a class."}
      </p>

      <p className="mt-4 text-sm text-ink-muted">
        {vi ? "Chưa có tài khoản?" : "New here?"}{" "}
        <Link href="/signup" className="font-medium text-[#34402c] underline underline-offset-2 hover:text-[#263222]">
          {vi ? "Tạo tài khoản" : "Create an account"}
        </Link>
      </p>

      <form action={formAction} className="mt-7 space-y-5">
        <input type="hidden" name="next" value={next} />

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

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="password" className="label">
              {vi ? "Mật khẩu" : "Password"}
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-[#34402c] underline underline-offset-2 hover:text-[#263222]"
            >
              {vi ? "Quên mật khẩu?" : "Forgot password?"}
            </Link>
          </div>
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

        <SubmitButton pendingLabel={vi ? "Vui lòng đợi…" : "Please wait…"}>{vi ? "Đăng nhập" : "Log in"}</SubmitButton>
      </form>

      <PreviewRolePicker next={next} />
      </div>
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
