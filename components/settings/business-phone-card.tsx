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
  onSaved,
}: {
  canManage: boolean;
  appOrigin: string;
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

        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Webhook URLs</p>
          <p>SMS (Twilio): POST {appOrigin}/api/twilio/inbound</p>
          <p>Voice (Twilio): POST {appOrigin}/api/twilio/voice</p>
          <p>
            Voice (Vapi — routes by this phone number): POST{" "}
            {appOrigin}/api/vapi/webhook
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
