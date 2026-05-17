import { getApiBase } from "./apiBase";
import { safeFetch } from "./safeFetch";

/** الخادم الحي يدعم مرتجعات الضيوف (يُفحص عند فتح المودال) */
export async function probeGuestReturnsApi(): Promise<boolean> {
  const base = getApiBase();
  try {
    const r = await safeFetch(`${base}/api/restaurant/guest-return-reasons`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

export function guestReturnApiErrorMessage(status: number, detail: string): string {
  const d = (detail || "").trim();
  if (status === 404 || /not found/i.test(d)) {
    return (
      "مسار مرتجعات الضيوف غير متاح على خادم API الحالي (404). " +
      "أوقف نافذة API القديمة ثم شغّل من مجلد مطاعم: run_api.bat أو run_full_stack.bat، " +
      "وتأكد من http://127.0.0.1:2288/__whoami__ يظهر FEATURE_GUEST_RETURNS=1 و VERIFY_SCHEMA_REVISION=11."
    );
  }
  if (status === 0) return d || "لا اتصال بخادم API";
  return d || `خطأ من الخادم (HTTP ${status})`;
}
