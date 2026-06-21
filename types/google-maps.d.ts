declare namespace google.maps.places {
  class Autocomplete {
    constructor(
      input: HTMLInputElement,
      opts?: { fields?: string[]; types?: string[] }
    );
    addListener(event: string, handler: () => void): MapsEventListener;
    getPlace(): {
      formatted_address?: string;
      geometry?: { location?: { lat(): number; lng(): number } };
    };
  }
}

declare namespace google.maps {
  interface MapsEventListener {
    remove(): void;
  }

  namespace event {
    function clearInstanceListeners(instance: unknown): void;
  }
}

declare const google: {
  maps: {
    places: typeof google.maps.places;
    event: typeof google.maps.event;
  };
};

interface Window {
  google?: typeof google;
}
