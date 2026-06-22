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

type PhoneRecord = {
  phone_number: string;
  phone_display: string;
  channel: "sms" | "voice" | "both";
};

export function BusinessPhoneCard({
  canManage,
  appOrigin,
  orgId,
  onSaved,
}: {
  canManage: boolean;
  appOrigin: string;
  orgId?: string;
  onSaved?: (phoneDisplay: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState<PhoneRecord | null>(null);
  const [phoneInput, setPhoneInput] = useState("");

  useEffect(() => {
    fetch("/api/organizations/phones")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load phone number");
        }
        setPhone(data.phone ?? null);
        setPhoneInput(data.phone?.phone_number ?? "");
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Failed to load phone number"
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !phoneInput.trim()) return;

    setSaving(true);
    const response = await fetch("/api/organizations/phones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_number: phoneInput.trim(),
        channel: "both",
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Could not save phone number");
    } else {
      setPhone(data.phone);
      setPhoneInput(data.phone.phone_number);
      onSaved?.(data.phone.phone_display);
      toast.success("Business phone saved");
    }
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business phone</CardTitle>
        <CardDescription>
          Inbound calls and texts to this number are routed to your business.
          Use E.164 format, e.g. <code className="text-xs">+13217858961</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading phone number...</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="business_phone">Primary phone number</Label>
              <Input
                id="business_phone"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                placeholder="+13217858961"
                disabled={!canManage || saving}
                required
              />
              {phone?.phone_display && (
                <p className="text-xs text-muted-foreground">
                  Currently saved as {phone.phone_display}
                </p>
              )}
            </div>
            {canManage && (
              <Button type="submit" disabled={saving || !phoneInput.trim()}>
                {saving ? "Saving..." : "Save phone number"}
              </Button>
            )}
          </form>
        )}

        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">Webhook URLs</p>
          <p>SMS (Twilio): POST {appOrigin}/api/twilio/inbound</p>
          <p>Voice (Twilio): POST {appOrigin}/api/twilio/voice</p>
          <p>
            Voice (Vapi — routes by business phone): {appOrigin}/api/vapi/webhook
          </p>
          {orgId && (
            <p>
              Voice (Vapi — direct to your org, recommended):{" "}
              {appOrigin}/api/vapi/{orgId}/webhook
            </p>
          )}
          {orgId && (
            <div className="rounded border border-border/60 bg-background p-3 space-y-2">
              <p className="font-medium text-foreground">Vapi setup checklist</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Server URL:{" "}
                  <code className="text-[11px] break-all">
                    {appOrigin}/api/vapi/{orgId}/webhook
                  </code>
                </li>
                <li>
                  Server messages: <code className="text-[11px]">end-of-call-report</code>,{" "}
                  <code className="text-[11px]">status-update</code>
                </li>
                <li>Save your Vapi number above as the business phone.</li>
                <li>Run Supabase migration 015_voice_calls.sql if not applied.</li>
              </ol>
              <p className="text-[11px]">
                Vapi sends POST requests after each call. Opening the webhook URL in a browser may
                show 405 until the latest app version is deployed — that is normal.
              </p>
            </div>
          )}
          <p className="pt-1 border-t border-border/60">
            In Vapi → Assistant → Server URL, paste the org webhook above (POST only — no{" "}
            <code className="text-[11px]">GET</code> in the browser). Enable Server Messages:{" "}
            <code className="text-[11px]">end-of-call-report</code> and{" "}
            <code className="text-[11px]">status-update</code>. If{" "}
            <code className="text-[11px]">VAPI_WEBHOOK_SECRET</code> is in Vercel, match it in Vapi
            (X-Vapi-Secret header, no Bearer prefix).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
