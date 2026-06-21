import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ingestLead } from "@/lib/leads/ingest";
import {
  duplicateLeadErrorResponse,
  isDuplicateLeadError,
} from "@/lib/leads/duplicates";
import { getUserOrgId } from "@/lib/auth/org";

const createLeadSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: z.string().min(7).max(30).optional(),
    email: z.string().email().optional(),
    service_address: z.string().max(500).optional(),
    initial_message: z.string().max(2000).optional(),
    send_sms: z.boolean().optional(),
  })
  .refine((data) => data.phone || data.email, {
    message: "phone or email is required",
  });

export async function POST(request: NextRequest) {
  let orgId: string | null;
  try {
    orgId = await getUserOrgId();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid organization";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await ingestLead({
      orgId,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      serviceAddress: parsed.data.service_address,
      initialMessage: parsed.data.initial_message,
      channel: "webchat",
      sendOutboundSms: parsed.data.send_sms ?? false,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (isDuplicateLeadError(err)) {
      return NextResponse.json(duplicateLeadErrorResponse(err), {
        status: 409,
      });
    }
    const message = err instanceof Error ? err.message : "Failed to create lead";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const supabase = await createClient();
  let orgId: string | null;
  try {
    orgId = await getUserOrgId();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid organization";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ leads: data });
}
