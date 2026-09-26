type EmailProvider =
  | { kind: "resend"; apiKey: string; from: string }
  | { kind: "postmark"; apiKey: string; from: string }
  | { kind: "sendgrid"; apiKey: string; from: string };

export type OutgoingEmail = {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
};

export function configuredEmailProvider(): EmailProvider | null {
  const from =
    process.env.BOOKING_EMAIL_FROM ??
    process.env.RESEND_FROM_EMAIL ??
    process.env.POSTMARK_FROM_EMAIL ??
    process.env.SENDGRID_FROM_EMAIL ??
    process.env.EMAIL_FROM ??
    process.env.CREDIT_EXPIRY_EMAIL_FROM;

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

export async function sendEmail(
  provider: EmailProvider,
  message: OutgoingEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];

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
          to: recipients,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `Resend: ${response.status} ${await response.text()}`,
        };
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
          To: recipients.join(","),
          Subject: message.subject,
          TextBody: message.text,
          HtmlBody: message.html,
          MessageStream: "outbound",
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `Postmark: ${response.status} ${await response.text()}`,
        };
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
        personalizations: [
          { to: recipients.map((email) => ({ email })) },
        ],
        from: { email: extractEmail(provider.from) },
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `SendGrid: ${response.status} ${await response.text()}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown email error",
    };
  }
}

export function escapeHtml(value: string): string {
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

function extractEmail(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}
