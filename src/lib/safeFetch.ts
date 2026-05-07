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

export async function safeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { cache: "no-store", ...(init || {}) });
  } catch {
    return networkErrorResponse();
  }
}

export function briefNetworkHint(errOrMessage: unknown): string {
  const s = String(errOrMessage || "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(s)) {
    return "لا يوجد اتصال بخادم API (المنافذ: تشغّل run_api.bat → 2288، والواجهة Vite → 9999). جرّب فتح http://127.0.0.1:2288/api/ping ثم حدّث الصفحة.";
  }
  return s;
}
