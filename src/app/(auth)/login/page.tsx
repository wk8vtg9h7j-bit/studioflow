// ============================================================================
// Login page — email/password form posting to the signInAction server action.
// Honors a `next` query param so guarded routes can bounce users back here and
// return them afterward.
// ============================================================================
"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { WEEKLY_STUDIO_SCHEDULE } from "@/lib/studioSchedule";
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
    slug: "hideaway-pilates",
    id: "29a71d53-effe-4343-8da2-f523d6f109f8",
    address: "460 Trưng Nữ Vương",
    image: "https://znrjjqkjpcabcilyhwdk.supabase.co/storage/v1/object/public/studio-gallery/29a71d53-effe-4343-8da2-f523d6f109f8/1390141e-bd08-40f8-aa56-4deb24320032.jpg",
  },
  {
    name: "Downtown Pilates",
    slug: "downtown-pilates",
    id: "3f017a73-cf60-4c97-a8c6-f683f4041c7c",
    address: "89 Lê Thanh Nghị",
    image: "https://znrjjqkjpcabcilyhwdk.supabase.co/storage/v1/object/public/studio-gallery/3f017a73-cf60-4c97-a8c6-f683f4041c7c/4b4f5f11-e242-42d1-bea9-3f6758395de5.jpg",
  },
] as const;

type StudioPhoto = (typeof STUDIO_PHOTOS)[number];
type UpcomingClass = { startsAt: string; name: string };
type ScheduleResult = { classes: UpcomingClass[] };

