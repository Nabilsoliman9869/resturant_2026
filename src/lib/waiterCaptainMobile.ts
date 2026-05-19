/** تدفق الكابتن — جوال داخل «طلب للطاولة» فقط (≤900px) */

export type CaptainMobileTab = "table" | "guests" | "menu" | "cart" | "sent";

export const CAPTAIN_MOBILE_TABS: {
  id: CaptainMobileTab;
  label: string;
  title: string;
  emoji: string;
}[] = [
  { id: "table", label: "طاولة", title: "الطاولة والجلسة وخيارات متقدمة", emoji: "🪑" },
  { id: "guests", label: "ضيوف", title: "تعريف أسماء الضيوف على المقاعد", emoji: "👥" },
  { id: "menu", label: "منيو", title: "فئات وأصناف للمقعد المختار", emoji: "📋" },
  { id: "cart", label: "سلة", title: "قيد الإرسال قبل المطبخ", emoji: "🛒" },
  { id: "sent", label: "مرسل", title: "طلبات مرسلة والإجماليات", emoji: "✓" },
];

export const CAPTAIN_TAB_SECTIONS: Record<CaptainMobileTab, string[]> = {
  table: ["waiter-ot-sec-table", "waiter-ot-sec-navopts"],
  guests: ["waiter-ot-sec-distribute"],
  menu: ["waiter-ot-sec-categories", "waiter-ot-sec-search", "waiter-ot-sec-grid"],
  cart: ["waiter-ot-sec-pending"],
  sent: ["waiter-ot-sec-sent", "waiter-ot-sec-totals"],
};

export function captainDockSeatsFromLabels(
  labels: Record<number, string>,
  slotCount: number,
  sharedSeatNo: number,
): number[] {
  const named: number[] = [];
  for (let i = 1; i <= slotCount; i++) {
    if (String(labels[i] ?? "").trim().length > 0) named.push(i);
  }
  return [...named, sharedSeatNo];
}

export function captainShowsGuestDock(tab: CaptainMobileTab, perSeat: boolean, dockSeats: readonly number[]): boolean {
  if (!perSeat || dockSeats.length === 0) return false;
  return tab === "guests" || tab === "menu" || tab === "cart";
}
