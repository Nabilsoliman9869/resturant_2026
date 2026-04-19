import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type ProductOption = { CardGuide: string; ProductName: string; Price?: number };
type Line = { productGuide: string; productName: string; qty: number; unitCost: number; totalCost: number; note?: string };
const toISODate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function DailyOpeningCustodyPage() {
  const [dateKey, setDateKey] = useState(toISODate());
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [rows, setRows] = useState<Line[]>([]);
  const [msg, setMsg] = useState("");

  const addRow = () => setRows((p) => [...p, { productGuide: "", productName: "", qty: 0, unitCost: 0, totalCost: 0, note: "" }]);
  const recalc = (r: Line) => ({ ...r, totalCost: Number((Number(r.qty || 0) * Number(r.unitCost || 0)).toFixed(2)) });

  async function load() {
    setMsg("");
    const [p, d] = await Promise.all([
      fetch(`${getApiBase()}/api/costing/raw-products?group_guid=ALL`),
      fetch(`${getApiBase()}/api/costing/daily-engine?date_key=${encodeURIComponent(dateKey)}`),
    ]);
    const pj = await p.json().catch(() => ({}));
    const dj = await d.json().catch(() => ({}));
    setOptions(Array.isArray(pj.products) ? pj.products : []);
    setRows(Array.isArray(dj.custody) ? dj.custody : []);
  }

  async function save() {
    try {
      const r = await fetch(`${getApiBase()}/api/costing/daily-engine/custody/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateKey, lines: rows }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
      const j = JSON.parse(t || "{}");
      setMsg(`تم حفظ عهدة أول اليوم بعدد ${j.written ?? 0} سطر.`);
    } catch (e) {
      setMsg(`فشل حفظ العهدة: ${String(e)}`);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  return (
    <div className="page" style={{ direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>شاشة عهدة أول اليوم</h2>
      <div className="card" style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          تاريخ التشغيل
          <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
        </label>
        <button className="btn btn-ghost" onClick={() => void load()}>تحديث</button>
        <button className="btn btn-ghost" onClick={addRow}>+ سطر</button>
        <button className="btn btn-primary" onClick={() => void save()}>حفظ</button>
      </div>
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={{ padding: 6 }}>الصنف الخام</th><th style={{ padding: 6 }}>الكمية</th><th style={{ padding: 6 }}>سعر الوحدة</th><th style={{ padding: 6 }}>التكلفة</th><th style={{ padding: 6 }}>ملاحظة</th><th style={{ padding: 6 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${i}-${r.productGuide}`} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <td style={{ padding: 6 }}>
                  <select value={r.productGuide} onChange={(e) => {
                    const pg = e.target.value; const p = options.find((x) => x.CardGuide === pg);
                    const nr = recalc({ ...r, productGuide: pg, productName: p?.ProductName || r.productName, unitCost: Number(p?.Price || r.unitCost || 0) });
                    setRows((prev) => prev.map((x, ix) => (ix === i ? nr : x)));
                  }}>
                    <option value="">— اختر —</option>
                    {options.map((p) => <option key={p.CardGuide} value={p.CardGuide}>{p.ProductName}</option>)}
                  </select>
                </td>
                <td style={{ padding: 6 }}><input type="number" step="any" value={r.qty} onChange={(e) => setRows((p) => p.map((x, ix) => ix === i ? recalc({ ...x, qty: Number(e.target.value || 0) }) : x))} /></td>
                <td style={{ padding: 6 }}><input type="number" step="any" value={r.unitCost} onChange={(e) => setRows((p) => p.map((x, ix) => ix === i ? recalc({ ...x, unitCost: Number(e.target.value || 0) }) : x))} /></td>
                <td style={{ padding: 6 }}>{Number(r.totalCost || 0).toFixed(2)}</td>
                <td style={{ padding: 6 }}><input value={r.note || ""} onChange={(e) => setRows((p) => p.map((x, ix) => ix === i ? { ...x, note: e.target.value } : x))} /></td>
                <td style={{ padding: 6 }}><button className="btn btn-ghost" onClick={() => setRows((p) => p.filter((_, ix) => ix !== i))}>حذف</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith("فشل") ? "#ef4444" : "#22c55e" }}>{msg}</div> : null}
    </div>
  );
}

