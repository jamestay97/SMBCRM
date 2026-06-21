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

type BootstrapAdminCardProps = {
  email?: string;
};

export function BootstrapAdminCard({ email }: BootstrapAdminCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleBootstrap() {
    setLoading(true);
    const response = await fetch("/api/admin/bootstrap", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      const message =
        data.error === "Email not in PLATFORM_ADMIN_EMAILS"
          ? "Your email is not in PLATFORM_ADMIN_EMAILS. Add it in Vercel, redeploy, then try again."
          : (data.error ?? "Bootstrap failed");
      toast.error(message);
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
          {email
            ? `Claim super-admin access for ${email}.`
            : "If your email is listed in PLATFORM_ADMIN_EMAILS, claim super-admin access."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={handleBootstrap} disabled={loading} className="w-full">
          {loading ? "Granting..." : "Become platform admin"}
        </Button>
        <p className="text-xs text-muted-foreground">
          After Vercel env changes, redeploy before clicking this button.
        </p>
      </CardContent>
    </Card>
  );
}