function StudioScheduleDialog({ studio, vi, onClose, onBook }: {
  studio: StudioPhoto;
  vi: boolean;
  onClose: () => void;
  onBook: (studio: StudioPhoto, date?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ScheduleResult | null>(null);
  const [failed, setFailed] = useState(false);
  const weekly = WEEKLY_STUDIO_SCHEDULE[studio.slug];

  useEffect(() => {
    const element = dialog.current;
    const controller = new AbortController();
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fetch("/api/public/studio-schedule?studio=" + encodeURIComponent(studio.slug), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Schedule unavailable");
        return (await response.json()) as ScheduleResult;
      })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
      element?.close();
    };
  }, [studio.slug]);

  const zone = "Asia/Ho_Chi_Minh";
  const dateLabel = new Intl.DateTimeFormat(vi ? "vi-VN" : "en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: zone,
  });
  const timeLabel = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone,
  });
  const dateKey = (value: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone,
    }).formatToParts(new Date(value));
    return ["year", "month", "day"].map((type) => parts.find((p) => p.type === type)?.value).join("-");
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="studio-schedule-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-24px)] max-w-xl overflow-y-auto rounded-2xl border border-[#e2dbce] bg-[#f6f3ed] p-0 text-[#263222] shadow-2xl backdrop:bg-black/50 sm:rounded-3xl"
    >
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#68745e]">{vi ? "Lịch tập Pilates" : "Pilates schedule"}</p>
            <h2 id="studio-schedule-title" className="mt-1 font-serif text-2xl sm:text-3xl">{studio.name}</h2>
            <p className="mt-1 text-sm text-ink-muted">{studio.address}</p>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label={vi ? "Đóng" : "Close"} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#d5cec2] bg-white text-xl hover:bg-stone-100">×</button>
        </div>
        <section className="mt-5">
          <h3 className="text-sm font-semibold">{vi ? "Lịch hàng tuần" : "Weekly timetable"}</h3>
          <p className="mt-1 text-xs text-ink-muted">{vi ? "Giờ thường lệ · giờ Đà Nẵng · có thể thay đổi" : "Regular times · Da Nang time · subject to change"}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              { label: vi ? "Thứ 2 – Thứ 6" : "Monday – Friday", times: weekly.weekdayTimes },
              { label: vi ? "Thứ 7 – Chủ nhật" : "Saturday – Sunday", times: weekly.weekendTimes },
            ].map((group) => (
              <div key={group.label} className="rounded-xl border border-[#e2dbce] bg-white/70 p-3">
                <p className="text-xs font-semibold">{group.label}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group.times.map((time) => <span key={time} className="rounded-md bg-[#e7ebdf] px-2 py-1 text-xs font-medium tabular-nums">{time}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-5 border-t border-[#e2dbce] pt-4">
          <h3 className="text-sm font-semibold">{vi ? "Các lớp sắp tới" : "Upcoming scheduled classes"}</h3>
          <div aria-live="polite" className="mt-2">
            {failed ? <p className="text-sm text-ink-muted">{vi ? "Không thể tải lịch trực tiếp. Vui lòng kiểm tra khi đặt lớp." : "Live schedule could not be loaded. Check availability when booking."}</p> :
              !data ? <p className="text-sm text-ink-muted">{vi ? "Đang tải lịch…" : "Loading schedule…"}</p> :
              data.classes.length === 0 ? <p className="text-sm text-ink-muted">{vi ? "Chưa có lớp sắp tới." : "No upcoming classes are currently listed."}</p> :
              <ul className="divide-y divide-[#e2dbce]">
                {data.classes.map((item, index) => (
                  <li key={item.startsAt + index} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{item.name}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{dateLabel.format(new Date(item.startsAt))} · {timeLabel.format(new Date(item.startsAt))}</p>
                    </div>
                    <button type="button" onClick={() => onBook(studio, dateKey(item.startsAt))} className="shrink-0 rounded-lg border border-[#a9b29e] px-3 py-2 text-xs font-medium hover:bg-[#e7ebdf]">{vi ? "Đặt lớp" : "Book"}</button>
                  </li>
                ))}
              </ul>}
          </div>
          <p className="mt-2 text-xs text-ink-muted">{vi ? "Kiểm tra chỗ trống sau khi đăng nhập." : "Check available spots after signing in."}</p>
        </section>
        <button type="button" onClick={() => onBook(studio)} className="mt-5 min-h-[46px] w-full rounded-lg bg-[#34402c] px-4 py-3 text-sm font-medium text-white hover:bg-[#263222]">{vi ? "Đăng nhập để đặt lớp" : "Log in to book a class"}</button>
      </div>
    </dialog>
  );
}

function StudioPhotography({ vi, onBook }: {
  vi: boolean;
  onBook: (studio: StudioPhoto, date?: string) => void;
}) {
  const [selected, setSelected] = useState<StudioPhoto | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = () => { setSelected(null); requestAnimationFrame(() => trigger.current?.focus()); };

  return (
    <>
      <section
        aria-label={vi ? "Các studio Pilates của chúng tôi" : "Our Pilates studios"}
        className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-1"
      >
        {STUDIO_PHOTOS.map((studio) => (
          <button
            type="button"
            key={studio.slug}
            aria-haspopup="dialog"
            aria-label={studio.name + (vi ? " — Xem lịch" : " — View schedule")}
            onClick={(event) => { trigger.current = event.currentTarget; setSelected(studio); }}
            className="group relative isolate aspect-[4/3] overflow-hidden rounded-xl bg-[#55594b] text-left sm:aspect-[16/9] lg:aspect-[2.15/1] lg:rounded-2xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={studio.image} alt="" className="absolute inset-0 h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105" decoding="async" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 block p-2.5 text-white sm:p-4 lg:p-6">
              <span className="block text-[10px] font-semibold uppercase leading-snug tracking-[0.08em] sm:text-sm lg:text-base">{studio.name}</span>
              <span className="mt-0.5 block text-[10px] leading-snug text-white/95 sm:text-xs lg:text-sm">{studio.address}</span>
              <span className="mt-2 flex items-center justify-between gap-1 text-[10px] font-medium text-white sm:text-xs lg:text-sm">
                {vi ? "Xem lịch" : "View schedule"} <span aria-hidden="true">→</span>
              </span>
            </span>
          </button>
        ))}
      </section>
      {selected && <StudioScheduleDialog key={selected.slug} studio={selected} vi={vi} onClose={close} onBook={(studio, date) => { setSelected(null); onBook(studio, date); }} />}
    </>
  );
}

function LoginForm() {
  const [state, formAction] = useFormState(signInAction, initial);
  const next = useSearchParams().get("next") ?? "";
  const [bookingTarget, setBookingTarget] = useState<string | null>(null);
  const [bookingStudio, setBookingStudio] = useState<string | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  function chooseStudio(studio: StudioPhoto, date?: string) {
    const params = new URLSearchParams({ studio: studio.id });
    if (date) params.set("date", date);
    setBookingTarget("/book?" + params.toString());
    setBookingStudio(studio.name);
    requestAnimationFrame(() => emailInput.current?.focus());
  }
  const { locale } = useLanguage();
  const vi = locale === "vi";

  return (
    <div className="studio-login grid items-center gap-7 lg:grid-cols-[1.15fr_1fr] lg:gap-12 xl:gap-16">
      <StudioPhotography vi={vi} onBook={chooseStudio} />
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
        <input type="hidden" name="next" value={bookingTarget ?? next} />
        {bookingStudio && <p role="status" className="rounded-lg bg-[#e7ebdf] px-3 py-2 text-sm text-[#34402c]">{vi ? "Đăng nhập để đặt lớp tại" : "Sign in to book at"} {bookingStudio}.</p>}

        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            ref={emailInput}
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

      <PreviewRolePicker next={bookingTarget ?? next} />
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
