"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import type { Lead, LeadStatus } from "@/types/database";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "engaged", label: "Engaged" },
  { value: "payment_pending", label: "Payment pending" },
  { value: "locked_in", label: "Locked in" },
];

export function LeadEditForm({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState(lead.first_name ?? "");
  const [lastName, setLastName] = useState(lead.last_name ?? "");
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [appointmentReason, setAppointmentReason] = useState(
    lead.appointment_reason ?? lead.intent ?? ""
  );
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [scopeConfirmed, setScopeConfirmed] = useState(lead.scope_confirmed);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!phone.trim() && !email.trim()) {
      toast.error("Phone or email is required");
      return;
    }

    setSaving(true);

    const response = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        appointment_reason: appointmentReason.trim() || null,
        status,
        scope_confirmed: scopeConfirmed,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409 && data.existing_lead_id) {
        toast.error(data.error ?? "This contact already exists on another lead", {
          action: {
            label: "View lead",
            onClick: () =>
              router.push(`/dashboard/leads/${data.existing_lead_id}`),
          },
        });
      } else {
        toast.error(data.error ?? "Failed to update lead");
      }
    } else {
      toast.success("Lead updated");
      router.refresh();
    }

    setSaving(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Edit lead</CardTitle>
        <CardDescription>Update contact details and status.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first_name">First name</Label>
              <Input
                id="first_name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last name</Label>
              <Input
                id="last_name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="appointment_reason">Reason for appointment</Label>
            <textarea
              id="appointment_reason"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={appointmentReason}
              onChange={(event) => setAppointmentReason(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as LeadStatus)
                }
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <input
                id="scope_confirmed"
                type="checkbox"
                checked={scopeConfirmed}
                onChange={(event) => setScopeConfirmed(event.target.checked)}
              />
              <Label htmlFor="scope_confirmed">In scope (verified)</Label>
            </div>
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
