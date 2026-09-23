import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const DISCOVERY_BATCH = 100;
const EMAIL_BATCH = 40;

type DuePurchase = {
  id: string;
  customer_id: string;
  expires_at: string;
};

type NotificationRow = {
  purchase_ledger_id: string;
  customer_id: string;
  expires_at: string;
  expired_credits: number;
  status: string;
  attempts: number;
};

type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  profile: { full_name: string | null; email: string | null } | null;
};

type PurchaseRow = {
  id: string;
  pool: string | null;
  package: { name: string } | null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("email-health") === "1") {
    return NextResponse.json({
      provider: emailProvider()?.kind ?? null,
      configured: Boolean(emailProvider()),
    });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const now = new Date().toISOString();

  // Find newly expired package grants. Legacy expiries were marked as skipped
  // by the migration, so this only creates work for expiries after rollout.
  const { data: dueData, error: dueError } = await service
    .from("credit_ledger")
    .select("id,customer_id,expires_at")
    .eq("reason", "purchase")
    .gt("delta", 0)
    .not("expires_at", "is", null)
    .lte("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(DISCOVERY_BATCH);

  if (dueError) {
    return NextResponse.json({ error: dueError.message }, { status: 500 });
  }

  const due = (dueData ?? []) as DuePurchase[];
  const dueIds = due.map((row) => row.id);
  const tracked = new Set<string>();

  if (dueIds.length > 0) {
    const { data: trackedRows, error: trackedError } = await service
      .from("credit_expiry_notifications")
      .select("purchase_ledger_id")
      .in("purchase_ledger_id", dueIds);

    if (trackedError) {
      return NextResponse.json({ error: trackedError.message }, { status: 500 });
    }

    for (const row of trackedRows ?? []) {
      tracked.add((row as { purchase_ledger_id: string }).purchase_ledger_id);
    }
  }

  let prepared = 0;
  let noBalance = 0;

  for (const purchase of due) {
    if (tracked.has(purchase.id)) continue;

    const { data: remainingData, error: remainingError } = await service.rpc(
      "credit_grant_remaining_at",
      {
        p_grant: purchase.id,
        p_at: purchase.expires_at,
      },
    );

    if (remainingError) {
      console.error("credit expiry remaining lookup failed", {
        purchase: purchase.id,
        error: remainingError.message,
      });
      continue;
    }

    const remaining =
      typeof remainingData === "number" ? Math.max(0, remainingData) : 0;
    const status = remaining > 0 ? "pending" : "no_balance";

    const { error: insertError } = await service
      .from("credit_expiry_notifications")
      .insert({
        purchase_ledger_id: purchase.id,
        customer_id: purchase.customer_id,
        expires_at: purchase.expires_at,
        expired_credits: remaining,
        status,
        notified_at: remaining > 0 ? null : now,
      });

    if (insertError) {
      // A concurrent cron may have inserted the same primary key first.
      if (insertError.code !== "23505") {
        console.error("credit expiry queue insert failed", {
          purchase: purchase.id,
          error: insertError.message,
        });
      }
      continue;
    }

    prepared += 1;
    if (remaining === 0) noBalance += 1;
  }

  const { data: pendingData, error: pendingError } = await service
    .from("credit_expiry_notifications")
    .select(
      "purchase_ledger_id,customer_id,expires_at,expired_credits,status,attempts",
    )
    .in("status", ["pending", "failed"])
    .gt("expired_credits", 0)
    .order("expires_at", { ascending: true })
    .limit(EMAIL_BATCH);

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  const pending = (pendingData ?? []) as NotificationRow[];

  if (pending.length === 0) {
    return NextResponse.json({
      discovered: due.length,
      prepared,
      noBalance,
      emailed: 0,
      noEmail: 0,
      failed: 0,
      remaining: 0,
    });
  }

  const provider = emailProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "Expiry notifications are queued, but no supported email provider is configured.",
        queued: pending.length,
        supported:
          "RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SENDGRID_API_KEY plus a sender address",
      },
      { status: 503 },
    );
  }

  const customerIds = Array.from(new Set(pending.map((row) => row.customer_id)));
  const purchaseIds = pending.map((row) => row.purchase_ledger_id);

  const [{ data: customerData, error: customerError }, { data: purchaseData, error: purchaseError }] =
    await Promise.all([
      service
        .from("customers")
        .select("id,name,email,profile:profiles(full_name,email)")
        .in("id", customerIds),
      service
        .from("credit_ledger")
        .select("id,pool,package:packages(name)")
        .in("id", purchaseIds),
    ]);

  if (customerError || purchaseError) {
    return NextResponse.json(
      { error: customerError?.message ?? purchaseError?.message },
      { status: 500 },
    );
  }

  const customers = new Map(
    ((customerData ?? []) as unknown as CustomerRow[]).map((row) => [row.id, row]),
  );
  const purchases = new Map(
    ((purchaseData ?? []) as unknown as PurchaseRow[]).map((row) => [row.id, row]),
  );

  let emailed = 0;
  let noEmailCount = 0;
  let failed = 0;

  for (const item of pending) {
    const customer = customers.get(item.customer_id);
    const purchase = purchases.get(item.purchase_ledger_id);
    const email = customer?.profile?.email ?? customer?.email ?? null;
    const name =
      customer?.profile?.full_name?.trim() ||
      customer?.name?.trim() ||
      "there";
    const packageName = purchase?.package?.name ?? "class package";

    if (!email) {
      noEmailCount += 1;
      await service
        .from("credit_expiry_notifications")
        .update({
          status: "no_email",
          attempts: item.attempts + 1,
          notified_at: now,
          last_error: "Customer has no email address.",
        })
        .eq("purchase_ledger_id", item.purchase_ledger_id);
      continue;
    }

    const expiryDate = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(item.expires_at));

    const credits = item.expired_credits;
    const subject = `${packageName}: unused credits expired`;
    const text = [
      `Hi ${name},`,
      "",
      `Your ${packageName} reached its expiry date on ${expiryDate}.`,
      `${credits} unused credit${credits === 1 ? "" : "s"} ${credits === 1 ? "has" : "have"} expired and ${credits === 1 ? "is" : "are"} no longer available in your account.`,
      "",
      "If you have any questions, please reply to this email.",
      "",
      "— Your Pilates studio team",
      "",
      "-----",
      "",
      `Xin chào ${name},`,
      "",
      `Gói ${packageName} của bạn đã hết hạn vào ngày ${expiryDate}.`,
      `${credits} lượt tập chưa sử dụng đã hết hạn và không còn khả dụng trong tài khoản của bạn.`,
      "",
      "Nếu bạn có câu hỏi, vui lòng trả lời email này.",
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#292524;max-width:600px">
        <p>Hi ${escapeHtml(name)},</p>
        <p>Your <strong>${escapeHtml(packageName)}</strong> reached its expiry date on <strong>${escapeHtml(expiryDate)}</strong>.</p>
        <p><strong>${credits} unused credit${credits === 1 ? "" : "s"}</strong> ${credits === 1 ? "has" : "have"} expired and ${credits === 1 ? "is" : "are"} no longer available in your account.</p>
        <p>If you have any questions, please reply to this email.</p>
        <p>— Your Pilates studio team</p>
        <hr style="border:0;border-top:1px solid #e7e5e4;margin:24px 0" />
        <p>Xin chào ${escapeHtml(name)},</p>
        <p>Gói <strong>${escapeHtml(packageName)}</strong> của bạn đã hết hạn vào ngày <strong>${escapeHtml(expiryDate)}</strong>.</p>
        <p><strong>${credits} lượt tập chưa sử dụng</strong> đã hết hạn và không còn khả dụng trong tài khoản của bạn.</p>
        <p>Nếu bạn có câu hỏi, vui lòng trả lời email này.</p>
      </div>
    `;

    const sent = await sendEmail(provider, {
      to: email,
      subject,
      text,
      html,
    });

    if (sent.ok) {
      emailed += 1;
      await service
        .from("credit_expiry_notifications")
        .update({
          status: "sent",
          email,
          attempts: item.attempts + 1,
          notified_at: now,
          last_error: null,
        })
        .eq("purchase_ledger_id", item.purchase_ledger_id);
    } else {
      failed += 1;
      await service
        .from("credit_expiry_notifications")
        .update({
          status: "failed",
          email,
          attempts: item.attempts + 1,
          last_error: sent.error.slice(0, 1000),
        })
        .eq("purchase_ledger_id", item.purchase_ledger_id);
    }
  }

  const { count: remaining } = await service
    .from("credit_expiry_notifications")
    .select("purchase_ledger_id", { count: "exact", head: true })
    .in("status", ["pending", "failed"])
    .gt("expired_credits", 0);

  return NextResponse.json({
    discovered: due.length,
    prepared,
    noBalance,
    emailed,
    noEmail: noEmailCount,
    failed,
    remaining: remaining ?? 0,
    provider: provider.kind,
  });
}

type EmailProvider =
  | { kind: "resend"; apiKey: string; from: string }
  | { kind: "postmark"; apiKey: string; from: string }
  | { kind: "sendgrid"; apiKey: string; from: string };

function emailProvider(): EmailProvider | null {
  const from =
    process.env.CREDIT_EXPIRY_EMAIL_FROM ??
    process.env.RESEND_FROM_EMAIL ??
    process.env.POSTMARK_FROM_EMAIL ??
    process.env.SENDGRID_FROM_EMAIL ??
    process.env.EMAIL_FROM;

  if (!from) return null;
  if (process.env.RESEND_API_KEY) {
    return { kind: "resend", apiKey: process.env.RESEND_API_KEY, from };
  }
  if (process.env.POSTMARK_SERVER_TOKEN) {
    return {
      kind: "postmark",
      apiKey: process.env.POSTMARK_SERVER_TOKEN,
      from,
    };
  }
  if (process.env.SENDGRID_API_KEY) {
    return {
      kind: "sendgrid",
      apiKey: process.env.SENDGRID_API_KEY,
      from,
    };
  }
  return null;
}

async function sendEmail(
  provider: EmailProvider,
  message: { to: string; subject: string; text: string; html: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (provider.kind === "resend") {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: provider.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) {
        return { ok: false, error: `Resend: ${response.status} ${await response.text()}` };
      }
      return { ok: true };
    }

    if (provider.kind === "postmark") {
      const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": provider.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          From: provider.from,
          To: message.to,
          Subject: message.subject,
          TextBody: message.text,
          HtmlBody: message.html,
          MessageStream: "outbound",
        }),
      });
      if (!response.ok) {
        return { ok: false, error: `Postmark: ${response.status} ${await response.text()}` };
      }
      return { ok: true };
    }

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: extractEmail(provider.from) },
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
    });
    if (!response.ok) {
      return { ok: false, error: `SendGrid: ${response.status} ${await response.text()}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown email error",
    };
  }
}

function extractEmail(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char] ?? char,
  );
}
