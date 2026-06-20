import { createAdminClient } from "@/lib/supabase/admin";

type PaymentLockedInPayload = {
  orgId: string;
  leadId: string;
  leadName: string;
  businessName: string;
  amountPaidCents: number;
  stripeIntentId: string;
};

export async function notifyBusinessOwnerOfDeposit(
  payload: PaymentLockedInPayload
): Promise<void> {
  const admin = createAdminClient();

  const { data: owners, error: ownersError } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("org_id", payload.orgId)
    .eq("role", "owner");

  if (ownersError) {
    throw new Error(`Failed to load org owners: ${ownersError.message}`);
  }

  const ownerUserIds = (owners ?? []).map((row) => row.user_id as string);
  if (ownerUserIds.length === 0) {
    return;
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    console.info("[notify-owner] RESEND not configured; skipping email alert", {
      orgId: payload.orgId,
      leadId: payload.leadId,
      stripeIntentId: payload.stripeIntentId,
    });
    return;
  }

  const recipientEmails: string[] = [];

  for (const userId of ownerUserIds) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user?.email) {
      continue;
    }
    recipientEmails.push(data.user.email);
  }

  if (recipientEmails.length === 0) {
    return;
  }

  const amountFormatted = (payload.amountPaidCents / 100).toFixed(2);
  const subject = `Deposit received — ${payload.leadName} is locked in`;
  const html = `
    <p>A deposit has been received for <strong>${payload.businessName}</strong>.</p>
    <ul>
      <li><strong>Lead:</strong> ${payload.leadName}</li>
      <li><strong>Amount:</strong> $${amountFormatted}</li>
      <li><strong>Status:</strong> Locked in</li>
    </ul>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipientEmails,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }
}
