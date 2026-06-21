import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PaymentSuccessConfirm } from "@/components/payment/payment-success-confirm";

export default function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: { lead_id?: string; session_id?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-white px-4 py-12">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center space-y-3">
          <CheckCircle2 className="h-14 w-14 text-emerald-600" />
          <CardTitle className="text-2xl">Payment received</CardTitle>
          <CardDescription className="text-base">
            Thank you — your deposit is confirmed and your appointment is locked
            in. We&apos;ll see you soon!
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PaymentSuccessConfirm
            sessionId={searchParams.session_id}
            leadId={searchParams.lead_id}
          />

          <p className="text-sm text-muted-foreground">
            You&apos;ll receive a confirmation email if we have your address on
            file. If you have questions, reply to our team directly.
          </p>

          <Button asChild className="w-full">
            <Link href="/">Done</Link>
          </Button>

          {searchParams.lead_id ? (
            <p className="text-xs text-muted-foreground">
              Reference: {searchParams.lead_id.slice(0, 8)}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
