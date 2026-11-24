"use client";

// ============================================================================
// Interactive consumer landing for the Recharged Da Nang studios. The location
// toggle re-themes the page accent and swaps in that studio's real "today"
// schedule (passed in from the server). The pricing schedule is interactive
// (select a package to see the per-class price and savings). Motion follows
// emil-design-eng: custom ease-out curves, transform/opacity only, press +
// hover-lift, and reduced-motion fallbacks (utilities live in globals.css).
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { STUDIO_PHOTOS } from "./(auth)/studio-photos";
import { WEEKLY_STUDIO_SCHEDULE } from "@/lib/studioSchedule";
import "./landing-design.css";
import Link from "next/link";
import {
  LanguageSwitcher,
  useLanguage,
} from "@/components/LanguageProvider";

export type LandingClass = {
  name: string;
  description: string;
  credits: number;
  color: string;
  time: string;
  booked: number;
  capacity: number;
};

export type LandingStudio = {
  key: string;
  name: string;
  short: string;
  address: string;
  accent: string; // hex, drives the --accent custom property
  blurb: string;
  classes: LandingClass[];
  scheduleLabel: string; // the day the shown lineup is for, e.g. "Fri 26 Jun"
  weekdayTimes: string[];
  weekendTimes: string[];
};

type Pkg = {
  name: string;
  credits: number;
  price: number; // VND
  validity: number; // days
  note?: string;
  highlight?: boolean;
};

const PACKAGES: Pkg[] = [
  { name: "Single Class", credits: 1, price: 400_000, validity: 30 },
  { name: "5 Class Pack", credits: 5, price: 1_700_000, validity: 90 },
  {
    name: "10 Class Pack",
    credits: 10,
    price: 3_200_000,
    validity: 120,
    note: "Best value for regulars",
    highlight: true,
  },
  { name: "20 Class Pack", credits: 20, price: 5_600_000, validity: 180 },
];

const SINGLE_PER_CLASS = 400_000;
const vnd = (n: number) => `${n.toLocaleString("vi-VN")} ₫`;

