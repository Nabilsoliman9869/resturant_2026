import { useState } from "react";
import { getApiBase } from "../../lib/apiBase";

const toISODate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function DailyResultPage() {
  const [dateKey, setDateKey] = useState(toISODate());
  const [result, setResult] = useState<any>(null);
  const [revenueManual, setRevenueManual] = useState<number | "">("");
  const [msg, setMsg] = useState("");

  async function loadResult() {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/costing/daily-engine/result?date_key=${encodeURIComponent(dateKey)}`);
      const j = await r.json().catch(() => ({}));
      setResult(j.result || null);
      if (!j.result) setMsg("لا يوجد حفظ سابق للنتيجة اليومية في هذا التاريخ.");
    } catch (e) {
      setMsg(`تعذر تحميل النتيجة اليومية: ${String(e)}`);
    }
  }

  async function closeAndSave() {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/costing/daily-engine/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateKey, revenueManual: revenueManual === "" ? null : Number(revenueManual) }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
      setMsg("تم احتساب النتيجة اليومية وحفظها في جدول مستقل بنجاح.");
      await loadResult();
    } catch (e) {
      setMsg(`فشل احتساب/حفظ النتيجة اليومية: ${String(e)}`);
    }
  }

  return (
    <div className="page" style={{ direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>النتيجة اليومية</h2>
      <p style={{ color: "var(--muted)" }}>هذه الشاشة مخصصة فقط للنتيجة اليومية، ويتم تسجيلها في جدول مستقل لاستخدامها لاحقًا في قيد التكلفة.</p>
      <div className="card" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          تاريخ اليوم
          <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          إيراد يدوي (اختياري)
          <input type="number" step="any" value={revenueManual} onChange={(e) => setRevenueManual(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <button className="btn btn-ghost" onClick={() => void loadResult()}>تحميل المحفوظ</button>
        <button className="btn btn-primary" onClick={() => void closeAndSave()}>احتساب وحفظ النتيجة اليومية</button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>الملخص</h3>
        <GridStat label="عهدة أول اليوم" value={Number(result?.openingCustody || 0).toFixed(2)} />
        <GridStat label="المسترد" value={Number(result?.returnedCustody || 0).toFixed(2)} />
        <GridStat label="المستهلك فعليًا من الخام" value={Number(result?.rawConsumed || 0).toFixed(2)} />
        <GridStat label="تكاليف التشغيل" value={Number(result?.overheadTotal || 0).toFixed(2)} />
        <GridStat label="إجمالي تكلفة اليوم" value={Number(result?.totalCost || 0).toFixed(2)} />
        <GridStat label="إيراد اليوم" value={Number(result?.revenueTotal || 0).toFixed(2)} />
        <GridStat label="الربح اليومي" value={Number(result?.profitTotal || 0).toFixed(2)} />
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith("فشل") || msg.startsWith("تعذر") ? "#ef4444" : "#22c55e" }}>{msg}</div> : null}
    </div>
  );
}

function GridStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, marginBottom: 6 }}>
      <div style={{ color: "var(--muted)" }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}

