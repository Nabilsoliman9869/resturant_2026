import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { normalizeVenueType, readCachedVenueType, VENUE_STORAGE_KEY, type VenueType } from "../lib/venueType";

type VenueContextValue = {
  venueType: VenueType;
  ready: boolean;
  refresh: () => Promise<void>;
};

const VenueContext = createContext<VenueContextValue | null>(null);

export function VenueProvider({ children }: { children: ReactNode }) {
  const cached = readCachedVenueType();
  const [venueType, setVenueType] = useState<VenueType>(cached ?? "restaurant");
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const base = getApiBase();
    const r = await fetch(`${base}/api/restaurant/venue`);
    const j = tryParseJson<{ venueType?: string }>(await r.text());
    const vt = normalizeVenueType(j?.venueType);
    setVenueType(vt);
    try {
      sessionStorage.setItem(VENUE_STORAGE_KEY, JSON.stringify({ venueType: vt }));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ venueType, ready, refresh }), [venueType, ready, refresh]);

  return <VenueContext.Provider value={value}>{children}</VenueContext.Provider>;
}

export function useVenue(): VenueContextValue {
  const ctx = useContext(VenueContext);
  if (!ctx) {
    throw new Error("useVenue must be used within VenueProvider");
  }
  return ctx;
}
