"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type ConfirmState =
  | { status: "idle" | "confirming" }
  | { status: "confirmed"; leadId?: string }
  | { status: "error"; message: string };

export function PaymentSuccessConfirm({
  sessionId,
  leadId,
}: {
  sessionId?: string;
  leadId?: string;
}) {
  const [state, setState] = useState<ConfirmState>({ status: "idle" });

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 8;

    async function confirm() {
      if (cancelled) return;
      setState({ status: "confirming" });
      attempts += 1;

      try {
        const response = await fetch(
          `/api/stripe/confirm-session?session_id=${encodeURIComponent(sessionId!)}`
        );
        const data = await response.json();

        if (response.ok && data.confirmed) {
          setState({
            status: "confirmed",
            leadId: data.leadId ?? leadId,
          });
          return;
        }

        if (response.status === 202 && attempts < maxAttempts) {
          window.setTimeout(confirm, 2000);
          return;
        }

        setState({
          status: "error",
          message:
            data.error ??
            "Payment completed on Stripe but we could not update the CRM yet.",
        });
      } catch {
        if (attempts < maxAttempts) {
          window.setTimeout(confirm, 2000);
          return;
        }
        setState({
          status: "error",
          message: "Could not reach the server to confirm your payment.",
        });
      }
    }

    confirm();

    return () => {
      cancelled = true;
    };
  }, [sessionId, leadId]);

  if (!sessionId) {
    return (
      <p className="text-sm text-amber-800">
        Missing payment reference. If you paid, contact the business with your
        confirmation email.
      </p>
    );
  }

  if (state.status === "confirming" || state.status === "idle") {
    return (
      <p className="text-sm text-muted-foreground">
        Updating your appointment in our system…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-amber-800">{state.message}</p>
        <p className="text-xs text-muted-foreground">
          If this persists, ensure Stripe webhooks point to{" "}
          <code className="text-[11px]">/api/stripe/webhook</code> with events{" "}
          <code className="text-[11px]">checkout.session.completed</code> and{" "}
          <code className="text-[11px]">payment_intent.succeeded</code>.
        </p>
      </div>
    );
  }

  const resolvedLeadId = state.leadId ?? leadId;

  return (
    <div className="space-y-3">
      <p className="text-sm text-emerald-800">
        Your appointment is marked paid in our system.
      </p>
      {resolvedLeadId ? (
        <Button asChild variant="outline" className="w-full">
          <Link href={`/dashboard/leads/${resolvedLeadId}?payment=success`}>
            View lead in CRM
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
