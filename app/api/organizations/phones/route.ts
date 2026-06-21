import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatPhoneForDisplay } from "@/lib/business/public-profile";
import {
  assignTenantPrimaryPhone,
  getTenantPrimaryPhone,
} from "@/lib/tenant/phones";
import { toE164 } from "@/lib/twilio/phone";
import { createClient } from "@/lib/supabase/server";

const phoneSchema = z.object({
  phone_number: z.string().min(7).max(30),
  channel: z.enum(["sms", "voice", "both"]).default("both"),
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

  return { orgId: membership.org_id, role: membership.role };
}

export async function GET() {
  const ctx = await getUserOrgContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phone = await getTenantPrimaryPhone(ctx.orgId);

  return NextResponse.json({
    phone: phone
      ? {
          ...phone,
          phone_display: formatPhoneForDisplay(toE164(phone.phone_number)),
        }
      : null,
  });
}

export async function POST(request: NextRequest) {
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

  const parsed = phoneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const phone = await assignTenantPrimaryPhone({
      orgId: ctx.orgId,
      phoneNumber: parsed.data.phone_number,
      channel: parsed.data.channel,
    });

    return NextResponse.json({
      phone: {
        ...phone,
        phone_display: formatPhoneForDisplay(toE164(phone.phone_number)),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    if (message === "PHONE_IN_USE") {
      return NextResponse.json(
        {
          error:
            "That phone number is already assigned to another business in SMBCRM.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
