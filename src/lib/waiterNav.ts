/** تنقل الجرسون — مصدر واحد للمسارات والقائمة */

export const WAITER_BASE = "/app/waiter";

/** نقطة البداية بعد الدخول والمقدمة */
export const WAITER_HUB_PATH = `${WAITER_BASE}/tables`;

export type WaiterNavItem = { to: string; label: string; hint?: string };

/** ترتيب التشغيل: شريحات → لوحة → استلام → بار (الطلب من الشريحة فقط) */
export const WAITER_NAV_ITEMS: WaiterNavItem[] = [
  { to: "tables", label: "شريحات الطاولات", hint: "اختر طاولة وابدأ الطلب" },
  { to: "delivery-order", label: "طلب دليفري", hint: "عميل دليفري بدون حجز طاولة صالة" },
  { to: "dashboard", label: "لوحة الصالة", hint: "ملخص ومخطط حي" },
  { to: "runner", label: "استلام من المطبخ", hint: "جاهز للتقديم" },
  { to: "pos", label: "طلب سريع (بار)", hint: "بدون طاولة" },
];

export function waiterNavDest(to: string): string {
  return `${WAITER_BASE}/${to.replace(/^\//, "")}`;
}
