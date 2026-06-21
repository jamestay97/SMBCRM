"use client";

import { useEffect, useState } from "react";
import {
  buildGoogleMapsScriptUrl,
  getGoogleMapsApiKey,
} from "@/lib/maps/google-maps";

let loaderPromise: Promise<void> | null = null;

function loadGoogleMapsScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.google?.maps?.places) {
    return Promise.resolve();
  }

  if (loaderPromise) {
    return loaderPromise;
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.resolve();
  }

  loaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps="true"]'
    );

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Maps failed to load")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = buildGoogleMapsScriptUrl(apiKey);
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });

  return loaderPromise;
}

export function useGoogleMapsPlacesReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getGoogleMapsApiKey()) {
      return;
    }

    loadGoogleMapsScript()
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, []);

  return ready;
}
