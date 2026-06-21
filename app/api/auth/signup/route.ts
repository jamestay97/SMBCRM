import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedDefaultCalendar } from "@/lib/calendar/seed-defaults";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  business_name: z.string().min(1).max(200),
  ai_system_prompt: z.string().min(10).max(8000),
  services_scope: z.string().min(10).max(4000).optional(),
  deposit_amount_cents: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { email, password, business_name, ai_system_prompt, deposit_amount_cents } =
    parsed.data;
  const servicesScope =
    parsed.data.services_scope ??
    "General service appointments. Update this in Dashboard → Settings with your exact services.";

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    const message = authError.message.toLowerCase();
    if (message.includes("already") || message.includes("registered")) {
      return NextResponse.json(
        { error: "An account with this email already exists. Try logging in." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const userId = authData.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Account was created but user id was missing" },
      { status: 500 }
    );
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      business_name,
      ai_system_prompt,
      services_scope: servicesScope,
      deposit_amount_cents,
    })
    .select("id")
    .single();

  if (orgError || !org) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: orgError?.message ?? "Failed to create organization" },
      { status: 500 }
    );
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
    plan_id: "starter",
    status: "trialing",
    trial_ends_at: trialEnds.toISOString(),
  });

  await seedDefaultCalendar(org.id);

  return NextResponse.json({ org_id: org.id }, { status: 201 });
}
