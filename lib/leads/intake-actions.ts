import { isPlausibleInferredName } from "@/lib/leads/infer-contact";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertNoDuplicateLead } from "@/lib/leads/duplicates";
import {
  assertLeadReadyForBooking,
  buildDisplayName,
  type LeadIntakeRecord,
} from "@/lib/leads/intake";
import { verifyServiceScope } from "@/lib/leads/verify-scope";
import { resolveOrgLlmConfig } from "@/lib/llm/org-config";

type IntakeUpdate = {
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  service_address?: string;
  appointment_reason?: string;
  intake_name_collected?: boolean;
  intake_phone_collected?: boolean;
  intake_email_collected?: boolean;
  intake_address_collected?: boolean;
  reset_name?: boolean;
};

const CONTACT_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "service_address",
] as const;

const INTAKE_SELECT =
  "id, org_id, name, first_name, last_name, phone, email, service_address, appointment_reason, scope_confirmed, scope_acknowledged, intake_name_collected, intake_phone_collected, intake_email_collected, intake_address_collected, contact_confirmed";

function contactFieldsChanged(
  current: LeadIntakeRecord,
  patch: IntakeUpdate
): boolean {
  for (const field of CONTACT_FIELDS) {
    if (patch[field] === undefined) continue;
    const next = patch[field]?.trim() || null;
    const prev = current[field]?.trim() || null;
    if (next !== prev) return true;
  }
  return false;
}

export async function loadLeadIntakeRecord(params: {
  orgId: string;
  leadId: string;
}): Promise<LeadIntakeRecord> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("leads")
    .select(INTAKE_SELECT)
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .single();

  if (error || !data) {
    throw new Error(`Lead not found: ${error?.message}`);
  }

  return data as LeadIntakeRecord;
}

export async function updateLeadIntake(params: {
  orgId: string;
  leadId: string;
  patch: IntakeUpdate;
}): Promise<LeadIntakeRecord> {
  const admin = createAdminClient();
  const current = await loadLeadIntakeRecord(params);

  const firstName = params.patch.reset_name
    ? null
    : params.patch.first_name?.trim() || current.first_name?.trim() || null;
  const lastName = params.patch.reset_name
    ? null
    : params.patch.last_name?.trim() || current.last_name?.trim() || null;

  if (
    params.patch.first_name &&
    params.patch.last_name &&
    !params.patch.reset_name &&
    !isPlausibleInferredName(params.patch.first_name, params.patch.last_name)
  ) {
    throw new Error(
      "Invalid name — only save names the customer clearly provided."
    );
  }
  const phone = params.patch.phone?.trim() || current.phone?.trim() || null;
  const email = params.patch.email?.trim() || current.email?.trim() || null;
  const serviceAddress =
    params.patch.service_address?.trim() ||
    current.service_address?.trim() ||
    null;
  const appointmentReason =
    params.patch.appointment_reason?.trim() ||
    current.appointment_reason?.trim() ||
    null;
  const reasonChanged =
    Boolean(params.patch.appointment_reason?.trim()) &&
    params.patch.appointment_reason?.trim() !==
      current.appointment_reason?.trim();
  const contactChanged = contactFieldsChanged(current, params.patch);

  if (!phone && !email) {
    throw new Error("Lead must have a phone number or email");
  }

  await assertNoDuplicateLead({
    orgId: params.orgId,
    phone,
    email,
    excludeLeadId: params.leadId,
  });

  const name = buildDisplayName(firstName, lastName, current.name);

  const intakeNameCollected = params.patch.reset_name
    ? false
    : params.patch.intake_name_collected ??
      (params.patch.first_name && params.patch.last_name
        ? true
        : reasonChanged
          ? false
          : current.intake_name_collected);
  const intakePhoneCollected =
    params.patch.intake_phone_collected ??
    (params.patch.phone
      ? true
      : reasonChanged
        ? false
        : current.intake_phone_collected);
  const intakeEmailCollected =
    params.patch.intake_email_collected ??
    (params.patch.email
      ? true
      : reasonChanged
        ? false
        : current.intake_email_collected);
  const intakeAddressCollected =
    params.patch.intake_address_collected ??
    (params.patch.service_address
      ? true
      : reasonChanged
        ? false
        : current.intake_address_collected);

  const { data, error } = await admin
    .from("leads")
    .update({
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      service_address: serviceAddress,
      appointment_reason: appointmentReason,
      intent: appointmentReason,
      name,
      scope_confirmed: reasonChanged ? false : current.scope_confirmed,
      scope_acknowledged: reasonChanged ? false : current.scope_acknowledged,
      intake_name_collected: intakeNameCollected,
      intake_phone_collected: intakePhoneCollected,
      intake_email_collected: intakeEmailCollected,
      intake_address_collected: intakeAddressCollected,
      contact_confirmed:
        reasonChanged || contactChanged ? false : current.contact_confirmed,
    })
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .select(INTAKE_SELECT)
    .single();

  if (error || !data) {
    throw new Error(`Failed to update lead intake: ${error?.message}`);
  }

  return data as LeadIntakeRecord;
}

