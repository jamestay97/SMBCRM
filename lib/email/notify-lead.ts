import {
  formatAppointmentWindow,
  formatDepositAmount,
} from "@/lib/calendar/format-appointment";
import { escapeHtml, sendResendEmail } from "@/lib/email/resend-client";
import { createAdminClient } from "@/lib/supabase/admin";

function paymentButton(paymentUrl: string): string {
  const safeUrl = escapeHtml(paymentUrl);
  return `
    <p style="margin: 24px 0;">
      <a href="${safeUrl}"
         style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;">
        Pay deposit
      </a>
    </p>
    <p style="font-size: 14px; color: #64748b; word-break: break-all;">
      Or copy this link: <a href="${safeUrl}">${safeUrl}</a>
    </p>
  `;
}

function emailLayout(params: {
  businessName: string;
  bodyHtml: string;
}): string {
  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.5; color: #0f172a; max-width: 560px; margin: 0 auto; padding: 24px;">
      <p style="font-size: 13px; color: #64748b; margin: 0 0 16px;">${escapeHtml(params.businessName)}</p>
      ${params.bodyHtml}
    </div>
  `;
}

export async function sendAppointmentDepositEmail(params: {
  orgId: string;
  leadId: string;
  leadEmail: string;
  leadName: string;
  businessName: string;
  appointmentSummary: string;
  depositAmountCents: number;
  paymentUrl: string;
}): Promise<void> {
  const deposit = formatDepositAmount(params.depositAmountCents);
  const subject = `Your appointment with ${params.businessName} — deposit required`;

  const html = emailLayout({
    businessName: params.businessName,
    bodyHtml: `
      <h1 style="font-size: 22px; margin: 0 0 12px;">Appointment reserved</h1>
      <p>Hi ${escapeHtml(params.leadName)},</p>
      <p>Your appointment is scheduled with <strong>${escapeHtml(params.businessName)}</strong>.</p>
      <p style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
        ${escapeHtml(params.appointmentSummary)}
      </p>
      <p>Please pay your <strong>${escapeHtml(deposit)}</strong> deposit to lock in your spot.</p>
      ${paymentButton(params.paymentUrl)}
      <p style="font-size: 14px; color: #64748b; margin-top: 24px;">
        If you have questions, reply to this email or contact us directly.
      </p>
    `,
  });

  try {
    await sendResendEmail({
      to: params.leadEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error("[lead-email] appointment deposit email failed", {
      orgId: params.orgId,
      leadId: params.leadId,
      err,
    });
  }
}

export async function sendPaymentConfirmedEmail(params: {
  orgId: string;
  leadId: string;
  leadEmail: string;
  leadName: string;
  businessName: string;
  serviceReason?: string | null;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  amountPaidCents: number;
}): Promise<void> {
  const when = formatAppointmentWindow(
    params.startsAt,
    params.endsAt,
    params.timeZone
  );
  const amount = formatDepositAmount(params.amountPaidCents);
  const service = params.serviceReason?.trim()
    ? ` for ${params.serviceReason.trim()}`
    : "";

  const subject = `Payment received — your appointment with ${params.businessName} is confirmed`;

  const html = emailLayout({
    businessName: params.businessName,
    bodyHtml: `
      <h1 style="font-size: 22px; margin: 0 0 12px;">You're booked!</h1>
      <p>Hi ${escapeHtml(params.leadName)},</p>
      <p>We've received your <strong>${escapeHtml(amount)}</strong> deposit. Your appointment${escapeHtml(service)} is confirmed.</p>
      <p style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <strong>${escapeHtml(when)}</strong><br />
        <span style="color: #047857;">Payment accepted — see you then!</span>
      </p>
      <p style="font-size: 14px; color: #64748b; margin-top: 24px;">
        Thank you for choosing ${escapeHtml(params.businessName)}.
      </p>
    `,
  });

  try {
    await sendResendEmail({
      to: params.leadEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error("[lead-email] payment confirmed email failed", {
      orgId: params.orgId,
      leadId: params.leadId,
      err,
    });
  }
}

export async function notifyLeadPaymentConfirmed(params: {
  orgId: string;
  leadId: string;
  amountPaidCents: number;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("name, email, appointment_reason, intent")
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .single();

  if (leadError || !lead?.email?.trim()) {
    return;
  }

  const { data: org } = await admin
    .from("organizations")
    .select("business_name, timezone")
    .eq("id", params.orgId)
    .single();

  const { data: appointment } = await admin
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("org_id", params.orgId)
    .eq("lead_id", params.leadId)
    .eq("status", "confirmed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!appointment) {
    return;
  }

  await sendPaymentConfirmedEmail({
    orgId: params.orgId,
    leadId: params.leadId,
    leadEmail: lead.email.trim(),
    leadName: lead.name,
    businessName: org?.business_name ?? "our team",
    serviceReason: lead.appointment_reason ?? lead.intent,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    timeZone: org?.timezone ?? "America/New_York",
    amountPaidCents: params.amountPaidCents,
  });
}
