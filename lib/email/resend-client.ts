type SendEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
};

type SendEmailResult = {
  sent: boolean;
  reason?: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendResendEmail(
  params: SendEmailParams
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    console.info("[resend] not configured; skipping email", {
      subject: params.subject,
    });
    return { sent: false, reason: "not_configured" };
  }

  const recipients = Array.isArray(params.to) ? params.to : [params.to];
  if (recipients.length === 0) {
    return { sent: false, reason: "no_recipients" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipients,
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }

  return { sent: true };
}
