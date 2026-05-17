import type { RoleId } from "../auth/roles";

/** شكل تنقّل «طلب للطاولة» على الجوال */
export type OrderTakerMobileUi = "classic" | "tabs";

export const ORDER_TAKER_UI_STORAGE_KEY = "mat3am_order_taker_ui_v1";

/** اختيار الستايل في هذه الجلسة (يُمسح عند تسجيل الخروج/دخول جديد) */
export const WAITER_UI_PROMPT_SESSION_KEY = "mat3am_waiter_ui_prompt_done_v1";

/** آخر مسار داخل تطبيق الجرسون (طاولات / طلب للطاولة + query) */
export const WAITER_LAST_PATH_KEY = "mat3am_waiter_last_path_v1";

export type WaiterUiStyleOption = {
  id: OrderTakerMobileUi;
  num: 1 | 2;
  title: string;
  description: string;
};

export const WAITER_UI_STYLE_OPTIONS: WaiterUiStyleOption[] = [
  {
    id: "classic",
    num: 1,
    title: "النموذج ١",
    description: "شريط جانبي للأقسام — تمرير وتنقل كلاسيكي (الوضع الحالي)",
  },
  {
    id: "tabs",
    num: 2,
    title: "النموذج ٢",
    description: "تبويبات سفلية — قسم واحد ظاهر + شريط إرسال ثابت (تجريبي)",
  },
];

/** أدوار تستخدم شاشة «طلب للطاولة» بنفس واجهة الجرسون */
export function roleUsesWaiterOrderUiStyle(role: RoleId | string | undefined): boolean {
  const r = String(role || "").trim().toLowerCase();
  return r === "waiter" || r === "manager" || r === "developer";
}

export function readOrderTakerMobileUi(): OrderTakerMobileUi {
  if (typeof window === "undefined") return "classic";
  try {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("orderUi");
    if (q === "tabs" || q === "classic") return q;
    const v = localStorage.getItem(ORDER_TAKER_UI_STORAGE_KEY);
    if (v === "tabs" || v === "classic") return v;
  } catch {
    /* ignore */
  }
  return "classic";
}

export function saveOrderTakerMobileUi(v: OrderTakerMobileUi): void {
  try {
    localStorage.setItem(ORDER_TAKER_UI_STORAGE_KEY, v);
  } catch {
    /* ignore */
  }
}

export function isWaiterUiPromptDoneThisSession(): boolean {
  try {
    return sessionStorage.getItem(WAITER_UI_PROMPT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWaiterUiPromptDone(): void {
  try {
    sessionStorage.setItem(WAITER_UI_PROMPT_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearWaiterUiPromptSession(): void {
  try {
    sessionStorage.removeItem(WAITER_UI_PROMPT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function saveWaiterLastPath(pathname: string, search = ""): void {
  const p = `${pathname || ""}${search || ""}`.trim();
  if (!p.startsWith("/app/waiter/")) return;
  try {
    localStorage.setItem(WAITER_LAST_PATH_KEY, p);
  } catch {
    /* ignore */
  }
}

export function readWaiterLastPath(): string | null {
  try {
    const p = localStorage.getItem(WAITER_LAST_PATH_KEY);
    if (!p || !p.startsWith("/app/waiter/")) return null;
    return p;
  } catch {
    return null;
  }
}

/** مسار افتراضي بعد اختيار الستايل — آخر وضع أو طلب للطاولة */
export function waiterPathAfterStylePick(): string {
  return readWaiterLastPath() || "/app/waiter/order-taker";
}
