import Link from "next/link";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

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

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Your AI rep that engages leads and collects deposits
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Multi-tenant B2B SaaS for SMS, webchat, and voice outreach — with
          Stripe-secured deposit links triggered by AI tool calls.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Button size="lg" asChild>
            <Link href="/signup">Start free</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">Business login</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
