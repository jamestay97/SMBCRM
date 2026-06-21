"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { useGoogleMapsPlacesReady } from "@/components/maps/google-maps-loader";
import { googleMapsConfigured } from "@/lib/maps/google-maps";

type AddressAutocompleteInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
};

export function AddressAutocompleteInput({
  id,
  value,
  onChange,
  placeholder = "123 Main St, Orlando, FL 32801",
  disabled = false,
  required = false,
}: AddressAutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const placesReady = useGoogleMapsPlacesReady();
  const useAutocomplete = googleMapsConfigured() && placesReady;

  useEffect(() => {
    if (!useAutocomplete || !inputRef.current || typeof google === "undefined") {
      return;
    }

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      fields: ["formatted_address", "geometry"],
      types: ["address"],
    });

    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        onChange(place.formatted_address);
      }
    });

    return () => {
      listener.remove();
    };
  }, [useAutocomplete, onChange]);

  return (
    <Input
      ref={inputRef}
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      autoComplete={useAutocomplete ? "off" : "street-address"}
    />
  );
}
