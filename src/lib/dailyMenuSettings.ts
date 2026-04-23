import { getApiBase } from "./apiBase";
import { tryParseJson } from "./tryParseJson";

export const DAILY_MENU_STORAGE_KEY = "mat3am_daily_menu_v1";

export type DailyMenuState = {
  forDate: string;
  allowedTokens: string[];
  notes: string;
};

export type DailyMenuScheduleItem = {
  ProductGuide: string;
  ProductName: string;
};

export type DailyMenuScheduleEntry = {
  dateFrom: string;
  dateTo: string;
  items: DailyMenuScheduleItem[];
};

export type DailyMenuScheduleResponse = {
  entries: DailyMenuScheduleEntry[];
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
  // لا نطبّق فلترة اليوميات على يوم مختلف حتى لا تختفي أصناف بالخطأ.
  if ((state?.forDate || "").trim() && state.forDate !== todayYmd()) return true;
  const tokens = state.allowedTokens.map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return true;
  const q = itemIdOrName.trim().toLowerCase();
  if (!q) return false;
  return tokens.some((t) => q.includes(t.toLowerCase()) || t.toLowerCase().includes(q));
}

/** فلترة صنف POS/جرسون: يطابق دليل المنتج أو الاسم ضد الرموز اليومية */
export function isProductOnDailyMenu(
  productGuide: string,
  productName: string,
  state: DailyMenuState | null
): boolean {
  if (!state) return true;
  if (isItemAllowedByDailyMenu(productGuide, state)) return true;
  if (productName && isItemAllowedByDailyMenu(productName, state)) return true;
  return false;
}

export async function fetchDailyMenuFromApi(): Promise<DailyMenuState | null> {
  try {
    const r = await fetch(`${getApiBase()}/api/restaurant/daily-menu`);
    if (!r.ok) return null;
    const j = tryParseJson<{ menu?: Partial<DailyMenuState> }>(await r.text()) ?? {};
    const m = j.menu;
    if (!m || typeof m !== "object") return null;
    return {
      forDate: typeof m.forDate === "string" ? m.forDate : todayYmd(),
      allowedTokens: Array.isArray(m.allowedTokens)
        ? m.allowedTokens.map(String).filter(Boolean)
        : [],
      notes: typeof m.notes === "string" ? m.notes : "",
    };
  } catch {
    return null;
  }
}

export async function pushDailyMenuToApi(state: DailyMenuState): Promise<{ ok: boolean; detail?: string }> {
  try {
    const r = await fetch(`${getApiBase()}/api/restaurant/daily-menu`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menu: state }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, detail: typeof j.detail === "string" ? j.detail : "فشل الحفظ" };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

export async function fetchDailyMenuSchedule(): Promise<DailyMenuScheduleEntry[]> {
  try {
    const r = await fetch(`${getApiBase()}/api/restaurant/daily-menu-schedule`);
    if (!r.ok) return [];
    const j = (await r.json()) as DailyMenuScheduleResponse;
    if (!j || !Array.isArray(j.entries)) return [];
    return j.entries;
  } catch {
    return [];
  }
}

/** يوم بصيغة yyyy-mm-dd داخل مدى من–إلى (تواريخ حقل date input) */
export function ymdInRange(ymd: string, from: string, to: string): boolean {
  const d = (ymd || "").trim();
  const a = (from || "").trim();
  const b = (to || "").trim() || a;
  if (!d || !a) return false;
  return d >= a && d <= b;
}

/**
 * قيود جدول المدى اليومي للجرسون:
 * - لا يوجد مدى يغطي اليوم → لا قيد (عرض الكل حسب باقي القواعد).
 * - يوجد مدى و`items` فارغ → لا قيد (عرض كل الأصناف غير الموقوفة).
 * - يوجد مدى و`items` غير فارغ → السماح بهذه الأدلة فقط.
 */
export function scheduleRestrictionForDate(
  entries: DailyMenuScheduleEntry[],
  ymd: string
): { limited: boolean; allowedGuides: Set<string> } {
  const hits = (entries || []).filter((e) => ymdInRange(ymd, e.dateFrom, e.dateTo));
  if (!hits.length) return { limited: false, allowedGuides: new Set() };
  const merged = new Set<string>();
  let anyItems = false;
  for (const h of hits) {
    const it = Array.isArray(h.items) ? h.items : [];
    if (it.length) {
      anyItems = true;
      for (const x of it) {
        const g = String((x as DailyMenuScheduleItem).ProductGuide || "").trim();
        if (g) merged.add(g.toUpperCase());
      }
    }
  }
  if (!anyItems) return { limited: false, allowedGuides: new Set() };
  return { limited: true, allowedGuides: merged };
}

export async function pushDailyMenuSchedule(entries: DailyMenuScheduleEntry[]): Promise<{ ok: boolean; detail?: string }> {
  try {
    const r = await fetch(`${getApiBase()}/api/restaurant/daily-menu-schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, detail: typeof j.detail === "string" ? j.detail : "فشل الحفظ" };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}
