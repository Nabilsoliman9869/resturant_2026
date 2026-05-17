import { Fragment, useCallback, useEffect, useState } from "react";
import {
  loadDailyMenuState,
  saveDailyMenuState,
  fetchDailyMenuSchedule,
  pushDailyMenuSchedule,
  type DailyMenuState,
  type DailyMenuScheduleEntry,
} from "../../lib/dailyMenuSettings";
import { getApiBase } from "../../lib/apiBase";
import { tryParseJson } from "../../lib/tryParseJson";

export default function MenusDailySettingsPage() {
  const base = getApiBase();
  const [state, setState] = useState<DailyMenuState>(() => loadDailyMenuState());
  const [entries, setEntries] = useState<DailyMenuScheduleEntry[]>([]);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ CardGuide: string; ProductName: string }>>([]);
  const [rangeItems, setRangeItems] = useState<Array<{ ProductGuide: string; ProductName: string }>>([]);
  const [schedMsg, setSchedMsg] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [schedLoadBusy, setSchedLoadBusy] = useState(true);

  const persist = useCallback((next: DailyMenuState) => {
    setState(next);
    saveDailyMenuState(next);
  }, []);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      setSchedLoadBusy(true);
      try {
        const sched = await fetchDailyMenuSchedule();
        if (!cancel) {
          setEntries(sched.entries);
          if (sched.error) setSchedMsg(sched.error);
        }
      } finally {
        if (!cancel) setSchedLoadBusy(false);
      }
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
    setSearchBusy(true);
    try {
      const urls = [
        `${base}/api/products/search?search_text=${encodeURIComponent(q)}&menuPicker=1`,
        `${base}/api/restaurant/products/search-menu?search_text=${encodeURIComponent(q)}`,
        `${base}/api/products/search?search_text=${encodeURIComponent(q)}`,
      ];
      let lastText = "";
      let lastStatus = 0;
      let j: { products?: unknown[] } | null = null;
      for (const url of urls) {
        const r = await fetch(url, { cache: "no-store" });
        lastText = await r.text();
        lastStatus = r.status;
        if (r.status === 404) continue;
        if (!r.ok) break;
        j = tryParseJson<{ products?: unknown[] }>(lastText);
        if (j) break;
      }
      if (!j) {
        setSearchResults([]);
        if (lastStatus === 404) {
          setSchedMsg(
            "مسار البحث غير موجود على الخادم — أوقف MAT3AM-API ثم شغّل run_api.bat من جديد (بعد تحديث الكود).",
          );
        } else if (lastText.trim()) {
          setSchedMsg(lastText.trim().slice(0, 240));
        } else {
          setSchedMsg("استجابة فارغة — شغّل run_full_stack.bat ثم http://127.0.0.1:2288/api/ping");
        }
        return;
      }
      const arr = Array.isArray(j.products) ? j.products : [];
      setSearchResults(
        arr.map((p) => {
          const row = p as Record<string, unknown>;
          return { CardGuide: String(row.CardGuide ?? ""), ProductName: String(row.ProductName || "") };
        }),
      );
    } catch (e) {
      setSearchResults([]);
      const s = String(e);
      setSchedMsg(
        /failed to fetch|networkerror/i.test(s)
          ? `لا اتصال بـ API (${base}) — شغّل run_full_stack.bat`
          : s,
      );
    } finally {
      setSearchBusy(false);
    }
  }, [base, searchText]);

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

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>القائمة اليومية</h3>
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
              <button type="button" className="btn btn-ghost" onClick={() => void searchProducts()} disabled={searchBusy}>
                {searchBusy ? "جارٍ…" : "بحث"}
              </button>
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
        <h3 style={{ marginTop: 0 }}>
          الجدول الحالي ({entries.length}){schedLoadBusy ? " — جارٍ التحميل…" : ""}
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0,1fr) 160px", gap: "0.5rem", alignItems: "start" }}>
          <div style={{ fontWeight: 700 }}>المدى</div>
          <div style={{ fontWeight: 700 }}>الأصناف</div>
          <div></div>
          {entries.map((e, i) => (
            <Fragment key={`${e.dateFrom}-${e.dateTo}-${i}`}>
              <div>{e.dateFrom} → {e.dateTo}</div>
              <div>{e.items.map((it) => it.ProductName).join("، ")}</div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn btn-ghost" onClick={() => setEntries((prev) => prev.filter((_, idx) => idx !== i))}>حذف</button>
              </div>
            </Fragment>
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
