import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { createAdminClient } from "@/lib/supabase/admin";

import { seedDefaultCalendar } from "@/lib/calendar/seed-defaults";
import { ensureOrganizationPublicSlug } from "@/lib/business/slug";
import { normalizeStoredPhoneNumber } from "@/lib/jobs/enqueue";

const DEFAULT_SERVICES_SCOPE =
  "General service appointments. Update in Dashboard → Settings with exact services.";

const createTenantSchema = z.object({
  business_name: z.string().min(1).max(200),
  ai_system_prompt: z.string().min(10).max(8000),
  services_scope: z.string().min(10).max(4000).optional(),
  deposit_amount_cents: z.number().int().positive(),
  owner_email: z.string().email(),
  owner_password: z.string().min(8).max(128),
  plan_id: z.string().default("starter"),
  llm_provider: z.enum(["ollama", "openai", "anthropic"]).default("openai"),
  llm_model: z.string().optional(),
  phone_number: z.string().optional(),
  twilio_sid: z.string().optional(),
});

function respondAuthError(err: unknown) {
  const code = err instanceof Error ? err.message : "FORBIDDEN";
  return NextResponse.json(
    { error: code === "UNAUTHORIZED" ? "Unauthorized" : "Forbidden" },
    { status: code === "UNAUTHORIZED" ? 401 : 403 }
  );
}

export async function GET() {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return respondAuthError(err);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select(
      `
      *,
      tenant_subscriptions (*),
      tenant_phone_numbers (*)
    `
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tenants: data });
}

export async function POST(request: NextRequest) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return respondAuthError(err);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const input = parsed.data;

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: input.owner_email,
    password: input.owner_password,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: authError?.message ?? "Failed to create owner user" },
      { status: 400 }
    );
  }

  const userId = authData.user.id;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      business_name: input.business_name,
      ai_system_prompt: input.ai_system_prompt,
      services_scope: input.services_scope ?? DEFAULT_SERVICES_SCOPE,
      deposit_amount_cents: input.deposit_amount_cents,
      llm_provider: input.llm_provider,
      llm_model: input.llm_model ?? "gpt-4o",
      status: "active",
    })
    .select("id")
    .single();

  if (orgError || !org) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: orgError?.message }, { status: 500 });
  }

  const { error: memberError } = await admin.from("organization_members").insert({
    org_id: org.id,
    user_id: userId,
    role: "owner",
  });

  if (memberError) {
    await admin.from("organizations").delete().eq("id", org.id);
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 14);

  await admin.from("tenant_subscriptions").insert({
    org_id: org.id,
    plan_id: input.plan_id,
    status: "trialing",
    trial_ends_at: trialEnds.toISOString(),
  });

  if (input.phone_number) {
    await admin.from("tenant_phone_numbers").insert({
      org_id: org.id,
      phone_number: normalizeStoredPhoneNumber(input.phone_number),
      twilio_sid: input.twilio_sid ?? null,
      channel: "both",
      is_primary: true,
    });
  }

  await seedDefaultCalendar(org.id);
  const publicSlug = await ensureOrganizationPublicSlug(org.id, input.business_name);

  return NextResponse.json(
    { org_id: org.id, owner_user_id: userId, public_slug: publicSlug },
    { status: 201 }
  );
}
