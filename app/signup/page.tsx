"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnboardFlow = searchParams.get("onboard") === "1";

  const [step, setStep] = useState<"account" | "business">("account");
  const [onboardingExistingUser, setOnboardingExistingUser] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are an AI sales rep for our roofing company. Be friendly, qualify the job, and when the customer agrees to book, collect a deposit to lock in their spot."
  );
  const [depositDollars, setDepositDollars] = useState("250");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOnboardFlow) return;

    async function checkSession() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setOnboardingExistingUser(true);
        setEmail(user.email ?? "");
        setStep("business");
      }
    }

    checkSession();
  }, [isOnboardFlow]);

  async function handleAccountSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStep("business");
  }

  async function handleBusinessSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);

    const cents = Math.round(parseFloat(depositDollars) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Enter a valid deposit amount");
      setLoading(false);
      return;
    }

    try {
      if (onboardingExistingUser) {
        const response = await fetch("/api/organizations/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            business_name: businessName,
            ai_system_prompt: systemPrompt,
            deposit_amount_cents: cents,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Workspace setup failed");
        }

        toast.success("Workspace ready");
        router.push("/dashboard");
        router.refresh();
        return;
      }

      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          business_name: businessName,
          ai_system_prompt: systemPrompt,
          deposit_amount_cents: cents,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Signup failed");
      }

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        toast.success("Account created. Please log in.");
        router.push("/login");
        return;
      }

      toast.success("Workspace ready");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>
            {onboardingExistingUser ? "Finish workspace setup" : "Create your workspace"}
          </CardTitle>
          <CardDescription>
            {step === "account"
              ? "Step 1 — Create your account"
              : onboardingExistingUser
                ? "Tell us about your business so your AI rep can start working"
                : "Step 2 — Configure your AI sales rep"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "account" ? (
            <form onSubmit={handleAccountSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                Continue
              </Button>
            </form>
          ) : (
            <form onSubmit={handleBusinessSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="business">Business name</Label>
                <Input
                  id="business"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Tom's Roofing"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prompt">AI system prompt</Label>
                <textarea
                  id="prompt"
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deposit">Deposit amount (USD)</Label>
                <Input
                  id="deposit"
                  type="number"
                  min="1"
                  step="0.01"
                  value={depositDollars}
                  onChange={(e) => setDepositDollars(e.target.value)}
                  required
                />
              </div>
              <div className="flex gap-2">
                {!onboardingExistingUser && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep("account")}
                    disabled={loading}
                  >
                    Back
                  </Button>
                )}
                <Button type="submit" className="flex-1" disabled={loading}>
                  {loading ? "Creating workspace..." : "Launch AI rep"}
                </Button>
              </div>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {onboardingExistingUser ? (
              <>
                Signed in as {email}.{" "}
                <Link href="/login" className="text-primary hover:underline">
                  Use a different account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link href="/login" className="text-primary hover:underline">
                  Log in
                </Link>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
