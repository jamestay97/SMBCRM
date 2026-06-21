"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

export default function NewTenantPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const depositDollars = parseFloat(String(form.get("deposit")));

    const response = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_name: form.get("business_name"),
        ai_system_prompt: form.get("ai_system_prompt"),
        deposit_amount_cents: Math.round(depositDollars * 100),
        owner_email: form.get("owner_email"),
        owner_password: form.get("owner_password"),
        plan_id: form.get("plan_id") || "starter",
        llm_provider: form.get("llm_provider") || "ollama",
        llm_model: form.get("llm_model") || undefined,
        phone_number: form.get("phone_number") || undefined,
        twilio_sid: form.get("twilio_sid") || undefined,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Failed to create tenant");
      setLoading(false);
      return;
    }

    toast.success("Tenant created");
    router.push(`/admin/tenants/${data.org_id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Onboard tenant</h1>
        <p className="text-muted-foreground">
          Create a business, owner account, subscription, and optional Twilio number.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>
            Twilio webhook: POST {process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/twilio/inbound
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="business_name">Business name</Label>
              <Input id="business_name" name="business_name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai_system_prompt">AI system prompt</Label>
              <textarea
                id="ai_system_prompt"
                name="ai_system_prompt"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue="You are an AI sales rep. Qualify the lead, answer questions, and when they agree to book, collect a deposit."
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="deposit">Deposit (USD)</Label>
                <Input id="deposit" name="deposit" type="number" min="1" step="0.01" defaultValue="250" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan_id">Plan</Label>
                <Input id="plan_id" name="plan_id" defaultValue="starter" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="llm_provider">LLM provider</Label>
                <select
                  id="llm_provider"
                  name="llm_provider"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue="ollama"
                >
                  <option value="ollama">Ollama</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="llm_model">LLM model</Label>
                <Input id="llm_model" name="llm_model" placeholder="llama3.2" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="owner_email">Owner email</Label>
                <Input id="owner_email" name="owner_email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="owner_password">Owner password</Label>
                <Input id="owner_password" name="owner_password" type="password" minLength={8} required />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone_number">Twilio number (E.164)</Label>
                <Input id="phone_number" name="phone_number" placeholder="+15551234567" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="twilio_sid">Twilio SID (optional)</Label>
                <Input id="twilio_sid" name="twilio_sid" />
              </div>
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating..." : "Create tenant"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
