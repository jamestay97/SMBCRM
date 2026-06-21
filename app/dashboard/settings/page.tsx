"use client";

import { useEffect, useState } from "react";
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
import type { Organization, OrgMemberRole } from "@/types/database";
import { BootstrapAdminCard } from "@/components/admin/bootstrap-admin-card";
import { CustomerContactLinkCard } from "@/components/settings/customer-contact-link-card";
import { ServicesScopeTagsInput } from "@/components/settings/services-scope-tags-input";
import {
  servicesScopeToTags,
  tagsToServicesScope,
} from "@/lib/leads/services-scope-tags";

export default function SettingsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [role, setRole] = useState<OrgMemberRole>("member");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serviceTags, setServiceTags] = useState<string[]>([]);
  const [primaryPhone, setPrimaryPhone] = useState<string | null>(null);

  const canManage = role === "owner" || role === "admin";

  useEffect(() => {
    fetch("/api/organizations")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load settings");
        }
        setOrg(data.organization ?? null);
        if (data.organization?.services_scope) {
          setServiceTags(servicesScopeToTags(data.organization.services_scope));
        }
        if (data.primary_phone) setPrimaryPhone(data.primary_phone);
        if (data.role) setRole(data.role);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load settings");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || !canManage) return;

    const formData = new FormData(event.currentTarget);
    const depositDollars = parseFloat(String(formData.get("deposit")));
    if (!Number.isFinite(depositDollars) || depositDollars <= 0) {
      toast.error("Enter a valid deposit amount");
      return;
    }
    const depositCents = Math.round(depositDollars * 100);
    const servicesScope = tagsToServicesScope(serviceTags);

    if (!servicesScope || servicesScope.length < 10) {
      toast.error("Add at least one service (e.g. sink repairs, tiling)");
      return;
    }

    setSaving(true);
    const response = await fetch("/api/organizations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_name: formData.get("business_name"),
        ai_system_prompt: formData.get("ai_system_prompt"),
        services_scope: servicesScope,
        deposit_amount_cents: depositCents,
        stripe_account_id: String(formData.get("stripe_account_id") || "") || null,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Save failed");
    } else {
      setOrg(data.organization);
      setServiceTags(servicesScopeToTags(data.organization.services_scope));
      toast.success("Settings saved");
    }
    setSaving(false);
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading settings...</p>;
  }

  if (loadError) {
    return <p className="text-destructive">{loadError}</p>;
  }

  if (!org) {
    return <p className="text-muted-foreground">Organization not found.</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure your AI rep, services scope, deposit amount, and Stripe Connect account.
        </p>
      </div>

      {!canManage && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Only workspace owners and admins can edit these settings.
        </div>
      )}

      <CustomerContactLinkCard
        publicSlug={org.public_slug}
        phoneDisplay={primaryPhone}
      />

      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>
            Org ID: <code className="text-xs">{org.id}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="business_name">Business name</Label>
              <Input
                id="business_name"
                name="business_name"
                defaultValue={org.business_name}
                required
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai_system_prompt">AI system prompt</Label>
              <textarea
                id="ai_system_prompt"
                name="ai_system_prompt"
                className="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                defaultValue={org.ai_system_prompt}
                required
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="services_scope">Services scope</Label>
              <ServicesScopeTagsInput
                id="services_scope"
                tags={serviceTags}
                onChange={setServiceTags}
                disabled={!canManage}
                placeholder="e.g. sink repairs, tiling, pool cleaning"
              />
              <p className="text-xs text-muted-foreground">
                Type a service and press comma to add a tag. Hover a tag to remove it.
                The AI uses these to confirm a customer&apos;s request is something you handle
                before booking.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deposit">Deposit amount (USD)</Label>
              <Input
                id="deposit"
                name="deposit"
                type="number"
                min="1"
                step="0.01"
                defaultValue={(org.deposit_amount_cents / 100).toFixed(2)}
                required
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stripe_account_id">Stripe Connect account ID (optional)</Label>
              <Input
                id="stripe_account_id"
                name="stripe_account_id"
                defaultValue={org.stripe_account_id ?? ""}
                placeholder="acct_..."
                disabled={!canManage}
              />
            </div>
            {canManage && (
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <BootstrapAdminCard />
    </div>
  );
}
