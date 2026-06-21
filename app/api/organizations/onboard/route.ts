import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { seedDefaultCalendar } from "@/lib/calendar/seed-defaults";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const onboardSchema = z.object({
  business_name: z.string().min(1).max(200),
  ai_system_prompt: z.string().min(10).max(8000),
  services_scope: z.string().min(10).max(4000).optional(),
  deposit_amount_cents: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = onboardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { data: existing } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "User already belongs to an organization" },
      { status: 409 }
    );
  }

  const servicesScope =
    parsed.data.services_scope ??
    "General service appointments. Update this in Dashboard → Settings with your exact services.";

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      business_name: parsed.data.business_name,
      ai_system_prompt: parsed.data.ai_system_prompt,
      services_scope: servicesScope,
      deposit_amount_cents: parsed.data.deposit_amount_cents,
    })
    .select("id")
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: orgError?.message ?? "Failed to create organization" },
      { status: 500 }
    );
  }

  const { error: memberError } = await admin.from("organization_members").insert({
    org_id: org.id,
    user_id: user.id,
    role: "owner",
  });

  if (memberError) {
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 14);

  await admin.from("tenant_subscriptions").insert({
    org_id: org.id,
    plan_id: "starter",
    status: "trialing",
    trial_ends_at: trialEnds.toISOString(),
  });

  await seedDefaultCalendar(org.id);

  return NextResponse.json({ org_id: org.id }, { status: 201 });
}
