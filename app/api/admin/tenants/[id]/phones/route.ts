import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { createAdminClient } from "@/lib/supabase/admin";

const phoneSchema = z.object({
  phone_number: z.string().min(7).max(30),
  twilio_sid: z.string().optional(),
  channel: z.enum(["sms", "voice", "both"]).default("both"),
  is_primary: z.boolean().default(true),
});

function respondAuthError(err: unknown) {
  const code = err instanceof Error ? err.message : "FORBIDDEN";
  return NextResponse.json(
    { error: code === "UNAUTHORIZED" ? "Unauthorized" : "Forbidden" },
    { status: code === "UNAUTHORIZED" ? 401 : 403 }
  );
}

export async function POST(
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

  const parsed = phoneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  if (parsed.data.is_primary) {
    await admin
      .from("tenant_phone_numbers")
      .update({ is_primary: false })
      .eq("org_id", params.id);
  }

  const { data, error } = await admin
    .from("tenant_phone_numbers")
    .insert({
      org_id: params.id,
      phone_number: parsed.data.phone_number,
      twilio_sid: parsed.data.twilio_sid ?? null,
      channel: parsed.data.channel,
      is_primary: parsed.data.is_primary,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ phone: data }, { status: 201 });
}
