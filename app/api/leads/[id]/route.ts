import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildDisplayName } from "@/lib/leads/intake";
import {
  assertNoDuplicateLead,
  duplicateLeadErrorResponse,
  isDuplicateLeadError,
} from "@/lib/leads/duplicates";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgId } from "@/lib/auth/org";
import type { LeadStatus } from "@/types/database";

const leadStatusSchema = z.enum([
  "new",
  "engaged",
  "payment_pending",
  "locked_in",
]);

const updateLeadSchema = z
  .object({
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    name: z.string().min(1).max(200).optional(),
    phone: z.string().min(7).max(30).nullable().optional(),
    email: z.string().email().nullable().optional(),
    appointment_reason: z.string().max(2000).nullable().optional(),
    service_address: z.string().max(500).nullable().optional(),
    status: leadStatusSchema.optional(),
    scope_confirmed: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.phone === undefined && data.email === undefined) return true;
      const phone = data.phone?.trim();
      const email = data.email?.trim();
      return Boolean(phone || email);
    },
    { message: "Lead must have a phone number or email" }
  );

async function getLeadAccess(leadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  let orgId: string | null;
  try {
    orgId = await getUserOrgId();
  } catch {
    return null;
  }

  if (!orgId) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("org_id", orgId)
    .maybeSingle();

  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error || !lead) return null;

  return {
    supabase,
    orgId,
    role: membership?.role ?? "member",
    lead,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getLeadAccess(params.id);
  if (!ctx) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  return NextResponse.json({ lead: ctx.lead });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getLeadAccess(params.id);
  if (!ctx) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const current = ctx.lead;
  const patch = parsed.data;

  const firstName =
    patch.first_name?.trim() ?? current.first_name?.trim() ?? null;
  const lastName =
    patch.last_name?.trim() ?? current.last_name?.trim() ?? null;
  const phone =
    patch.phone !== undefined ? patch.phone?.trim() || null : current.phone;
  const email =
    patch.email !== undefined ? patch.email?.trim() || null : current.email;

  if (!phone && !email) {
    return NextResponse.json(
      { error: "Lead must have a phone number or email" },
      { status: 400 }
    );
  }

  try {
    await assertNoDuplicateLead({
      orgId: ctx.orgId,
      phone,
      email,
      excludeLeadId: params.id,
    });
  } catch (err) {
    if (isDuplicateLeadError(err)) {
      return NextResponse.json(duplicateLeadErrorResponse(err), {
        status: 409,
      });
    }
    throw err;
  }

  const appointmentReason =
    patch.appointment_reason !== undefined
      ? patch.appointment_reason?.trim() || null
      : current.appointment_reason;

  const serviceAddress =
    patch.service_address !== undefined
      ? patch.service_address?.trim() || null
      : current.service_address;

  const name =
    patch.name?.trim() ||
    buildDisplayName(firstName, lastName, current.name);

  const updates: Record<string, unknown> = {
    first_name: firstName,
    last_name: lastName,
    name,
    phone,
    email,
    appointment_reason: appointmentReason,
    intent: appointmentReason ?? current.intent,
    service_address: serviceAddress,
  };

  if (patch.service_address !== undefined) {
    updates.intake_address_collected = Boolean(serviceAddress);
  }

  if (patch.status !== undefined) {
    updates.status = patch.status as LeadStatus;
  }

  if (patch.scope_confirmed !== undefined) {
    updates.scope_confirmed = patch.scope_confirmed;
  }

  const { data, error } = await ctx.supabase
    .from("leads")
    .update(updates)
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getLeadAccess(params.id);
  if (!ctx) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return NextResponse.json(
      { error: "Only organization owners and admins can delete leads" },
      { status: 403 }
    );
  }

  const { error } = await ctx.supabase
    .from("leads")
    .delete()
    .eq("id", params.id)
    .eq("org_id", ctx.orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
