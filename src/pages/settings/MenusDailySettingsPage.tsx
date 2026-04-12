import { useCallback, useEffect, useState } from "react";
import {
  loadDailyMenuState,
  saveDailyMenuState,
  type DailyMenuState,
} from "../../lib/dailyMenuSettings";
import { fetchDailyMenuSchedule, pushDailyMenuSchedule, type DailyMenuScheduleEntry } from "../../lib/dailyMenuSettings";

export default function MenusDailySettingsPage() {
  const [state, setState] = useState<DailyMenuState>(() => loadDailyMenuState());
  const [entries, setEntries] = useState<DailyMenuScheduleEntry[]>([]);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ CardGuide: string; ProductName: string }>>([]);
  const [rangeItems, setRangeItems] = useState<Array<{ ProductGuide: string; ProductName: string }>>([]);
  const [schedMsg, setSchedMsg] = useState("");

  const persist = useCallback((next: DailyMenuState) => {
    setState(next);
    saveDailyMenuState(next);
  }, []);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const sched = await fetchDailyMenuSchedule();
      if (!cancel) setEntries(sched);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const searchProducts = useCallback(async () => {
    setSchedMsg("");
    const q = searchText.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    try {
      const r = await fetch(`/api/products/search?search_text=${encodeURIComponent(q)}`);
      const j = await r.json();
      const arr = Array.isArray(j.products) ? j.products : [];
      setSearchResults(arr.map((p: any) => ({ CardGuide: String(p.CardGuide), ProductName: String(p.ProductName || "") })));
    } catch (e) {
      setSearchResults([]);
      setSchedMsg(String(e));
    }
  }, [searchText]);

  function addRangeItem(it: { CardGuide: string; ProductName: string }) {
    if (!it.CardGuide) return;
    setRangeItems((prev) => {
      if (prev.some((x) => x.ProductGuide === it.CardGuide)) return prev;
      return [...prev, { ProductGuide: it.CardGuide, ProductName: it.ProductName }];
    });
  }

  function removeRangeItem(pg: string) {
    setRangeItems((prev) => prev.filter((x) => x.ProductGuide !== pg));
  }

  function clearComposer() {
    setRangeFrom("");
    setRangeTo("");
    setRangeItems([]);
  }

  const addEntry = () => {
    if (!rangeFrom) return setSchedMsg("حدد تاريخ البداية");
    const entry: DailyMenuScheduleEntry = { dateFrom: rangeFrom, dateTo: rangeTo || rangeFrom, items: rangeItems };
    setEntries((prev) => [...prev, entry]);
    clearComposer();
  };

  const saveSchedule = useCallback(async () => {
    setSchedMsg("");
    const res = await pushDailyMenuSchedule(entries);
    setSchedMsg(res.ok ? "تم حفظ الجدول على الخادم." : res.detail || "فشل الحفظ");
  }, [entries]);

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>
        المنيو والقائمة اليومية
      </h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6, marginTop: 0 }}>
        حدّد أصناف TBL007 المتاحة ضمن مدى تاريخ يومي أو ممتد. سيتم توصيل هذه الجدولة مع شاشة الجرسون/‏POS.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>إعدادات القائمة اليومية (حسب الأصناف من TBL007)</h3>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: 0 }}>
          اختر أصنافًا من قاعدة البيانات وحدد مدى التاريخ. المدى يمكن أن يكون يوميًا (نفس التاريخ بداية/نهاية) أو ممتدًا.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "0.5rem" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ color: "var(--muted)" }}>من</span>
            <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
          </label>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ color: "var(--muted)" }}>إلى</span>
            <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: "0.75rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
              <input
                placeholder="ابحث باسم الصنف"
                style={{ flex: 1 }}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              <button type="button" className="btn btn-ghost" onClick={() => void searchProducts()}>بحث</button>
            </div>
            <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 6 }}>
              {searchResults.map((p) => (
                <div key={p.CardGuide} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px" }}>
                  <div>{p.ProductName}</div>
                  <button type="button" className="btn btn-ghost" onClick={() => addRangeItem(p)}>إضافة</button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>الأصناف المختارة ({rangeItems.length})</div>
            <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 6 }}>
              {rangeItems.length === 0 ? (
                <div style={{ color: "var(--muted)" }}>لم تُحدد أصنافًا بعد</div>
              ) : (
                rangeItems.map((it) => (
                  <div key={it.ProductGuide} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px" }}>
                    <div>{it.ProductName}</div>
                    <button type="button" className="btn btn-ghost" onClick={() => removeRangeItem(it.ProductGuide)}>إزالة</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={addEntry}>إضافة إلى الجدول</button>
          <button type="button" className="btn btn-ghost" onClick={clearComposer}>مسح</button>
        </div>
        {schedMsg && <p style={{ color: schedMsg.startsWith("تم") ? "var(--muted)" : "var(--danger)" }}>{schedMsg}</p>}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>الجدول الحالي ({entries.length})</h3>
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0,1fr) 160px", gap: "0.5rem", alignItems: "start" }}>
          <div style={{ fontWeight: 700 }}>المدى</div>
          <div style={{ fontWeight: 700 }}>الأصناف</div>
          <div></div>
          {entries.map((e, i) => (
            <>
              <div key={`range-${i}`}>{e.dateFrom} → {e.dateTo}</div>
              <div key={`items-${i}`}>{e.items.map((it) => it.ProductName).join("، ")}</div>
              <div key={`actions-${i}`} style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn btn-ghost" onClick={() => setEntries((prev) => prev.filter((_, idx) => idx !== i))}>حذف</button>
              </div>
            </>
          ))}
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" className="btn btn-primary" onClick={() => void saveSchedule()}>حفظ الجدول على الخادم</button>
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
    </div >
  );
}
