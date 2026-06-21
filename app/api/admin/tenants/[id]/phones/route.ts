import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { assignTenantPrimaryPhone } from "@/lib/tenant/phones";

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

  try {
    const phone = await assignTenantPrimaryPhone({
      orgId: params.id,
      phoneNumber: parsed.data.phone_number,
      channel: parsed.data.channel,
      twilioSid: parsed.data.twilio_sid ?? null,
    });

    return NextResponse.json({ phone }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    if (message === "PHONE_IN_USE") {
      return NextResponse.json(
        { error: "That phone number is already assigned to another business." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
