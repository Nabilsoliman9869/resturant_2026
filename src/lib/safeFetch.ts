/** fetch لا يرمي عند قطع الشبكة/رفض الاتصال — يُرجَع Response بـ status 0 للتشخيص في الواجهة */
export async function safeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { cache: "no-store", ...(init || {}) });
  } catch {
    return new Response("", { status: 0, statusText: "NETWORK" });
  }
}

export function briefNetworkHint(errOrMessage: unknown): string {
  const s = String(errOrMessage || "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(s)) {
    return "لا يوجد اتصال بخادم API (المنافذ: تشغّل run_api.bat → 2288، والواجهة Vite → 9999). جرّب فتح http://127.0.0.1:2288/api/ping ثم حدّث الصفحة.";
  }
  return s;
}
