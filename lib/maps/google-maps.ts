export function getGoogleMapsApiKey(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || null;
}

export function googleMapsConfigured(): boolean {
  return Boolean(getGoogleMapsApiKey());
}

export function buildGoogleMapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    address.trim()
  )}`;
}

export function buildGoogleMapsEmbedUrl(
  address: string,
  apiKey?: string | null
): string {
  const trimmed = address.trim();
  const query = encodeURIComponent(trimmed);
  const key = apiKey ?? getGoogleMapsApiKey();

  if (key) {
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(
      key
    )}&q=${query}`;
  }

  return `https://maps.google.com/maps?q=${query}&output=embed`;
}

export function buildGoogleMapsScriptUrl(apiKey: string): string {
  const params = new URLSearchParams({
    key: apiKey,
    libraries: "places",
  });
  return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
}
