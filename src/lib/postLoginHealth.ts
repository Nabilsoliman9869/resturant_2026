import { getApiBase } from "./apiBase";

/**
 * بعد نجاح تسجيل الدخول: التحقق أن نفس خادم الـ API يجيب.
 * نستخدم `/api/ping` (خفيف جداً) بدل `/api/ready` لتفادي أي التباس مع البروكسي أو مسارات أخرى.
 */
export async function checkApiReadyAfterLogin(timeoutMs = 8000): Promise<boolean> {
  const base = getApiBase().replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/api/ping`, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    });
    window.clearTimeout(timer);
    if (!r.ok) return false;
    const j = (await r.json()) as { ok?: boolean };
    return j?.ok === true;
  } catch {
    window.clearTimeout(timer);
    return false;
  }
}
