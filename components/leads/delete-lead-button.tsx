"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DeleteLeadButton({
  leadId,
  leadName,
  redirectTo = "/dashboard/leads",
  variant = "destructive",
  size = "default",
}: {
  leadId: string;
  leadName: string;
  redirectTo?: string;
  variant?: "destructive" | "outline";
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete ${leadName}? This removes the lead, conversations, and related records.`
    );

    if (!confirmed) return;

    setDeleting(true);

    const response = await fetch(`/api/leads/${leadId}`, {
      method: "DELETE",
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Failed to delete lead");
      setDeleting(false);
      return;
    }

    toast.success("Lead deleted");
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleDelete}
      disabled={deleting}
    >
      {deleting ? "Deleting..." : "Delete"}
    </Button>
  );
}
