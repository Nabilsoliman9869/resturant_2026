/**
 * تنبيه موحّد بعد تعديل الإعدادات: يُعرض مرّة واحدة أو بعد فترة اختصار
 * لتفادي رسائل متكررة خلال عمليات متتابعة (مثل رفع صور متعددة).
 */

type NotifyHandler = () => void;

let registered: NotifyHandler | null = null;

/** يستدعيها `SettingsApplyNoticeProvider` عند التركيب. */
export function registerSettingsRestartNotifier(fn: NotifyHandler | null) {
  registered = fn;
}

let debounceId: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 700;

/** استدعه بعد أي حفظ ناجح لإعدادات يجب أن تنعكس على POS/التشغيل دون مراجعة خلفية لكل عملية. */
export function notifySettingsRestartRecommended() {
  if (!registered) return;
  if (debounceId != null) window.clearTimeout(debounceId);
  debounceId = window.setTimeout(() => {
    debounceId = null;
    registered?.();
  }, DEBOUNCE_MS);
}
