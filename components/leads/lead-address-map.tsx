"use client";

import Link from "next/link";
import { ExternalLink, MapPin } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  buildGoogleMapsEmbedUrl,
  buildGoogleMapsSearchUrl,
  googleMapsConfigured,
} from "@/lib/maps/google-maps";

export function LeadAddressMap({ address }: { address: string | null | undefined }) {
  const trimmed = address?.trim();

  if (!trimmed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service address</CardTitle>
          <CardDescription>
            Add a service address to see the job location on Google Maps.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const mapsUrl = buildGoogleMapsSearchUrl(trimmed);
  const embedUrl = buildGoogleMapsEmbedUrl(trimmed);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Service address</CardTitle>
            <CardDescription className="mt-1 flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{trimmed}</span>
            </CardDescription>
          </div>
          <Link
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open in Maps
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border bg-muted/20">
          <iframe
            title={`Map for ${trimmed}`}
            src={embedUrl}
            className="aspect-[4/3] w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>
        {!googleMapsConfigured() && (
          <p className="mt-2 text-xs text-muted-foreground">
            Set <code className="text-[11px]">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
            in Vercel for official Google Maps embeds and address autocomplete.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
