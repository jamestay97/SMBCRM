import Link from "next/link";
import { Bot, MessageCircle, Phone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-semibold">
          <Bot className="h-6 w-6 text-primary" />
          AI Sales Rep
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-white px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          GPT-4o AI receptionist for local service businesses
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Customers text or call. Your AI books the job.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Give each business a dedicated phone number and a customer contact page.
          The AI checks scope, collects details, schedules appointments, and
          sends Stripe deposit links — by text or after a phone call.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Button size="lg" asChild>
            <Link href="/signup">Start your business</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">Business login</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <Phone className="mb-2 h-8 w-8 text-primary" />
            <CardTitle>Call</CardTitle>
            <CardDescription>
              Customers call your Twilio number. The AI listens, then texts back
              with next steps.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <MessageCircle className="mb-2 h-8 w-8 text-primary" />
            <CardTitle>Text</CardTitle>
            <CardDescription>
              SMS goes straight to GPT-4o — scope check, intake, scheduling, and
              deposit link in one thread.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Bot className="mb-2 h-8 w-8 text-primary" />
            <CardTitle>Book</CardTitle>
            <CardDescription>
              Verified contact info, calendar booking, and deposit collection
              built in.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="border-t bg-slate-50 py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-bold">For business owners</h2>
          <p className="mt-3 text-muted-foreground">
            After signup, open Dashboard → Settings to copy your customer contact
            link (e.g. <code className="text-xs">/b/your-business</code>) and
            assign your Twilio number in the admin panel.
          </p>
        </div>
      </section>
    </main>
  );
}
