/**
 * إدارة بيانات Shared Terminal Mode محلياً (terminalId + terminalToken).
 *
 * - terminalId: ثابت لكل جهاز/متصفح (يُولَّد مرة ويُحفظ في localStorage).
 * - terminalToken: يُحفظ فقط في الذاكرة (window) — لا يُكتب على القرص — حتى لا
 *   يبقى نشطاً عبر إعادة تحميل الصفحة، ويتم استعادته عبر إدخال PIN جديد.
 *
 * `buildMat3amActor` تقرأ من هنا تلقائياً، لذا كل callsite قائم سيُمرِّر الـ token
 * بمجرد ضبطه — بدون لمس واجهات استدعاء كل صفحة.
 */

const TERMINAL_ID_KEY = "mat3am_terminal_id_v1";

declare global {
  interface Window {
    __mat3amTerminalToken?: string | null;
    __mat3amTerminalUserId?: string | null;
    __mat3amTerminalExpEpoch?: number | null;
  }
}

function genId(): string {
  // GUID-ish بدون اعتماد على crypto.randomUUID (لو غاب)
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `T-${rnd()}-${rnd()}-${rnd()}`.toUpperCase();
}

export function getTerminalId(): string {
  try {
    let id = localStorage.getItem(TERMINAL_ID_KEY);
    if (!id) {
      id = genId();
      localStorage.setItem(TERMINAL_ID_KEY, id);
    }
    return id;
  } catch {
    return "TERMINAL-UNKNOWN";
  }
}

export function setTerminalToken(token: string | null, expEpoch?: number | null, userId?: string | null) {
  if (typeof window === "undefined") return;
  window.__mat3amTerminalToken = token || null;
  window.__mat3amTerminalUserId = userId || null;
  window.__mat3amTerminalExpEpoch = expEpoch || null;
}

export function getTerminalToken(): string | null {
  if (typeof window === "undefined") return null;
  const tok = window.__mat3amTerminalToken || null;
  const exp = window.__mat3amTerminalExpEpoch || 0;
  if (tok && exp && exp > 0 && exp < Math.floor(Date.now() / 1000)) {
    setTerminalToken(null, null, null);
    return null;
  }
  return tok;
}

export function clearTerminalToken() {
  setTerminalToken(null, null, null);
}

export function getTerminalUserId(): string | null {
  return (typeof window !== "undefined" && window.__mat3amTerminalUserId) || null;
}
