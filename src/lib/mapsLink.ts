/** استخراج رابط خرائط جوجل من نص ملصوق (واتساب / مشاركة الموقع). */

const MAPS_HOST_RE =
  /(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+|www\.google\.[a-z.]+\/maps|google\.[a-z.]+\/maps)[^\s<>"']*/i;

export function extractMapsUrl(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const m = raw.match(MAPS_HOST_RE);
  if (!m) return null;
  let url = m[0].replace(/[)\].,;]+$/g, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const ok =
      host === "maps.app.goo.gl" ||
      host === "goo.gl" ||
      host.startsWith("maps.google.") ||
      ((host === "google.com" || host.endsWith(".google.com") || host.startsWith("www.google.")) &&
        u.pathname.toLowerCase().includes("/maps"));
    if (!ok) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** محاولة قراءة lat/lng من رابط خرائط مكتمل (بدون اختصار). */
export function parseCoordsFromMapsUrl(url: string): { lat: number; lng: number } | null {
  try {
    const u = new URL(url);
    const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
    const q = u.searchParams.get("q") || u.searchParams.get("query") || "";
    const qm = q.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (qm) return { lat: Number(qm[1]), lng: Number(qm[2]) };
    const ll = u.searchParams.get("ll");
    if (ll) {
      const parts = ll.split(",");
      if (parts.length >= 2) return { lat: Number(parts[0]), lng: Number(parts[1]) };
    }
    // !3dLAT!4dLNG داخل data=
    const data = u.searchParams.get("data") || u.href;
    const bang = data.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (bang) return { lat: Number(bang[1]), lng: Number(bang[2]) };
  } catch {
    /* ignore */
  }
  return null;
}