export async function acknowledgeServiceScope(params: {
  orgId: string;
  leadId: string;
  appointmentReason?: string;
}): Promise<{
  in_scope: boolean;
  customer_message: string;
  lead: LeadIntakeRecord;
}> {
  const scope = await runServiceScopeVerification(params);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("leads")
    .update({ scope_acknowledged: true })
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .select(INTAKE_SELECT)
    .single();

  if (error || !data) {
    throw new Error(`Failed to acknowledge scope: ${error?.message}`);
  }

  return {
    in_scope: scope.in_scope,
    customer_message: scope.customer_message,
    lead: data as LeadIntakeRecord,
  };
}

export async function confirmLeadContact(params: {
  orgId: string;
  leadId: string;
}): Promise<LeadIntakeRecord> {
  const lead = await loadLeadIntakeRecord(params);
  assertLeadReadyForBooking({ ...lead, contact_confirmed: true });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .update({ contact_confirmed: true })
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .select(INTAKE_SELECT)
    .single();

  if (error || !data) {
    throw new Error(`Failed to confirm contact details: ${error?.message}`);
  }

  return data as LeadIntakeRecord;
}

export async function runServiceScopeVerification(params: {
  orgId: string;
  leadId: string;
  appointmentReason?: string;
}): Promise<{
  in_scope: boolean;
  scope_confirmed: boolean;
  summary: string;
  customer_message: string;
  verified_reason: string;
  lead: LeadIntakeRecord;
}> {
  const admin = createAdminClient();

  if (params.appointmentReason?.trim()) {
    await updateLeadIntake({
      orgId: params.orgId,
      leadId: params.leadId,
      patch: { appointment_reason: params.appointmentReason.trim() },
    });
  }

  const lead = await loadLeadIntakeRecord(params);

  const reason = lead.appointment_reason?.trim() || "";

  if (!reason) {
    throw new Error(
      "Cannot verify scope without appointment_reason. Ask the customer why they need an appointment, save it with update_lead_intake, then call verify_service_scope with that reason."
    );
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select(
      "business_name, services_scope, ai_system_prompt, llm_provider, llm_model, sla_target_seconds, llm_api_key_encrypted"
    )
    .eq("id", params.orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organization not found: ${orgError?.message}`);
  }

  const llmConfig = resolveOrgLlmConfig(org);
  const servicesScope =
    org.services_scope?.trim() || org.ai_system_prompt.slice(0, 500);

  const result = await verifyServiceScope({
    servicesScope,
    businessName: org.business_name,
    appointmentReason: reason,
    model: llmConfig.model,
    baseUrl: llmConfig.baseUrl,
    provider: llmConfig.provider,
    apiKey: llmConfig.apiKey,
  });

  const { data: updatedLead, error } = await admin
    .from("leads")
    .update({
      appointment_reason: reason,
      intent: reason,
      scope_confirmed: result.in_scope,
      scope_acknowledged: true,
      contact_confirmed: result.in_scope ? lead.contact_confirmed : false,
    })
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .select(INTAKE_SELECT)
    .single();

  if (error || !updatedLead) {
    throw new Error(`Failed to update scope status: ${error?.message}`);
  }

  return {
    in_scope: result.in_scope,
    scope_confirmed: result.in_scope,
    summary: result.summary,
    customer_message: result.customer_message,
    verified_reason: reason,
    lead: updatedLead as LeadIntakeRecord,
  };
}
