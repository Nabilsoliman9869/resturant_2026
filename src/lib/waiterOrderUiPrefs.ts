import type { RoleId } from "../auth/roles";
import { WAITER_HUB_PATH } from "./waiterNav";



/** @deprecated — النموذج الموحّد فقط على الجوال؛ يُبقى للتوافق مع تخزين قديم */

export type OrderTakerMobileUi = "unified" | "classic" | "tabs";



export const ORDER_TAKER_UI_STORAGE_KEY = "mat3am_order_taker_ui_v2";



/** مقدمة تدفق الكابتن — مرة لكل جلسة متصفح */

export const WAITER_UI_PROMPT_SESSION_KEY = "mat3am_waiter_ui_prompt_done_v1";



export const WAITER_LAST_PATH_KEY = "mat3am_waiter_last_path_v1";



/** نافذة المقدمة — جرسون الطلبات فقط */

export function roleUsesWaiterOrderUiStyle(role: RoleId | string | undefined): boolean {

  return String(role || "").trim().toLowerCase() === "waiter";

}



/** الجوال يستخدم دائماً التدفق الموحّد (لا اختيار بين نموذجين) */

export function readOrderTakerMobileUi(): OrderTakerMobileUi {

  return "unified";

}



export function saveOrderTakerMobileUi(_v: OrderTakerMobileUi): void {

  try {

    localStorage.setItem(ORDER_TAKER_UI_STORAGE_KEY, "unified");

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



export function waiterPathAfterStylePick(): string {

  const last = readWaiterLastPath();

  if (last && !last.startsWith("/app/waiter/order-taker")) return last;

  return WAITER_HUB_PATH;

}


