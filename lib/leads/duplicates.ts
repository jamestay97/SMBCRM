import { createAdminClient } from "@/lib/supabase/admin";

export type DuplicateConflictField = "phone" | "email";

export class DuplicateLeadError extends Error {
  existingLeadId: string;
  existingLeadName: string;
  conflictField: DuplicateConflictField;

  constructor(params: {
    message: string;
    existingLeadId: string;
    existingLeadName: string;
    conflictField: DuplicateConflictField;
  }) {
    super(params.message);
    this.name = "DuplicateLeadError";
    this.existingLeadId = params.existingLeadId;
    this.existingLeadName = params.existingLeadName;
    this.conflictField = params.conflictField;
  }
}

export function isDuplicateLeadError(
  error: unknown
): error is DuplicateLeadError {
  return error instanceof DuplicateLeadError;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type DuplicateLeadMatch = {
  id: string;
  name: string;
  conflictField: DuplicateConflictField;
};

export async function findDuplicateLead(params: {
  orgId: string;
  phone?: string | null;
  email?: string | null;
  excludeLeadId?: string;
}): Promise<DuplicateLeadMatch | null> {
  const normalizedPhone = params.phone?.trim()
    ? normalizePhone(params.phone)
    : null;
  const normalizedEmail = params.email?.trim()
    ? normalizeEmail(params.email)
    : null;

  if (!normalizedPhone && !normalizedEmail) {
    return null;
  }

  const admin = createAdminClient();
  let query = admin
    .from("leads")
    .select("id, name, phone, email")
    .eq("org_id", params.orgId);

  if (params.excludeLeadId) {
    query = query.neq("id", params.excludeLeadId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to check for duplicate leads: ${error.message}`);
  }

  for (const lead of data ?? []) {
    if (
      normalizedPhone &&
      lead.phone &&
      normalizePhone(lead.phone) === normalizedPhone
    ) {
      return {
        id: lead.id,
        name: lead.name,
        conflictField: "phone",
      };
    }

    if (
      normalizedEmail &&
      lead.email &&
      normalizeEmail(lead.email) === normalizedEmail
    ) {
      return {
        id: lead.id,
        name: lead.name,
        conflictField: "email",
      };
    }
  }

  return null;
}

export async function assertNoDuplicateLead(params: {
  orgId: string;
  phone?: string | null;
  email?: string | null;
  excludeLeadId?: string;
}): Promise<void> {
  const duplicate = await findDuplicateLead(params);

  if (!duplicate) return;

  const label =
    duplicate.conflictField === "phone" ? "phone number" : "email address";

  throw new DuplicateLeadError({
    message: `A lead with this ${label} already exists (${duplicate.name}).`,
    existingLeadId: duplicate.id,
    existingLeadName: duplicate.name,
    conflictField: duplicate.conflictField,
  });
}

export function duplicateLeadErrorResponse(error: DuplicateLeadError) {
  return {
    error: error.message,
    existing_lead_id: error.existingLeadId,
    existing_lead_name: error.existingLeadName,
    conflict_field: error.conflictField,
  };
}
