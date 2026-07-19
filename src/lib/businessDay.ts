/** يوم تشغيلي للمطعم: من 10:00 حتى 04:00 اليوم التالي (وليس منتصف الليل التقويمي). */

export type BusinessDayWindow = {
  /** تاريخ بداية اليوم التشغيلي (YYYY-MM-DD) */
  businessDay: string;
  /** بداية النافذة (10:00) */
  start: Date;
  /** نهاية الخدمة (04:00 اليوم التالي) */
  serviceEnd: Date;
  /** نهاية اليوم التشغيلي للعرض/الجلسات (10:00 اليوم التالي) */
  nextOpen: Date;
  labelAr: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function formatBusinessDayYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function getBusinessDayWindow(now = new Date()): BusinessDayWindow {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // قبل 10 ص → ما زلنا في يوم الأمس التشغيلي
  const startDate = now.getHours() < 10 ? new Date(base.getTime() - 24 * 60 * 60 * 1000) : base;
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 10, 0, 0, 0);
  const serviceEnd = new Date(start.getTime() + 18 * 60 * 60 * 1000); // +18h → 04:00
  const nextOpen = new Date(start.getTime() + 24 * 60 * 60 * 1000); // +24h → 10:00 التالي
  const businessDay = formatBusinessDayYmd(start);
  return {
    businessDay,
    start,
    serviceEnd,
    nextOpen,
    labelAr: `يوم تشغيلي ${businessDay} (10:00 → 04:00)`,
  };
}

/** هل الطابع الزمني ضمن اليوم التشغيلي الحالي (من 10 ص حتى 10 ص التالي)؟ */
export function isInCurrentBusinessDay(iso?: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  const w = getBusinessDayWindow(now);
  return d >= w.start && d < w.nextOpen;
}
