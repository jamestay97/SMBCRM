export type LeadStatus = "new" | "engaged" | "payment_pending" | "locked_in";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "canceled";
export type OrgMemberRole = "owner" | "admin" | "member";
export type OrgStatus = "active" | "suspended" | "onboarding";
export type LlmProvider = "ollama" | "openai" | "anthropic";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "suspended";
export type InboundJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "sla_breached";
export type LeadSource = "sms" | "voice" | "webchat" | "manual";
export type AppointmentStatus = "pending_payment" | "confirmed" | "cancelled";
export type PaymentFollowupStatus =
  | "pending"
  | "sent"
  | "skipped"
  | "cancelled";

export type ExtractedLeadEntities = {
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  service_type: string | null;
  urgency: "low" | "medium" | "high" | null;
  notes: string | null;
};

export type InboundJobPayload = {
  from?: string;
  to?: string;
  body?: string;
  transcript?: string;
  message_sid?: string;
  channel: "sms" | "voice" | "webchat";
};

export type Organization = {
  id: string;
  business_name: string;
  stripe_account_id: string | null;
  ai_system_prompt: string;
  deposit_amount_cents: number;
  status: OrgStatus;
  llm_provider: LlmProvider;
  llm_model: string | null;
  llm_api_key_encrypted: string | null;
  sla_target_seconds: number;
  timezone: string;
  services_scope: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantSubscription = {
  id: string;
  org_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantPhoneNumber = {
  id: string;
  org_id: string;
  twilio_sid: string | null;
  phone_number: string;
  channel: "sms" | "voice" | "both";
  is_primary: boolean;
  created_at: string;
};

export type InboundJob = {
  id: string;
  org_id: string;
  lead_id: string | null;
  channel: "sms" | "voice" | "webchat";
  payload_json: InboundJobPayload;
  status: InboundJobStatus;
  sla_deadline_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  result_json: Record<string, unknown>;
  created_at: string;
};

export type Lead = {
  id: string;
  org_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: LeadStatus;
  intent: string | null;
  first_name: string | null;
  last_name: string | null;
  appointment_reason: string | null;
  service_address: string | null;
  scope_confirmed: boolean;
  scope_acknowledged: boolean;
  intake_name_collected: boolean;
  intake_phone_collected: boolean;
  intake_email_collected: boolean;
  intake_address_collected: boolean;
  contact_confirmed: boolean;
  extracted_json: ExtractedLeadEntities | Record<string, unknown>;
  source: LeadSource | null;
  first_response_at: string | null;
  sla_met: boolean | null;
  created_at: string;
  updated_at: string;
};

export type AiConversation = {
  id: string;
  lead_id: string;
  org_id: string;
  openai_thread_id: string;
  transcript_json: TranscriptEntry[];
  channel: "sms" | "voice" | "webchat" | null;
  staff_read_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  org_id: string;
  lead_id: string;
  stripe_intent_id: string;
  amount_paid: number;
  status: PaymentStatus;
  checkout_url: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadPaymentFollowup = {
  id: string;
  org_id: string;
  lead_id: string;
  followup_step: number;
  scheduled_at: string;
  sent_at: string | null;
  status: PaymentFollowupStatus;
  message_body: string | null;
  created_at: string;
};

export type TranscriptEntry = {
  role: "user" | "assistant" | "system";
  content: string;
  channel?: "sms" | "webchat" | "voice";
  at: string;
};

export type OrganizationMember = {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgMemberRole;
  created_at: string;
};

export type TenantCalendarSettings = {
  org_id: string;
  slot_duration_minutes: number;
  min_notice_hours: number;
  booking_horizon_days: number;
  limit_appointments_per_slot: boolean;
  max_appointments_per_slot: number;
  created_at: string;
  updated_at: string;
};

export type TenantAvailability = {
  id: string;
  org_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type Appointment = {
  id: string;
  org_id: string;
  lead_id: string;
  payment_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  title: string;
  created_at: string;
  updated_at: string;
};

export type AppointmentWithLead = Appointment & {
  leads: Pick<Lead, "name" | "phone" | "email" | "status"> | null;
};

export type TenantWithRelations = Organization & {
  tenant_subscriptions: TenantSubscription[] | TenantSubscription | null;
  tenant_phone_numbers: TenantPhoneNumber[];
};
