"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildCustomerPagePath } from "@/lib/business/public-profile";

export function CustomerContactLinkCard({
  publicSlug,
  phoneDisplay,
  appOrigin,
}: {
  publicSlug: string | null | undefined;
  phoneDisplay?: string | null;
  appOrigin: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!publicSlug) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer contact page</CardTitle>
          <CardDescription>
            Save your settings to generate a public page for customers to call
            or text your AI receptionist.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const path = buildCustomerPagePath(publicSlug);
  const fullUrl = `${appOrigin}${path}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      toast.success("Customer link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer contact page</CardTitle>
        <CardDescription>
          Share this link on your website, Google Business profile, or social
          media. Customers can call or text your AI receptionist
          {phoneDisplay ? ` at ${phoneDisplay}` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <code className="block break-all rounded-md border bg-muted px-3 py-2 text-xs">
          {fullUrl}
        </code>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyLink}>
            <Copy className="mr-2 h-4 w-4" />
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={path} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Preview page
            </a>
          </Button>
        </div>
        {!phoneDisplay && (
          <p className="text-xs text-amber-700">
            Add your business phone above so the customer page shows Call and
            Text buttons.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
