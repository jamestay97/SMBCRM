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
import { AddressAutocompleteInput } from "@/components/leads/address-autocomplete-input";

export function CreateLeadForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [initialMessage, setInitialMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    if (!trimmedPhone && !trimmedEmail) {
      toast.error("Enter a phone number or email so the AI can reach this lead");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: trimmedPhone || undefined,
          email: trimmedEmail || undefined,
          service_address: serviceAddress.trim() || undefined,
          initial_message: initialMessage || undefined,
          send_sms: Boolean(trimmedPhone),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.existing_lead_id) {
          toast.error(data.error ?? "This lead already exists", {
            action: {
              label: "View lead",
              onClick: () =>
                router.push(`/dashboard/leads/${data.existing_lead_id}`),
            },
          });
          return;
        }
        throw new Error(data.error ?? "Failed to create lead");
      }

      toast.success("Lead created — AI rep is engaging now");
      router.push(`/dashboard/leads/${data.leadId}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Lead</CardTitle>
        <CardDescription>
          Creates a lead, starts an Ollama AI conversation, and begins outreach.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+15551234567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="service_address">Service address (optional)</Label>
            <AddressAutocompleteInput
              id="service_address"
              value={serviceAddress}
              onChange={setServiceAddress}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">Initial message (optional)</Label>
            <Input
              id="message"
              value={initialMessage}
              onChange={(e) => setInitialMessage(e.target.value)}
              placeholder="Hi, I need a roof inspection..."
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Starting AI rep..." : "Create & engage lead"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
