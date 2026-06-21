import Link from "next/link";
import { MessageCircle, Phone, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  buildSmsHref,
  buildTelHref,
  type PublicBusinessProfile,
} from "@/lib/business/public-profile";
import { formatDepositAmount } from "@/lib/calendar/format-appointment";

export function CustomerContactPage({
  business,
}: {
  business: PublicBusinessProfile;
}) {
  const hasPhone = Boolean(business.phone_e164);
  const depositLabel = formatDepositAmount(business.deposit_amount_cents);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          AI receptionist
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">For businesses</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-4">
        <div className="text-center">
          <Badge variant="secondary" className="mb-4">
            Open for scheduling
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            {business.business_name}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Text or call our AI receptionist to check if we handle your job,
            confirm your details, and book an appointment with a deposit link.
          </p>
        </div>

        {hasPhone ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <Button
              size="lg"
              className="h-auto min-h-[4.5rem] flex-col gap-1 py-5 text-base"
              asChild
            >
              <a href={buildTelHref(business.phone_e164!)}>
                <Phone className="mb-1 h-6 w-6" />
                Call {business.phone_display}
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-auto min-h-[4.5rem] flex-col gap-1 py-5 text-base"
              asChild
            >
              <a href={buildSmsHref(business.phone_e164!, business.business_name)}>
                <MessageCircle className="mb-1 h-6 w-6" />
                Text {business.phone_display}
              </a>
            </Button>
          </div>
        ) : (
          <Card className="mt-10 border-amber-200 bg-amber-50">
            <CardContent className="py-6 text-center text-sm text-amber-900">
              This business is still setting up their phone line. Please check
              back soon.
            </CardContent>
          </Card>
        )}

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>What we handle</CardTitle>
            <CardDescription>
              Tell the AI what you need — it will confirm we can help before
              booking.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {business.services.map((service) => (
                <li key={service}>
                  <Badge variant="outline">{service}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">1. Reach out</span>{" "}
              — Text or call the number above. Our AI receptionist answers 24/7.
            </p>
            <p>
              <span className="font-medium text-foreground">2. Confirm scope</span>{" "}
              — Describe your job. The AI checks it against our services and
              collects your contact details.
            </p>
            <p>
              <span className="font-medium text-foreground">3. Book & deposit</span>{" "}
              — Pick a time from our calendar and pay a {depositLabel} deposit
              to lock in your appointment.
            </p>
          </CardContent>
        </Card>

        {hasPhone && (
          <>
            <p className="mt-8 text-center text-xs text-muted-foreground">
              Prefer texting? Tap &quot;Text&quot; on mobile — you&apos;ll message
              our AI directly at {business.phone_display}.
            </p>
            <Card className="mt-6 border-slate-200 bg-slate-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Text message consent</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>
                  By texting {business.phone_display}, you agree to receive
                  automated and human-assisted SMS replies from{" "}
                  {business.business_name} about your service request,
                  appointment scheduling, and deposit links. Message frequency
                  varies. Msg &amp; data rates may apply.
                </p>
                <p>
                  You are not required to consent to receive texts as a condition
                  of purchase. Reply <strong>STOP</strong> to opt out or{" "}
                  <strong>HELP</strong> for help.
                </p>
                <p>
                  You may also call {business.phone_display} instead of texting.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </section>
    </main>
  );
}
