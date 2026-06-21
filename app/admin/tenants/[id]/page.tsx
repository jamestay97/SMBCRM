"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TenantWithRelations } from "@/types/database";

export default function AdminTenantDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    fetch(`/api/admin/tenants/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        setTenant(data.tenant ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) return;
    setSaving(true);

    const form = new FormData(event.currentTarget);
    const deposit = parseFloat(String(form.get("deposit")));

    const response = await fetch(`/api/admin/tenants/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_name: form.get("business_name"),
        ai_system_prompt: form.get("ai_system_prompt"),
        deposit_amount_cents: Math.round(deposit * 100),
        status: form.get("status"),
        llm_provider: form.get("llm_provider"),
        llm_model: form.get("llm_model") || null,
        sla_target_seconds: Number(form.get("sla_target_seconds")),
        subscription_status: form.get("subscription_status"),
        plan_id: form.get("plan_id"),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Save failed");
    } else {
      setTenant(data.tenant);
      toast.success("Tenant updated");
      router.refresh();
    }
    setSaving(false);
  }

  async function addPhone() {
    if (!newPhone.trim()) return;

    const response = await fetch(`/api/admin/tenants/${params.id}/phones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: newPhone.trim(), is_primary: true }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Failed to add phone");
      return;
    }

    setNewPhone("");
    const refresh = await fetch(`/api/admin/tenants/${params.id}`);
    const refreshed = await refresh.json();
    setTenant(refreshed.tenant);
    toast.success("Phone number added");
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading tenant...</p>;
  }

  if (!tenant) {
    return <p className="text-muted-foreground">Tenant not found.</p>;
  }

  const sub = Array.isArray(tenant.tenant_subscriptions)
    ? tenant.tenant_subscriptions[0]
    : tenant.tenant_subscriptions;

  const appOrigin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">{tenant.business_name}</h1>
        <Badge variant={tenant.status === "active" ? "success" : "warning"}>
          {tenant.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>Org ID: {tenant.id}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="business_name">Business name</Label>
              <Input id="business_name" name="business_name" defaultValue={tenant.business_name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai_system_prompt">AI prompt</Label>
              <textarea
                id="ai_system_prompt"
                name="ai_system_prompt"
                className="flex min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue={tenant.ai_system_prompt}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="deposit">Deposit (USD)</Label>
                <Input
                  id="deposit"
                  name="deposit"
                  type="number"
                  step="0.01"
                  defaultValue={(tenant.deposit_amount_cents / 100).toFixed(2)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sla_target_seconds">SLA (seconds)</Label>
                <Input
                  id="sla_target_seconds"
                  name="sla_target_seconds"
                  type="number"
                  defaultValue={tenant.sla_target_seconds ?? 300}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Org status</Label>
                <select
                  id="status"
                  name="status"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue={tenant.status ?? "active"}
                >
                  <option value="active">active</option>
                  <option value="onboarding">onboarding</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="llm_provider">LLM provider</Label>
                <select
                  id="llm_provider"
                  name="llm_provider"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue={tenant.llm_provider ?? "ollama"}
                >
                  <option value="ollama">ollama</option>
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="llm_model">LLM model</Label>
                <Input id="llm_model" name="llm_model" defaultValue={tenant.llm_model ?? ""} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="subscription_status">Subscription</Label>
                <select
                  id="subscription_status"
                  name="subscription_status"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue={sub?.status ?? "trialing"}
                >
                  <option value="trialing">trialing</option>
                  <option value="active">active</option>
                  <option value="past_due">past_due</option>
                  <option value="canceled">canceled</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan_id">Plan</Label>
                <Input id="plan_id" name="plan_id" defaultValue={sub?.plan_id ?? "starter"} />
              </div>
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhooks</CardTitle>
          <CardDescription>
            Configure these in Twilio / Vapi after deploying to Vercel (not GitHub Pages).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-xs break-all">
          <p>
            <span className="text-muted-foreground">SMS (all tenants): </span>
            POST {appOrigin}/api/twilio/inbound
          </p>
          <p>
            <span className="text-muted-foreground">Voice (AI receptionist): </span>
            POST {appOrigin}/api/twilio/voice
          </p>
          <p>
            <span className="text-muted-foreground">Customer page: </span>
            {tenant.public_slug ? (
              <a
                href={`${appOrigin}/b/${tenant.public_slug}`}
                className="text-primary underline"
                target="_blank"
                rel="noreferrer"
              >
                {appOrigin}/b/{tenant.public_slug}
              </a>
            ) : (
              "Save tenant to generate slug"
            )}
          </p>
          <p>
            <span className="text-muted-foreground">Voice (Vapi): </span>
            POST {appOrigin}/api/vapi/{tenant.id}/webhook
          </p>
          <p>
            <span className="text-muted-foreground">Stripe: </span>
            POST {appOrigin}/api/stripe/webhook
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Twilio numbers</CardTitle>
          <CardDescription>
            Assign the business Twilio number in E.164 (+1…). SMS replies go out from the primary number.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tenant.tenant_phone_numbers?.length ? (
            <ul className="space-y-2 text-sm">
              {tenant.tenant_phone_numbers.map((phone) => (
                <li key={phone.id} className="rounded-md border px-3 py-2">
                  {phone.phone_number}
                  {phone.is_primary ? " (primary)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No phone numbers assigned.</p>
          )}
          <div className="flex gap-2">
            <Input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="+15551234567"
            />
            <Button type="button" onClick={addPhone}>
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
