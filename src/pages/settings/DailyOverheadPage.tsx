import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type OverheadLine = { costName: string; basisType: "daily" | "monthly" | "yearly" | "hourly"; basisAmount: number; divisor: number; dailyAmount: number; note?: string };
const toISODate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function DailyOverheadPage() {
  const [dateKey, setDateKey] = useState(toISODate());
  const [rows, setRows] = useState<OverheadLine[]>([]);
  const [msg, setMsg] = useState("");

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.dailyAmount || 0), 0), [rows]);

  async function load() {
    setMsg("");
    const r = await fetch(`${getApiBase()}/api/costing/daily-engine?date_key=${encodeURIComponent(dateKey)}`);
    const j = await r.json().catch(() => ({}));
    setRows(Array.isArray(j.overhead) ? j.overhead : []);
  }

  function addRow() {
    setRows((p) => [...p, { costName: "", basisType: "daily", basisAmount: 0, divisor: 1, dailyAmount: 0, note: "" }]);
  }

  function updateRow(i: number, patch: Partial<OverheadLine>) {
    setRows((prev) => {
      const next = [...prev];
      const n = { ...next[i], ...patch };
      const div = Number(n.divisor || 1) <= 0 ? 1 : Number(n.divisor || 1);
      n.dailyAmount = Number((Number(n.basisAmount || 0) / div).toFixed(2));
      next[i] = n;
      return next;
    });
  }

  async function save() {
    try {
      const r = await fetch(`${getApiBase()}/api/costing/daily-engine/overhead/save`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateKey, lines: rows }),
      });
      const t = await r.text(); if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
      const j = JSON.parse(t || "{}"); setMsg(`تم حفظ مصاريف التشغيل بعدد ${j.written ?? 0} سطر.`);
    } catch (e) { setMsg(`فشل حفظ المصاريف: ${String(e)}`); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dateKey]);

  return (
    <div className="page" style={{ direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>شاشة مصاريف التشغيل اليومية</h2>
      <div className="card" style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>تاريخ التشغيل<input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} /></label>
        <button className="btn btn-ghost" onClick={() => void load()}>تحديث</button>
        <button className="btn btn-ghost" onClick={addRow}>+ سطر</button>
        <button className="btn btn-primary" onClick={() => void save()}>حفظ</button>
      </div>
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "rgba(255,255,255,0.04)" }}><th style={{ padding: 6 }}>البند</th><th style={{ padding: 6 }}>النوع</th><th style={{ padding: 6 }}>القيمة</th><th style={{ padding: 6 }}>المقسوم عليه</th><th style={{ padding: 6 }}>اليومي</th><th style={{ padding: 6 }}>ملاحظة</th><th style={{ padding: 6 }}></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${i}-${r.costName}`} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <td style={{ padding: 6 }}><input value={r.costName} onChange={(e) => updateRow(i, { costName: e.target.value })} /></td>
                <td style={{ padding: 6 }}>
                  <select value={r.basisType} onChange={(e) => { const t = e.target.value as OverheadLine["basisType"]; const d = t === "monthly" ? 30 : t === "yearly" ? 365 : t === "hourly" ? 24 : 1; updateRow(i, { basisType: t, divisor: d }); }}>
                    <option value="daily">يومي</option><option value="monthly">شهري</option><option value="yearly">سنوي</option><option value="hourly">ساعة</option>
                  </select>
                </td>
                <td style={{ padding: 6 }}><input type="number" step="any" value={r.basisAmount} onChange={(e) => updateRow(i, { basisAmount: Number(e.target.value || 0) })} /></td>
                <td style={{ padding: 6 }}><input type="number" step="any" value={r.divisor} onChange={(e) => updateRow(i, { divisor: Number(e.target.value || 1) })} /></td>
                <td style={{ padding: 6 }}>{Number(r.dailyAmount || 0).toFixed(2)}</td>
                <td style={{ padding: 6 }}><input value={r.note || ""} onChange={(e) => updateRow(i, { note: e.target.value })} /></td>
                <td style={{ padding: 6 }}><button className="btn btn-ghost" onClick={() => setRows((p) => p.filter((_, ix) => ix !== i))}>حذف</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontWeight: 700 }}>إجمالي مصاريف التشغيل اليومية: {total.toFixed(2)}</div>
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith("فشل") ? "#ef4444" : "#22c55e" }}>{msg}</div> : null}
    </div>
  );
}

