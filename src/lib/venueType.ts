/** نوع المنشأ — نفس نواة النظام، اختلاف افتراضيات وتسميات الواجهة */
export type VenueType = "restaurant" | "coffee_shop";

export const VENUE_STORAGE_KEY = "mat3am_venue_v1";

export function readCachedVenueType(): VenueType | null {
  try {
    const raw = sessionStorage.getItem(VENUE_STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { venueType?: string };
    return normalizeVenueType(j.venueType);
  } catch {
    return null;
  }
}

export function defaultOrderTypeForVenue(venue: VenueType): "table" | "takeaway" | "delivery" {
  return venue === "coffee_shop" ? "takeaway" : "table";
}

export function normalizeVenueType(raw: unknown): VenueType {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (s === "coffee_shop" || s === "coffeeshop" || s === "coffee" || s === "cafe" || s === "café") {
    return "coffee_shop";
  }
  return "restaurant";
}

export function venueBrandTitle(venue: VenueType): string {
  return venue === "coffee_shop" ? "كوفي شوب XTRA" : "مطاعم XTRA";
}

export function venuePosHint(venue: VenueType): string {
  return venue === "coffee_shop"
    ? "وضع كوفي: افتراضي «سفري»؛ يمكن التبديل إلى طاولة للجلوس."
    : "وضع مطعم: افتراضي «طاولة» للجلسة الداخلية والخدمة.";
}
