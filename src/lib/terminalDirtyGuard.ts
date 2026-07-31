/**
 * تسجيل حالة «جلسة غير محفوظة» من شاشات الطلبات
 * ليستخدمها تبديل الكابتن عبر قارئ البطاقات.
 */

export type TerminalDirtyState = {
  dirty: boolean;
  /** وصف مختصر لما سيُفقد (مثلاً: سلة طلبات) */
  detail?: string;
};

type DirtyChecker = () => TerminalDirtyState;

let checker: DirtyChecker | null = null;

export function setTerminalDirtyChecker(fn: DirtyChecker | null) {
  checker = fn;
}

export function getTerminalDirtyState(): TerminalDirtyState {
  try {
    return checker?.() || { dirty: false };
  } catch {
    return { dirty: false };
  }
}

/** يُطلق بعد تبديل مستخدم الجهاز المشترك ليصفّر المسودات المحلية. */
export const TERMINAL_USER_SWITCHED_EVENT = "mat3am:terminal-user-switched";

export function notifyTerminalUserSwitched(detail: { fromUserId?: string; toUserId?: string; toName?: string }) {
  try {
    window.dispatchEvent(new CustomEvent(TERMINAL_USER_SWITCHED_EVENT, { detail }));
  } catch {
    /* تجاهل */
  }
}
