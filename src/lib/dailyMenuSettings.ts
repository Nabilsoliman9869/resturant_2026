/** تخزين مؤقت — يُستبدل لاحقاً بمزامنة الخادم */

export const DAILY_MENU_STORAGE_KEY = "mat3am_daily_menu_v1";

export type DailyMenuState = {
  forDate: string;
  allowedTokens: string[];
  notes: string;
};

export function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadDailyMenuState(): DailyMenuState {
  try {
    const raw = localStorage.getItem(DAILY_MENU_STORAGE_KEY);
    if (!raw) {
      return { forDate: todayYmd(), allowedTokens: [], notes: "" };
    }
    const p = JSON.parse(raw) as Partial<DailyMenuState>;
    return {
      forDate: typeof p.forDate === "string" ? p.forDate : todayYmd(),
      allowedTokens: Array.isArray(p.allowedTokens)
        ? p.allowedTokens.map(String).filter(Boolean)
        : [],
      notes: typeof p.notes === "string" ? p.notes : "",
    };
  } catch {
    return { forDate: todayYmd(), allowedTokens: [], notes: "" };
  }
}

export function saveDailyMenuState(s: DailyMenuState) {
  localStorage.setItem(DAILY_MENU_STORAGE_KEY, JSON.stringify(s));
}

/** إن وُجدت قائمة يومية و`allowedTokens` غير فارغة، يُعتبر الصنف مسموحاً إذا طابق أحد الرموز (مطابقة جزئية حساسة لحالة الأحرف). */
export function isItemAllowedByDailyMenu(
  itemIdOrName: string,
  state: DailyMenuState = loadDailyMenuState()
): boolean {
  const tokens = state.allowedTokens.map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return true;
  const q = itemIdOrName.trim().toLowerCase();
  if (!q) return false;
  return tokens.some((t) => q.includes(t.toLowerCase()) || t.toLowerCase().includes(q));
}
