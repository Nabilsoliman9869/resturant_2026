/** رسائل موحّدة — بيانات مرجعية (TBL005/006/007) مقابل تشغيلية حية. */

export const REFERENCE_DATA_SAVE_HINT =
  "تم الحفظ في قاعدة البيانات. سيظهر التعديل في القوائم بعد «تحديث بيانات النظام» أو تلقائياً عند التحديث التالي للكاش.";

export const REFERENCE_DATA_REFRESH_OK =
  "تم تحديث بيانات النظام (أصناف، مجموعات، طاولات TBL005، ومستخدمون إن طُلِب).";

export type ReferenceCacheStatus = {
  ok?: boolean;
  referenceCacheOnly?: boolean;
  saveHint?: string;
  cache?: {
    tbl007?: { cached?: boolean; count?: number; ageSec?: number | null };
    tbl006?: { cached?: boolean; count?: number; ageSec?: number | null };
    tbl005?: { cached?: boolean; count?: number; ageSec?: number | null };
    appUsers?: { cached?: boolean; count?: number; ageSec?: number | null };
    referenceCacheOnly?: boolean;
  };
};

export function formatReferenceCacheSummary(st: ReferenceCacheStatus | null): string {
  const c = st?.cache;
  if (!c) return "—";
  const p = c.tbl007;
  const g = c.tbl006;
  const t = c.tbl005;
  const u = c.appUsers;
  const line = (label: string, x?: { cached?: boolean; count?: number; ageSec?: number | null }) => {
    if (!x) return `${label}: —`;
    const age = x.ageSec != null ? `${x.ageSec}s` : "—";
    return `${label}: ${x.cached ? x.count ?? 0 : "فارغ"} (عمر ${age})`;
  };
  return [line("أصناف", p), line("مجموعات", g), line("طاولات", t), line("مستخدمون", u)].join(" · ");
}
