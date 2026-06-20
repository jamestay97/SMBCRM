"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function BootstrapAdminCard() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleBootstrap() {
    setLoading(true);
    const response = await fetch("/api/admin/bootstrap", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      toast.error(data.error ?? "Bootstrap failed");
    } else {
      toast.success(data.message ?? "Admin access granted");
      router.push("/admin");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform admin access</CardTitle>
        <CardDescription>
          If your email is listed in PLATFORM_ADMIN_EMAILS, claim super-admin access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleBootstrap} disabled={loading}>
          {loading ? "Granting..." : "Become platform admin"}
        </Button>
      </CardContent>
    </Card>
  );
}
