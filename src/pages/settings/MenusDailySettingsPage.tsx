import { useCallback, useMemo, useState } from "react";
import {
  loadDailyMenuState,
  saveDailyMenuState,
  todayYmd,
  type DailyMenuState,
} from "../../lib/dailyMenuSettings";

export default function MenusDailySettingsPage() {
  const [state, setState] = useState<DailyMenuState>(() => loadDailyMenuState());
  const [draftLine, setDraftLine] = useState("");

  const sortedUnique = useMemo(() => {
    const u = new Set(state.allowedTokens.map((t) => t.trim()).filter(Boolean));
    return Array.from(u);
  }, [state.allowedTokens]);

  const persist = useCallback((next: DailyMenuState) => {
    setState(next);
    saveDailyMenuState(next);
  }, []);

  function addLines() {
    const parts = draftLine
      .split(/[,،\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    persist({ ...state, allowedTokens: [...state.allowedTokens, ...parts] });
    setDraftLine("");
  }

  function removeToken(t: string) {
    persist({ ...state, allowedTokens: state.allowedTokens.filter((x) => x !== t) });
  }

  function useToday() {
    persist({ ...state, forDate: todayYmd() });
  }

  function clearList() {
    persist({ ...state, allowedTokens: [] });
  }

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>
        المنيو والقائمة اليومية
      </h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6, marginTop: 0 }}>
        بعض المطاعم تعرض فقط ما يحدده المدير لهذا اليوم (مثلاً أطباق موسمية). هنا تأسيس أولي: قائمة
        رموز/أسماء مسموح عرضها في نقطة البيع والجرسون عند ربط المنطق لاحقاً بـ API المنيو. التخزين
        حالياً في المتصفح لهذا الجهاز — الخطوة التالية مزامنة مع الخادم.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ color: "var(--muted)" }}>تاريخ القائمة</span>
            <input
              type="date"
              value={state.forDate}
              onChange={(e) => persist({ ...state, forDate: e.target.value })}
            />
          </label>
          <button type="button" className="btn btn-ghost" onClick={useToday}>
            تعيين لتاريخ اليوم
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>إضافة أصناف أو فئات لليوم</h3>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
          افصل بين القيم بفاصلة أو سطر جديد (مثال: <code>شوربة_يومية</code>، <code>سمك موسمي</code>).
        </p>
        <textarea
          value={draftLine}
          onChange={(e) => setDraftLine(e.target.value)}
          rows={3}
          style={{ width: "100%", marginBottom: "0.5rem" }}
          placeholder="أدخل أسماء أو رموز الأصناف المتاحة اليوم…"
        />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={addLines}>
            إضافة للقائمة
          </button>
          <button type="button" className="btn btn-ghost" onClick={clearList}>
            تفريغ القائمة
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>ما هو مسموح اليوم ({sortedUnique.length})</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {sortedUnique.length === 0 ? (
            <span style={{ color: "var(--muted)" }}>لا توجد قيود بعد — سيتم ربط الفلترة بـ POS لاحقاً.</span>
          ) : (
            sortedUnique.map((t) => (
              <button
                key={t}
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: "0.85rem" }}
                onClick={() => removeToken(t)}
                title="إزالة"
              >
                {t} ×
              </button>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>ملاحظات للفريق</h3>
        <textarea
          value={state.notes}
          onChange={(e) => persist({ ...state, notes: e.target.value })}
          rows={4}
          style={{ width: "100%" }}
          placeholder="مثال: لا نعرض المشاوي بعد العاشرة…"
        />
      </div>
    </div>
  );
}
