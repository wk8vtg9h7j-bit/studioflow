// ============================================================================
// One-time gate for members whose account came from a Google sign-in.
//
// Deliberately NOT inside the (customer) route group: that layout is what
// redirects people here, so a page living under it would redirect to itself.
// ============================================================================
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { completeProfileAction } from "./actions";

export const dynamic = "force-dynamic";

const STUDIOS: { slug: string; label: string }[] = [
  { slug: "downtown-pilates", label: "Downtown Pilates" },
  { slug: "hideaway-pilates", label: "Hideaway Pilates" },
  { slug: "an-thuong-pilates", label: "An Thuong — Private Coaching" },
];

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [profile, locale, params] = await Promise.all([
    requireRole("customer", "/complete-profile"),
    getLocale(),
    searchParams,
  ]);
  const vi = locale === "vi";

  // Nothing to collect — don't strand anyone on a pointless form.
  if (profile.phone) redirect("/home");

  const status = params.status;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <div className="card p-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {vi ? "Hoàn tất tài khoản" : "Finish setting up"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {vi
            ? `Xin chào ${profile.full_name ?? ""}. Chúng tôi cần số điện thoại để liên hệ với bạn về lớp học.`
            : `Welcome${profile.full_name ? `, ${profile.full_name}` : ""}. We need a phone number so the studio can reach you about your classes.`}
        </p>

        {status === "invalid" ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {vi
              ? "Vui lòng nhập số điện thoại hợp lệ."
              : "Please enter a valid phone number."}
          </p>
        ) : null}
        {status === "error" ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {vi
              ? "Không thể lưu. Vui lòng thử lại."
              : "We couldn't save that. Please try again."}
          </p>
        ) : null}

        <form action={completeProfileAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="phone" className="label">
              {vi ? "Số điện thoại" : "Phone number"}
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              className="input"
              placeholder="+84 90 123 4567"
            />
          </div>

          <div>
            <label htmlFor="studio_slug" className="label">
              {vi ? "Studio bạn hay tập (tuỳ chọn)" : "Your usual studio (optional)"}
            </label>
            <select id="studio_slug" name="studio_slug" className="input" defaultValue="">
              <option value="">
                {vi ? "Chọn sau" : "Choose later"}
              </option>
              {STUDIOS.map((studio) => (
                <option key={studio.slug} value={studio.slug}>
                  {studio.label}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-primary w-full">
            {vi ? "Tiếp tục" : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
