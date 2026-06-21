import { NextRequest, NextResponse } from "next/server";
import { confirmStripeCheckoutSession } from "@/lib/stripe/confirm-payment";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim();

  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  try {
    const result = await confirmStripeCheckoutSession(sessionId);

    if (!result) {
      return NextResponse.json(
        {
          confirmed: false,
          pending: true,
          message: "Payment not marked paid yet — retry shortly.",
        },
        { status: 202 }
      );
    }

    return NextResponse.json({
      confirmed: true,
      alreadyConfirmed: result.alreadyConfirmed,
      leadId: result.leadId,
      orgId: result.orgId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Confirmation failed";
    console.error("[stripe/confirm-session]", message, err);
    return NextResponse.json({ error: message, confirmed: false }, { status: 500 });
  }
}
