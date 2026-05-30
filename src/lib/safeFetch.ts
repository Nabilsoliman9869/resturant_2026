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

// #region debug-point A:network-report
function reportDebugEvent(hypothesisId: string, location: string, msg: string, data?: Record<string, unknown>) {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "api-disconnect-slow-items",
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data: data || {},
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

export async function safeFetch(input: string | URL, init?: SafeFetchInit): Promise<Response> {
  const { timeoutMs, ...rest } = init || {};
  const ctrl = timeoutMs != null && timeoutMs > 0 ? new AbortController() : undefined;
  const timer =
    ctrl && timeoutMs != null ? window.setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
  const url = String(input || "");
  const startedAt = Date.now();
  try {
    const r = await fetch(input, { cache: "no-store", ...rest, signal: ctrl?.signal ?? rest.signal });
    // #region debug-point C:slow-response
    const elapsedMs = Date.now() - startedAt;
    if (url.includes("/api/") && elapsedMs >= 1200) {
      reportDebugEvent("C", "safeFetch.ts", "slow api response", {
        url,
        status: r.status,
        ok: r.ok,
        elapsedMs,
        method: String(rest.method || "GET"),
      });
    }
    // #endregion
    return r;
  } catch (err) {
    // #region debug-point A:network-failure
    reportDebugEvent("A", "safeFetch.ts", "network failure", {
      url,
      method: String(rest.method || "GET"),
      timeoutMs: timeoutMs ?? null,
      elapsedMs: Date.now() - startedAt,
      error: String(err || ""),
      aborted: Boolean(ctrl?.signal?.aborted),
    });
    // #endregion
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
