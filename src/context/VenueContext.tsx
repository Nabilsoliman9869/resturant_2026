import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { normalizeVenueType, readCachedVenueType, VENUE_STORAGE_KEY, type VenueType } from "../lib/venueType";

type VenueContextValue = {
  venueType: VenueType;
  venueName: string;
  ready: boolean;
  refresh: () => Promise<void>;
};

const VenueContext = createContext<VenueContextValue | null>(null);

export function VenueProvider({ children }: { children: ReactNode }) {
  const cached = readCachedVenueType();
  const [venueType, setVenueType] = useState<VenueType>(cached ?? "restaurant");
  const [venueName, setVenueName] = useState<string>("");
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const base = getApiBase();
    const r = await fetch(`${base}/api/restaurant/venue`);
    const j = tryParseJson<{ venueType?: string; venueName?: string }>(await r.text());
    const vt = normalizeVenueType(j?.venueType);
    const vn = String(j?.venueName || "").trim();
    setVenueType(vt);
    setVenueName(vn);
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

  const value = useMemo(() => ({ venueType, venueName, ready, refresh }), [venueType, venueName, ready, refresh]);

  return <VenueContext.Provider value={value}>{children}</VenueContext.Provider>;
}

export function useVenue(): VenueContextValue {
  const ctx = useContext(VenueContext);
  if (!ctx) {
    throw new Error("useVenue must be used within VenueProvider");
  }
  return ctx;
}
