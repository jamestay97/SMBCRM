import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const updateOrgSchema = z.object({
  business_name: z.string().min(1).max(200).optional(),
  ai_system_prompt: z.string().min(10).max(8000).optional(),
  services_scope: z.string().min(10).max(4000).optional(),
  deposit_amount_cents: z.number().int().positive().optional(),
  stripe_account_id: z.string().nullable().optional(),
});

async function getUserOrgContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  return { supabase, orgId: membership.org_id, role: membership.role };
}

export async function GET() {
  const ctx = await getUserOrgContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await ctx.supabase
    .from("organizations")
    .select("*")
    .eq("id", ctx.orgId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ organization: data, role: ctx.role });
}

export async function PATCH(request: NextRequest) {
  const ctx = await getUserOrgContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { data, error } = await ctx.supabase
    .from("organizations")
    .update(parsed.data)
    .eq("id", ctx.orgId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ organization: data });
}
