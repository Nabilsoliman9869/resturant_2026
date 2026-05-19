/** fetch لا يرمي عند قطع الشبكة/رفض الاتصال — يُرجَع كائن يحاكي Response بـ status 0 للتشخيص في الواجهة.
 *
 * ملاحظة مهمة: لا يُسمح في معيار Web بإنشاء `new Response("", { status: 0 })` (النطاق المسموح 200–599)،
 * لذا نُرجع كائناً duck-typed يطابق الواجهة المستخدمة في المشروع (`ok`, `status`, `statusText`, `text`, `json`).
 */

export function networkErrorResponse(statusText: string = "NETWORK"): Response {
  const fake = {
    ok: false as const,
    status: 0 as const,
    statusText,
    text: async () => "",
    json: async () => ({}),
  };
  return fake as unknown as Response;
}

export type SafeFetchInit = RequestInit & { timeoutMs?: number };

export async function safeFetch(input: string | URL, init?: SafeFetchInit): Promise<Response> {
  const { timeoutMs, ...rest } = init || {};
  const ctrl = timeoutMs != null && timeoutMs > 0 ? new AbortController() : undefined;
  const timer =
    ctrl && timeoutMs != null ? window.setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
  try {
    const r = await fetch(input, { cache: "no-store", ...rest, signal: ctrl?.signal ?? rest.signal });
    return r;
  } catch {
    return networkErrorResponse();
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

export function briefNetworkHint(errOrMessage: unknown): string {
  const s = String(errOrMessage || "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(s)) {
    return "لا يوجد اتصال بخادم API (المنافذ: تشغّل run_api.bat → 2288، والواجهة Vite → 9999). جرّب فتح http://127.0.0.1:2288/api/ping ثم حدّث الصفحة.";
  }
  return s;
}
