"use client";

// ============================================================================
// A single bookable class in the customer browse list. Presentational: it shows
// when/where the class is, what it's about, how many seats are left, what it
// costs in credits, and a book button wired to the bookSessionAction. If the
// member already has a booking we show their status instead of the button, and
// when the class is full the button becomes a "Join waitlist" call to action —
// unless reception has held the class full, in which case there is no queue.
//
// The layout is phone-first: everything stacks into one readable column and
// nothing is truncated, because members need to actually read the time and the
// description before they spend a credit. The seat/price summary and the action
// share a row from `sm` up, where there's width for it.
// ============================================================================
import { useRef, useState } from "react";
import type { SessionWithRelations } from "@/lib/types";
import { formatSessionDate, formatSessionTimeRange } from "@/lib/format";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { bookSessionAction } from "./actions";
import type { Locale } from "@/lib/locale";

type Props = {
  session: SessionWithRelations;
  booked: number;
  myStatus: "booked" | "waitlisted" | null;
  locale: Locale;
  requiresPaymentNotice: boolean;
};

export function BookSessionRow({
  session,
  booked,
  myStatus,
  locale,
  requiresPaymentNotice,
}: Props) {
  const vi = locale === "vi";
  const [showPaymentNotice, setShowPaymentNotice] = useState(false);
  const pendingFormRef = useRef<HTMLFormElement | null>(null);
  const acknowledgementRef = useRef<HTMLInputElement | null>(null);
  const capacity = session.capacity ?? 0;
  const available = Math.max(0, capacity - booked);
  const isFull = available <= 0;
  // A class held full by reception has no queue to join — book_session refuses
  // the booking outright rather than waitlisting it — so don't offer one.
  const heldFull = isFull && (session.filler_seats ?? 0) > 0;
  const cost = session.class_type?.credits_cost ?? 1;
  const accent = session.class_type?.color ?? "#7c3aed";
  const tz = session.studio?.timezone;
  const isPrivate = session.class_type?.pool === "private";
  const description = session.class_type?.description;
  const where = [session.studio?.name, session.instructor?.display_name]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="card overflow-hidden">
      {/* The class-type colour reads as a top stripe so the title never has to
          share horizontal space with it on a narrow screen. */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold leading-snug text-ink">
            {session.title || session.class_type?.name || "Class"}
          </h3>
          {isPrivate && (
            <span className="badge bg-brand-50 text-brand-700">{vi ? "Riêng" : "Private"}</span>
          )}
          {myStatus && (
            <span
              className={`badge ${
                myStatus === "booked"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {myStatus === "booked" ? (vi ? "Đã đặt" : "Booked") : (vi ? "Danh sách chờ" : "Waitlisted")}
            </span>
          )}
        </div>

        <div className="space-y-0.5 text-sm text-ink-muted">
          <p className="font-medium text-ink">
            {formatSessionDate(session.starts_at, tz)}
          </p>
          <p>{formatSessionTimeRange(session.starts_at, session.ends_at, tz)}</p>
          {where && <p className="break-words">{where}</p>}
        </div>

        {description && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <p className="text-sm">
            <span className="font-semibold text-ink">
              {vi ? `${booked}/${capacity} đã đặt` : `${booked} booked out of ${capacity}`}
            </span>
            <span className="text-ink-muted">
              {" · "}
              {vi
                ? `${cost} tín dụng${isPrivate ? " riêng" : ""} / chỗ`
                : `${cost} ${isPrivate ? "private " : ""}credit${cost === 1 ? "" : "s"} per spot`}
            </span>
          </p>

          <div className="w-full sm:w-40">
            {myStatus ? (
              <p className="text-sm text-ink-muted sm:text-right">
                {vi
                  ? myStatus === "booked"
                    ? "Bạn đã có chỗ"
                    : "Bạn đang trong danh sách chờ"
                  : <>You&apos;re {myStatus === "booked" ? "in" : "on the list"}</>}
              </p>
            ) : (
              <form
                action={bookSessionAction}
                className="space-y-2"
                onSubmit={(event) => {
                  if (!requiresPaymentNotice) return;
                  if (acknowledgementRef.current?.value === "yes") return;
                  event.preventDefault();
                  pendingFormRef.current = event.currentTarget;
                  setShowPaymentNotice(true);
                }}
              >
                <input type="hidden" name="session_id" value={session.id} />
                <input
                  ref={acknowledgementRef}
                  type="hidden"
                  name="payment_acknowledged"
                  value="no"
                />
                <label className="block text-xs font-medium text-ink-muted">
                  {vi ? "Số chỗ" : "Spots"}
                  <select
                    name="spots"
                    className="input mt-1"
                    defaultValue="1"
                    disabled={heldFull}
                  >
                    <option value="1">{vi ? "1 chỗ" : "1 spot"}</option>
                    {(isFull || available >= 2) && (
                      <option value="2">{vi ? "2 chỗ" : "2 spots"}</option>
                    )}
                  </select>
                </label>
                <SubmitButton disabled={heldFull}>
                  {heldFull
                    ? vi ? "Đã đầy" : "Full"
                    : isFull
                      ? vi ? "Vào danh sách chờ" : "Join waitlist"
                      : vi ? "Đặt lớp" : "Book"}
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
      </div>

      {showPaymentNotice && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`payment-notice-${session.id}`}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2
              id={`payment-notice-${session.id}`}
              className="text-lg font-semibold text-ink"
            >
              {vi ? "Trước khi đặt lớp đầu tiên" : "Before your first booking"}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-muted">
              <p>
                {vi
                  ? "Tài khoản của bạn có 1 tín dụng khởi đầu để bạn có thể giữ chỗ cho lớp thường đầu tiên. Tín dụng này không có nghĩa là lớp học miễn phí."
                  : "Your account starts with 1 booking credit so you can reserve your first regular class. This credit does not mean the class is free."}
              </p>
              <p>
                {vi
                  ? "Nếu bạn chưa mua gói trả phí, bạn sẽ thanh toán phí lớp tại studio sau buổi tập. Giá lớp lẻ thường hiện tại là 400.000 ₫."
                  : "If you have not purchased a paid package, the class fee is paid at the studio after class. The current single regular class price is 400,000 VND."}
              </p>
              <p className="font-medium text-ink">
                {vi
                  ? "Tiếp tục nghĩa là bạn xác nhận đây là một lượt đặt lớp có tính phí."
                  : "By continuing, you confirm that this is a paid class booking."}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  pendingFormRef.current = null;
                  setShowPaymentNotice(false);
                }}
              >
                {vi ? "Quay lại" : "Go back"}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (acknowledgementRef.current) {
                    acknowledgementRef.current.value = "yes";
                  }
                  setShowPaymentNotice(false);
                  pendingFormRef.current?.requestSubmit();
                }}
              >
                {vi ? "Tôi hiểu · Đặt lớp" : "I understand · Book"}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
