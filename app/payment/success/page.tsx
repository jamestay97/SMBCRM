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

import { confirmStripeCheckoutSession } from "@/lib/stripe/confirm-payment";



export default async function PaymentSuccessPage({

  searchParams,

}: {

  searchParams: { lead_id?: string; session_id?: string };

}) {

  let confirmed = false;

  let confirmError: string | null = null;



  if (searchParams.session_id) {

    try {

      const result = await confirmStripeCheckoutSession(

        searchParams.session_id

      );

      confirmed = Boolean(result);

    } catch (err) {

      confirmError =

        err instanceof Error ? err.message : "Could not confirm payment";

      console.error("[payment/success] confirm failed", err);

    }

  }



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

          {confirmError ? (

            <p className="text-sm text-amber-800">

              Payment went through on Stripe, but we couldn&apos;t update our

              records automatically. Our team has been notified — your spot is

              still reserved.

            </p>

          ) : confirmed ? (

            <p className="text-sm text-emerald-800">

              Your appointment is marked paid in our system.

            </p>

          ) : searchParams.session_id ? (

            <p className="text-sm text-muted-foreground">

              Finalizing your booking…

            </p>

          ) : null}

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

