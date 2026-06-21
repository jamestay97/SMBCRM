import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { createAdminClient } from "@/lib/supabase/admin";

const updateSchema = z.object({
  business_name: z.string().min(1).max(200).optional(),
  ai_system_prompt: z.string().min(10).max(8000).optional(),
  deposit_amount_cents: z.number().int().positive().optional(),
  status: z.enum(["active", "suspended", "onboarding"]).optional(),
  llm_provider: z.enum(["ollama", "openai", "anthropic"]).optional(),
  llm_model: z.string().nullable().optional(),
  sla_target_seconds: z.number().int().min(60).max(3600).optional(),
  stripe_account_id: z.string().nullable().optional(),
  subscription_status: z
    .enum(["trialing", "active", "past_due", "canceled", "suspended"])
    .optional(),
  plan_id: z.string().optional(),
});

function respondAuthError(err: unknown) {
  const code = err instanceof Error ? err.message : "FORBIDDEN";
  return NextResponse.json(
    { error: code === "UNAUTHORIZED" ? "Unauthorized" : "Forbidden" },
    { status: code === "UNAUTHORIZED" ? 401 : 403 }
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    .eq("id", params.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ tenant: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const orgUpdate: Record<string, unknown> = {};

  if (parsed.data.business_name !== undefined)
    orgUpdate.business_name = parsed.data.business_name;
  if (parsed.data.ai_system_prompt !== undefined)
    orgUpdate.ai_system_prompt = parsed.data.ai_system_prompt;
  if (parsed.data.deposit_amount_cents !== undefined)
    orgUpdate.deposit_amount_cents = parsed.data.deposit_amount_cents;
  if (parsed.data.status !== undefined) orgUpdate.status = parsed.data.status;
  if (parsed.data.llm_provider !== undefined)
    orgUpdate.llm_provider = parsed.data.llm_provider;
  if (parsed.data.llm_model !== undefined)
    orgUpdate.llm_model = parsed.data.llm_model;
  if (parsed.data.sla_target_seconds !== undefined)
    orgUpdate.sla_target_seconds = parsed.data.sla_target_seconds;
  if (parsed.data.stripe_account_id !== undefined)
    orgUpdate.stripe_account_id = parsed.data.stripe_account_id;

  if (Object.keys(orgUpdate).length > 0) {
    const { error } = await admin
      .from("organizations")
      .update(orgUpdate)
      .eq("id", params.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (parsed.data.subscription_status || parsed.data.plan_id) {
    const subUpdate: Record<string, unknown> = {};
    if (parsed.data.subscription_status)
      subUpdate.status = parsed.data.subscription_status;
    if (parsed.data.plan_id) subUpdate.plan_id = parsed.data.plan_id;

    await admin
      .from("tenant_subscriptions")
      .update(subUpdate)
      .eq("org_id", params.id);
  }

  const { data } = await admin
    .from("organizations")
    .select(`*, tenant_subscriptions (*), tenant_phone_numbers (*)`)
    .eq("id", params.id)
    .single();

  return NextResponse.json({ tenant: data });
}
