/**
 * عنوان أساس موحّد لجميع طلبات API من الواجهة.
 * - على Vite dev (9999 / 5290) نستخدم نفس المنشأ أولاً حتى يمرّ /api عبر البروكسي — حتى لو وُجد VITE_XTRA_API
 *   يشير لخادم قديم (سبب شائع لرسالة «مستخدم غير موجود» مع dev).
 * - خارج منافذ التطوير: إن وُجد VITE_XTRA_API يُستخدم.
 * - على خادم واجهة محلي بدون env نتصل بـ 127.0.0.1:2288.
 */
export function getApiBase(): string {
  const fromEnv = String(import.meta.env.VITE_XTRA_API || "").replace(/\/$/, "");
  const { hostname, port, protocol } = window.location;

  /** فتح الواجهة من القرص (file:) — لا بروكسي Vite؛ عنوان الـ API من env أو 2288 محلياً */
  if (protocol === "file:") {
    return fromEnv || "http://127.0.0.1:2288";
  }

  const isLocal = hostname === "127.0.0.1" || hostname === "localhost";
  const p = port || "";
  /** منافذ Vite — دائماً نفس المنشأ (بروكسي /api) حتى من جوال على 192.168.x.x:9999 */
  const viteProxyPorts = new Set(["9999", "5290"]);
  if (viteProxyPorts.has(p)) {
    return window.location.origin.replace(/\/$/, "");
  }
  if (fromEnv) return fromEnv;
  if (isLocal && p && p !== "2288") {
    return `${protocol}//127.0.0.1:2288`;
  }
  return window.location.origin.replace(/\/$/, "");
}

/** اسم قديم للتوافق مع صفحات ما زالت تستدعي `apiBase()` — يفضّل استخدام `getApiBase` فقط */
export function apiBase(): string {
  return getApiBase();
}
