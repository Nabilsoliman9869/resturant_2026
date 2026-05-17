/** أسباب مرتجع الضيف — مجموعات للعرض في واجهة الجرسون/المدير */
export type GuestReturnReason = {
  code: string;
  label: string;
  category: string;
};

export type GuestReturnDisposition = {
  code: string;
  label: string;
  hint?: string;
};

export const GUEST_RETURN_DISPOSITIONS: GuestReturnDisposition[] = [
  { code: "deduct_waiter", label: "تخصم على الويتر", hint: "مسؤولية خدمة الصالة" },
  { code: "deduct_kitchen", label: "تخصم على المطبخ", hint: "خطأ تحضير أو جودة" },
  { code: "shift_charge", label: "تحميل على الشيفت", hint: "تكلفة تشغيلية على الوردية" },
  { code: "stock_return", label: "ترجع للمخزون", hint: "صنف سليم غير م consumed (مشروب مغلق…)" },
];

/** القائمة الافتراضية — يمكن تخصيصها لاحقاً من API */
export const DEFAULT_GUEST_RETURN_REASONS: GuestReturnReason[] = [
  { code: "bad_taste", label: "الطعم سيئ", category: "جودة الطعام" },
  { code: "food_cold", label: "الطعام بارد", category: "جودة الطعام" },
  { code: "food_burnt", label: "الطعام محروق", category: "جودة الطعام" },
  { code: "order_delay", label: "تأخير الطلب", category: "خدمة وتوقيت" },
  { code: "wrong_order", label: "الطلب خاطئ", category: "خدمة وتوقيت" },
  { code: "missing_addons", label: "نقص إضافات", category: "جودة الطعام" },
  { code: "small_portion", label: "حجم الوجبة صغير", category: "جودة الطعام" },
  { code: "poor_ingredients", label: "جودة المكونات ضعيفة", category: "جودة الطعام" },
  { code: "too_salty_spicy", label: "زيادة الملح أو البهارات", category: "جودة الطعام" },
  { code: "too_greasy", label: "الوجبة دهنية جدًا", category: "جودة الطعام" },
  { code: "bad_plating", label: "شكل الطبق غير جيد", category: "جودة الطعام" },
  { code: "bad_smell", label: "رائحة غير مقبولة", category: "نظافة وسلامة" },
  { code: "undercooked", label: "عدم نضج الطعام", category: "جودة الطعام" },
  { code: "waiter_mistreatment", label: "سوء معاملة الويتر", category: "سلوك الموظف" },
  { code: "messy_arrival", label: "وصول الطعام مبعثر", category: "جودة الطعام" },
  { code: "inconsistent_quality", label: "اختلاف الجودة بين الزيارات", category: "جودة الطعام" },
  { code: "price_quality", label: "السعر لا يناسب الجودة", category: "فوترة ومنيو" },
  { code: "dirty_dish", label: "النظافة سيئة للوجبة", category: "نظافة وسلامة" },
  { code: "foreign_object", label: "وجود شعر أو جسم غريب", category: "نظافة وسلامة" },
  { code: "special_request_error", label: "خطأ في الطلبات الخاصة", category: "خدمة وتوقيت" },
  { code: "delivery_delay", label: "التأخير في التوصيل", category: "خدمة وتوقيت" },
  { code: "drinks_not_fresh", label: "العصائر أو المشروبات غير طازجة", category: "مشروبات" },
  { code: "fries_cold", label: "البطاطس أو المقليات باردة", category: "جودة الطعام" },
  { code: "stale_bread", label: "الخبز قديم", category: "جودة الطعام" },
  { code: "low_cheese_sauce", label: "الجبن أو الصوص قليل", category: "جودة الطعام" },
  { code: "staff_rude", label: "سوء تعامل الموظف", category: "سلوك الموظف" },
  { code: "dirty_table", label: "الطاولة أو الأدوات غير نظيفة", category: "نظافة وسلامة" },
  { code: "wrong_bill", label: "الفاتورة خاطئة", category: "فوترة ومنيو" },
  { code: "not_like_menu_photo", label: "الوجبة لا تشبه الصورة في المنيو", category: "فوترة ومنيو" },
  { code: "unused_drink", label: "مشروب غير مستخدم (إرجاع كامل)", category: "مشروبات" },
];

export function groupReasonsByCategory(reasons: GuestReturnReason[]): { category: string; items: GuestReturnReason[] }[] {
  const m = new Map<string, GuestReturnReason[]>();
  for (const r of reasons) {
    const cat = r.category || "أخرى";
    if (!m.has(cat)) m.set(cat, []);
    m.get(cat)!.push(r);
  }
  return Array.from(m.entries()).map(([category, items]) => ({ category, items }));
}

export function dispositionLabel(code: string): string {
  return GUEST_RETURN_DISPOSITIONS.find((d) => d.code === code)?.label || code;
}