export default function LandingExperience({
  studios,
}: {
  studios: LandingStudio[];
}) {
  const publicStudios = STUDIO_PHOTOS.map((photo) => {
    const existing = studios.find((s) => s.key === photo.slug);
    const weekly = WEEKLY_STUDIO_SCHEDULE[photo.slug];
    return {
      ...(existing ?? { key: photo.slug, accent: "#344332", blurb: "Small-group reformer Pilates with hands-on coaching. Book a mat, move with intention, leave recharged.", classes: [], scheduleLabel: "", weekdayTimes: weekly.weekdayTimes, weekendTimes: weekly.weekendTimes }),
      name: photo.name, short: photo.name, address: photo.address,
      image: photo.image, id: photo.id,
    };
  });
  const [studioKey, setStudioKey] = useState<string>(publicStudios[0].key);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const photoTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !scheduleOpen) return;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previous; };
  }, [scheduleOpen]);
  function closeSchedule() {
    setScheduleOpen(false);
    requestAnimationFrame(() => photoTrigger.current?.focus());
  }
  const [selected, setSelected] = useState<number>(2); // default: 10 Class Pack
  const { locale } = useLanguage();
  const vi = locale === "vi";

  const studio = publicStudios.find((s) => s.key === studioKey) ?? publicStudios[0];
  const pkg = PACKAGES[selected];
  const perClass = Math.round(pkg.price / pkg.credits);
  const savedPerClass = SINGLE_PER_CLASS - perClass;
  const savedTotal = savedPerClass * pkg.credits;
  const savedPct = Math.round((savedPerClass / SINGLE_PER_CLASS) * 100);

  const accent = "#344332";
  const bookingHref = "/login?next=" + encodeURIComponent("/book?studio=" + studio.id);
  const packageName = (p: Pkg) => {
    if (!vi) return p.name;
    if (p.credits === 1) return "Lớp lẻ";
    return `Gói ${p.credits} lớp`;
  };

  return (
    <main
      className="sf-landing min-h-screen"
      style={{ ["--accent" as string]: accent }}
    >
      <header className="sf-landing-header">
        <div className="sf-landing-brand">
          <span className="sf-landing-wordmark">Studio<span>Flow</span></span>
          <span className="sf-landing-brand-sub">PILATES BY RECHARGED</span>
        </div>
        <nav className="sf-landing-nav">
          <LanguageSwitcher />
          <Link href="/login" className="sf-landing-nav-login">{vi ? "Đăng nhập" : "Log in"}</Link>
          <Link href="/book" className="sf-landing-primary sf-landing-nav-book">{vi ? "Đặt lớp" : "Book a class"}</Link>
        </nav>
      </header>

      <section className="sf-landing-hero">
        <div className="sf-landing-intro">
          <p className="sf-landing-eyebrow">{vi ? "PILATES REFORMER · ĐÀ NẴNG" : "REFORMER PILATES · DA NANG"}</p>
          <h1>{vi ? "Chuyển động có chủ đích." : "Move with intention."}<br />{vi ? "Rời lớp với năng lượng mới." : "Leave recharged."}</h1>
          <p className="sf-landing-description">
            {vi ? "Pilates reformer nhóm nhỏ với hướng dẫn tận tình. Đặt lớp, tập có chủ đích và rời studio với năng lượng mới." : studio.blurb}
          </p>
          <div className="sf-landing-actions">
            <Link href="/book" className="sf-landing-primary">{vi ? "Đặt lớp đầu tiên" : "Book your first class"}</Link>
            <Link href="/login" className="sf-landing-secondary">{vi ? "Tôi đã có tài khoản" : "I have an account"}</Link>
          </div>
        </div>
        <div className="sf-landing-photos" aria-label={vi ? "Chọn studio để xem lịch" : "Choose a studio to view its schedule"}>
          {publicStudios.map((s) => (
            <button key={s.key} type="button" className="sf-landing-photo" aria-haspopup="dialog"
              aria-label={s.name + (vi ? " — Xem lịch" : " — View schedule")}
              onClick={(event) => { photoTrigger.current = event.currentTarget; setStudioKey(s.key); setScheduleOpen(true); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image} alt="" decoding="async" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
              <span className="sf-landing-photo-shade" aria-hidden="true" />
              <span className="sf-landing-photo-caption">
                <span className="sf-landing-photo-name">{s.name}</span>
                <span className="sf-landing-photo-address">{s.address}</span>
                <span className="sf-landing-photo-action">{vi ? "Xem lịch" : "View schedule"} <span aria-hidden="true">→</span></span>
              </span>
            </button>
          ))}
        </div>
        <div className="sf-landing-notice">
          <p className="sf-landing-notice-title">
            {vi ? "Đặt trước, thanh toán sau buổi tập" : "Reserve now, pay after class"}
          </p>
          <p className="sf-landing-notice-copy">
            {vi
              ? "Khi tạo tài khoản, bạn sẽ thấy 1 tín dụng khởi đầu để giữ chỗ cho lớp thường đầu tiên. Đây là tín dụng đặt chỗ, không phải lớp miễn phí. Nếu chưa mua gói trả phí, bạn thanh toán tại studio sau buổi tập. Lớp lẻ thường: 400.000 ₫."
              : "When you create an account, you’ll see 1 starter credit so you can reserve your first regular class. It is a booking credit, not a free class. If you haven’t purchased a paid package, you pay at the studio after class. Single regular class: 400,000 VND."}
          </p>
        </div>

      </section>

      <dialog ref={dialogRef} className="sf-landing-dialog" aria-labelledby="sf-schedule-title"
        onCancel={(event) => { event.preventDefault(); closeSchedule(); }}
        onClick={(event) => { if (event.target === event.currentTarget) closeSchedule(); }}>
        {scheduleOpen && <div className="sf-landing-dialog-inner">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="sf-landing-eyebrow">{vi ? "LỊCH TẬP PILATES" : "PILATES SCHEDULE"}</p>
              <h2 id="sf-schedule-title" className="sf-landing-section-title">{studio.name}</h2>
              <p className="mt-1 text-sm text-ink-muted">{studio.address}</p>
            </div>
            <button type="button" autoFocus onClick={closeSchedule} aria-label={vi ? "Đóng" : "Close"} className="sf-landing-close">×</button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {[{label: vi ? "Thứ 2 – Thứ 6" : "Monday – Friday", times: studio.weekdayTimes}, {label: vi ? "Thứ 7 – Chủ nhật" : "Saturday – Sunday", times: studio.weekendTimes}].map((group) => (
              <div key={group.label} className="sf-landing-timetable">
                <p className="text-xs font-semibold">{group.label}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{group.times.map(time => <span key={time} className="sf-landing-time">{time}</span>)}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">{vi ? "Giờ thường lệ · giờ Đà Nẵng · có thể thay đổi" : "Regular times · Da Nang time · subject to change"}</p>
          <div className="mt-5 border-t border-[#dedbd1] pt-4">
            <h3 className="text-sm font-semibold">{vi ? "Lớp sắp tới" : "Next classes"}{studio.scheduleLabel && " · " + studio.scheduleLabel}</h3>
            {studio.classes.length > 0 ? <ul className="mt-2 divide-y divide-[#dedbd1]">
              {studio.classes.map((item, i) => <li key={item.time + i} className="flex items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{item.name}</p><p className="text-xs text-ink-muted">{item.time} · {vi ? "Tín dụng" : "Credits"}: {item.credits}</p></div><span className="text-xs text-ink-muted">{item.booked}/{item.capacity} {vi ? "đã đặt" : "booked"}</span></li>)}
            </ul> : <p className="mt-3 text-sm text-ink-muted">{vi ? "Lịch lớp sẽ sớm được cập nhật." : "Schedule coming soon — check back shortly."}</p>}
          </div>
          <Link href={bookingHref} className="sf-landing-primary mt-5 w-full">{vi ? "Đăng nhập để đặt lớp" : "Log in to book a class"}</Link>
        </div>}
      </dialog>

      {/* Classes ---------------------------------------------------------- */}
      <section className="sf-landing-section">
        <div className="sf-landing-section-header">
          <div>
            <h2 className="sf-landing-section-title">
              {vi ? "Lịch lớp" : "Weekly schedule"} · {studio?.short}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {vi ? "Lịch cố định hàng tuần" : "Current recurring timetable"}
            </p>
          </div>
          <div className="sf-landing-schedule-switch">
            {publicStudios.map(s => <button key={s.key} type="button" aria-pressed={s.key === studioKey} onClick={() => setStudioKey(s.key)}>{s.name.replace(" Pilates", "")}</button>)}
          </div>
          <span className="text-xs text-ink-muted">{vi ? "50 phút · tối đa 4 người" : "50 min · max 4 people"}</span>
        </div>

        {studio &&
          (studio.weekdayTimes.length > 0 || studio.weekendTimes.length > 0) && (
            <div className="mb-6 grid gap-3 sm:grid-cols-2">
              <div className="sf-landing-timetable">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  {vi ? "Thứ 2 – Thứ 6" : "Monday – Friday"}
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {studio.weekdayTimes.join(" · ")}
                </p>
              </div>
              <div className="sf-landing-timetable">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  {vi ? "Thứ 7 – Chủ nhật" : "Saturday – Sunday"}
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {studio.weekendTimes.join(" · ")}
                </p>
              </div>
            </div>
          )}

        {studio?.scheduleLabel && (
          <p className="mb-3 text-sm font-medium text-ink-muted">
            {vi ? "Lớp sắp tới" : "Next classes"} · {studio.scheduleLabel}
          </p>
        )}

        {studio && studio.classes.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {studio.classes.map((c) => (
              <article
                key={`${c.name}-${c.time}`}
                className="sf-landing-class"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: c.color }}
                    aria-hidden
                  >
                    {c.name.charAt(0)}
                  </span>
                  <span className="text-xs font-medium text-ink-soft">
                    {c.time}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-ink">{c.name}</h3>
                {c.description && (
                  <p className="mt-1.5 text-sm text-ink-muted">
                    {c.description}
                  </p>
                )}
                <p className="mt-3 text-xs font-medium text-ink-soft">
                  {vi
                    ? `${c.booked}/${c.capacity} đã đặt · ${c.credits} tín dụng`
                    : `${c.booked} booked out of ${c.capacity} · ${c.credits} credit${c.credits > 1 ? "s" : ""}`}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="sf-landing-class px-5 py-12 text-center text-sm text-ink-muted">
            {vi ? "Lịch lớp sẽ sớm được cập nhật." : "Schedule coming soon — check back shortly."}
          </div>
        )}
      </section>

      {/* Pricing ---------------------------------------------------------- */}
      <section className="sf-landing-section sf-landing-pricing">
        <div className="mb-6 text-center">
          <h2 className="sf-landing-section-title">
            {vi ? "Gói lớp" : "Class packages"}
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            {vi
              ? "Một hệ thống tín dụng dùng tại cả hai studio. Chọn gói để so sánh."
              : "One set of credits, valid at both studios. Tap a pack to compare."}
          </p>
        </div>

        <div className="sf-landing-packages">
          {PACKAGES.map((p, i) => {
            const active = i === selected;
            const each = Math.round(p.price / p.credits);
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => setSelected(i)}
                aria-pressed={active}
                className={`sf-landing-package relative border text-left ${
                  active
                    ? "shadow-card"
                    : "border-stone-200 hover:border-stone-300"
                }`}
                style={
                  active
                    ? {
                        borderColor: accent,
                        boxShadow: `0 0 0 1px ${accent}`,
                      }
                    : undefined
                }
              >
                {p.highlight && (
                  <span
                    className="absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                    style={{ backgroundColor: accent }}
                  >
                    {vi ? "Phổ biến" : "Popular"}
                  </span>
                )}
                <h3 className="text-sm font-semibold text-ink">{packageName(p)}</h3>
                <p className="mt-2 font-serif text-xl tracking-tight text-ink sm:text-2xl">
                  {vnd(p.price)}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {vi
                    ? `${vnd(each)} / lớp · ${p.credits} tín dụng`
                    : `${vnd(each)} / class · ${p.credits} credit${p.credits > 1 ? "s" : ""}`}
                </p>
                <p className="mt-3 text-xs text-ink-soft">
                  {vi ? `Có hiệu lực ${p.validity} ngày` : `Valid ${p.validity} days`}
                </p>
              </button>
            );
          })}
        </div>

        {/* Selected summary */}
        <div
          key={`${selected}-${studio?.key}`}
          className="sf-landing-summary mt-6 flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center"
        >
          <div>
            <p className="text-sm font-medium text-ink">
              {packageName(pkg)} — {vnd(pkg.price)}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {vi ? `${vnd(perClass)} mỗi lớp` : `${vnd(perClass)} per class`}
              {savedTotal > 0 ? (
                <>
                  {" · "}
                  <span className="font-medium" style={{ color: accent }}>
                    {vi ? "tiết kiệm" : "save"} {vnd(savedTotal)} ({savedPct}%)
                  </span>{" "}
                  {vi ? "so với lớp lẻ" : "vs single classes"}
                </>
              ) : (
                vi ? " · trả theo từng lớp" : " · pay as you go"
              )}
            </p>
          </div>
          <Link
            href="/book"
            className="sf-landing-primary shrink-0"
          >
            {vi
              ? `Mua ${pkg.credits} tín dụng`
              : `Get ${pkg.credits} credit${pkg.credits > 1 ? "s" : ""}`}
          </Link>
        </div>
      </section>
    </main>
  );
}
