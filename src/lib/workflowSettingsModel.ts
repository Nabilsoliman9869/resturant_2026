/** مفاتيح دورة العمل — تُخزَّن في MAT3AM_WORKFLOW_SETTINGS + workflow_settings.json وتُدمج في GET /api/restaurant/ops-settings */
export type WorkflowSettings = {
  receiveGuestBy: string;
  orderTakerExclusiveTable: string;
  takeOrderBy: string;
  deliverFromKitchenBy: string;
  cleanTableBy: string;
  checkRequestBy: string;
  cashierDispatchMode: string;
  cleaningStartTrigger: string;
  cleaningExecutionBy: string;
  cleaningReviewBy: string;
  cleaningStartStatus: string;
};

export const WORKFLOW_SETTINGS_DEFAULTS: WorkflowSettings = {
  receiveGuestBy: "host",
  orderTakerExclusiveTable: "off",
  takeOrderBy: "waiter",
  deliverFromKitchenBy: "server",
  cleanTableBy: "server",
  checkRequestBy: "waiter",
  cashierDispatchMode: "both",
  cleaningStartTrigger: "payment_completed",
  cleaningExecutionBy: "server",
  cleaningReviewBy: "none",
  cleaningStartStatus: "dirty",
};

export const WORKFLOW_ROLE_OPTIONS = [
  { value: "host", label: "جرسون الاستقبال" },
  { value: "manager", label: "مدير المطعم" },
  { value: "operation_manager", label: "مدير التشغيل" },
  { value: "waiter", label: "جرسون الطلبات" },
  { value: "customer_self", label: "العميل نفسه" },
  { value: "server", label: "جرسون المناولة" },
] as const;

/** خيارات «من يستلم من المطبخ» — تشمل مسار بدون مستلم */
export const DELIVER_FROM_KITCHEN_OPTIONS = [
  { value: "server", label: "جرسون مناولة" },
  { value: "waiter", label: "نفس جرسون الطلبات" },
  { value: "manager", label: "مدير المطعم" },
  { value: "operation_manager", label: "مدير التشغيل" },
  { value: "host", label: "جرسون الاستقبال" },
  { value: "kitchen_window", label: "استلام مباشر من نافذة الشيف" },
  { value: "none", label: "لا أحد — مباشرة للطاولة بعد إنهاء المطبخ" },
] as const;
