/** توقيت تشغيل المطعم — يطابق MAT3AM_TZ في الخادم (افتراضي القاهرة). */
export const MAT3AM_TIME_ZONE = "Africa/Cairo";

/**
 * يحوّل طابع ISO إلى Date صحيح.
 * - إن وُجدت منطقة زمنية (Z أو ±HH:MM) تُحترم.
 * - الطوابع بدون منطقة (شائعة من Railway سابقاً كـ UTC ساذج) تُعامل كـ UTC.
 */
export function parseMat3amInstant(iso?: string | null): Date | null {
  const raw = String(iso || "").trim();
  if (!raw) return null;
  let s = raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    // microseconds from Python isoformat — قصّها قبل إضافة Z
    s = s.replace(/(\.\d{3})\d+/, "$1");
    if (!s.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(s)) s = `${s}Z`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatMat3amClock(iso?: string | null, opts?: { withSeconds?: boolean }): string {
  const d = parseMat3amInstant(iso);
  if (!d) return "";
  try {
    return d.toLocaleTimeString("ar-EG", {
      timeZone: MAT3AM_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: opts?.withSeconds ? "2-digit" : undefined,
      hour12: true,
    });
  } catch {
    return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true });
  }
}

export function formatMat3amDateTime(iso?: string | null): string {
  const d = parseMat3amInstant(iso);
  if (!d) return "";
  try {
    return d.toLocaleString("ar-EG", {
      timeZone: MAT3AM_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return d.toLocaleString("ar-EG");
  }
}
