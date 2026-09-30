import { loadCustomerAnalytics } from "@/lib/customerAnalytics.server";
import {
  CUSTOMER_SEGMENTS,
  segmentMeta,
  type CustomerSegmentKey,
} from "@/lib/customerAnalytics";

export const dynamic = "force-dynamic";

const CAMPAIGN_COPY: Partial<
  Record<CustomerSegmentKey, { subject: string; body: string }>
> = {
  registered_never_booked: {
    subject: "Your first Pilates class is waiting",
    body: "You already have a StudioFlow account. Pick a class that fits your week and use your starter credit to get moving.",
  },
  never_visited: {
    subject: "Ready for your first class?",
    body: "We would love to welcome you in. Choose a class at Hideaway or Downtown and experience Pilates by Recharged.",
  },
  zero_credits: {
    subject: "Ready for your next class?",
    body: "Your current class balance is at zero. Refill your credits and keep your routine going.",
  },
  one_credit: {
    subject: "One class left — keep your momentum",
    body: "You still have one class credit ready to use. Book your next session and consider topping up before your balance reaches zero.",
  },
  expiring_7d: {
    subject: "Your Pilates credits expire soon",
    body: "You have unused credits expiring within the next 7 days. Book your next class now so they do not go unused.",
  },
  inactive_14: {
    subject: "Time for your next session?",
    body: "It has been a little while since your last class. Your next Pilates session can be booked in just a few taps.",
  },
  inactive_30: {
    subject: "We would love to see you back",
    body: "It has been over a month since your last class. Come back to your routine at Hideaway or Downtown.",
  },
  inactive_60: {
    subject: "Come back to Pilates by Recharged",
    body: "It has been a while. If you are ready to restart, we have classes across both studios waiting for you.",
  },
  first_visit_no_package: {
    subject: "Keep building after your first class",
    body: "You completed your first class — the best results come from consistency. Choose a package and keep your progress moving.",
  },
  package_almost_finished: {
    subject: "Your package is almost finished",
    body: "You are down to your last few credits. Renew early so there is no gap in your training routine.",
  },
  private_clients: {
    subject: "Plan your next private session",
    body: "Keep your private Pilates routine consistent. Book your next session or top up your private credits when needed.",
  },
  high_value: {
    subject: "A thank-you from Pilates by Recharged",
    body: "Thank you for being one of our most consistent customers. We appreciate having you as part of Pilates by Recharged.",
  },
};

const AUTOMATIONS: Array<{
  label: string;
  segment: CustomerSegmentKey;
  timing: string;
}> = [
  {
    label: "Starter credit activation",
    segment: "registered_never_booked",
    timing: "24–48h after registration if no booking exists",
  },
  {
    label: "Last credit reminder",
    segment: "one_credit",
    timing: "When usable balance falls to 1",
  },
  {
    label: "Credit expiry reminder",
    segment: "expiring_7d",
    timing: "7 days before unused credits expire",
  },
  {
    label: "First-visit package follow-up",
    segment: "first_visit_no_package",
    timing: "After first attended class if no package was purchased",
  },
  {
    label: "30-day win-back",
    segment: "inactive_30",
    timing: "When last attended visit reaches 30 days",
  },
];

export default async function MarketingPage() {
  const analytics = await loadCustomerAnalytics();

  const counts = new Map<CustomerSegmentKey, number>();
  const emailCounts = new Map<CustomerSegmentKey, number>();
  for (const segment of CUSTOMER_SEGMENTS) {
    counts.set(segment.key, 0);
    emailCounts.set(segment.key, 0);
  }

  for (const row of analytics) {
    for (const key of row.segments) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (row.email) emailCounts.set(key, (emailCounts.get(key) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Marketing opportunities
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Ready-made CRM audiences derived from credits, attendance, spend and
          booking behaviour. Preview does not send emails — use the exports to
          review the audience first.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CUSTOMER_SEGMENTS.map((segment) => (
          <article key={segment.key} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">{segment.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  {segment.description}
                </p>
              </div>
              <span className="text-2xl font-semibold tabular-nums text-ink">
                {counts.get(segment.key) ?? 0}
              </span>
            </div>

            <div className="mt-4 rounded-lg bg-stone-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                Suggested campaign
              </p>
              <p className="mt-1 text-sm text-ink">{segment.campaign}</p>
              {CAMPAIGN_COPY[segment.key] && (
                <>
                  <p className="mt-3 text-xs font-medium text-ink-muted">
                    Subject
                  </p>
                  <p className="mt-1 text-xs text-ink">
                    {CAMPAIGN_COPY[segment.key]!.subject}
                  </p>
                  <p className="mt-3 text-xs font-medium text-ink-muted">
                    Draft message
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                    {CAMPAIGN_COPY[segment.key]!.body}
                  </p>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a
                href={`/admin/customers?segment=${segment.key}`}
                className="btn-secondary"
              >
                View customers
              </a>
              <a
                href={`/admin/customers/export?segment=${segment.key}`}
                className="btn-ghost"
              >
                Export {emailCounts.get(segment.key) ?? 0} emails
              </a>
            </div>
          </article>
        ))}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-stone-200 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Follow-up automations
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Logic is visible for review, but sending is intentionally
                disabled in Preview.
              </p>
            </div>
            <span className="badge bg-amber-50 text-amber-700">
              Preview only · sending disabled
            </span>
          </div>
        </div>

        <ul className="divide-y divide-stone-100">
          {AUTOMATIONS.map((automation) => {
            const meta = segmentMeta(automation.segment)!;
            return (
              <li
                key={automation.label}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {automation.label}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {automation.timing}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    Audience now: {counts.get(automation.segment) ?? 0} ·{" "}
                    {meta.label}
                  </p>
                </div>
                <span className="text-xs font-medium text-ink-soft">Disabled</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Campaign safety</h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          CSV exports include each customer&apos;s marketing opt-in field so staff
          can review consent before promotional sends. Transactional booking and
          credit-expiry emails remain separate from promotional campaigns.
        </p>
      </section>
    </div>
  );
}
