import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type ProductOption = { CardGuide: string; ProductName: string; Price?: number };
type Line = {
  productGuide: string;
  productName: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  note?: string;
};
type OverheadLine = {
  costName: string;
  basisType: "daily" | "monthly" | "yearly" | "hourly";
  basisAmount: number;
  divisor: number;
  dailyAmount: number;
  note?: string;
};

const toISODate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function DailyCostEnginePage() {
  const [dateKey, setDateKey] = useState(toISODate());
  const [rawOptions, setRawOptions] = useState<ProductOption[]>([]);
  const [custody, setCustody] = useState<Line[]>([]);
  const [returns, setReturns] = useState<Line[]>([]);
  const [overhead, setOverhead] = useState<OverheadLine[]>([]);
  const [revenueManual, setRevenueManual] = useState<number | "">("");
  const [summary, setSummary] = useState<any>(null);
  const [msg, setMsg] = useState("");

  const addLine = (setter: React.Dispatch<React.SetStateAction<Line[]>>) =>
    setter((p) => [...p, { productGuide: "", productName: "", qty: 0, unitCost: 0, totalCost: 0, note: "" }]);

  const addOverhead = () =>
    setOverhead((p) => [...p, { costName: "", basisType: "daily", basisAmount: 0, divisor: 1, dailyAmount: 0, note: "" }]);

  async function loadRawOptions() {
    const r = await fetch(`${getApiBase()}/api/costing/raw-products?group_guid=ALL`);
    const j = await r.json().catch(() => ({}));
    const arr: ProductOption[] = Array.isArray(j.products) ? j.products : [];
    setRawOptions(arr);
  }

  async function loadDay() {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/costing/daily-engine?date_key=${encodeURIComponent(dateKey)}`);
      const j = await r.json().catch(() => ({}));
      setCustody(Array.isArray(j.custody) ? j.custody : []);
      setReturns(Array.isArray(j.returned) ? j.returned : []);
      setOverhead(Array.isArray(j.overhead) ? j.overhead : []);
      setSummary(j.summary || null);
    } catch (e) {
      setMsg(`تعذر تحميل يوم التشغيل: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadRawOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void loadDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  function updateLine(list: Line[], idx: number, patch: Partial<Line>, setter: React.Dispatch<React.SetStateAction<Line[]>>) {
    const next = [...list];
    const n = { ...next[idx], ...patch };
    n.totalCost = Number((Number(n.qty || 0) * Number(n.unitCost || 0)).toFixed(2));
    next[idx] = n;
    setter(next);
  }

  function updateOverhead(idx: number, patch: Partial<OverheadLine>) {
    setOverhead((prev) => {
      const next = [...prev];
      const n = { ...next[idx], ...patch };
      const div = Number(n.divisor || 1) <= 0 ? 1 : Number(n.divisor || 1);
      n.dailyAmount = Number((Number(n.basisAmount || 0) / div).toFixed(2));
      next[idx] = n;
      return next;
    });
  }

  async function saveLines(kind: "custody" | "returns" | "overhead") {
    const body =
      kind === "overhead"
        ? { dateKey, lines: overhead }
        : { dateKey, lines: kind === "custody" ? custody : returns };
    const url =
      kind === "custody"
        ? "/api/costing/daily-engine/custody/save"
        : kind === "returns"
          ? "/api/costing/daily-engine/returns/save"
          : "/api/costing/daily-engine/overhead/save";
    const r = await fetch(`${getApiBase()}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
    const j = JSON.parse(t || "{}");
    setMsg(`تم حفظ ${kind === "custody" ? "عهدة أول اليوم" : kind === "returns" ? "المسترد" : "مصاريف التشغيل"} بعدد ${j.written ?? 0} سطر.`);
  }

  async function closeDay() {
    const r = await fetch(`${getApiBase()}/api/costing/daily-engine/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateKey, revenueManual: revenueManual === "" ? null : Number(revenueManual) }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
    const j = JSON.parse(t || "{}");
    setSummary(j.summary || null);
    setMsg("تم إقفال اليوم وحساب الربح اليومي بنجاح.");
  }

  const opening = useMemo(() => custody.reduce((s, x) => s + Number(x.totalCost || 0), 0), [custody]);
  const returned = useMemo(() => returns.reduce((s, x) => s + Number(x.totalCost || 0), 0), [returns]);
  const overheadTotal = useMemo(() => overhead.reduce((s, x) => s + Number(x.dailyAmount || 0), 0), [overhead]);

  return (
    <div className="page" style={{ direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>إعدادات التكاليف - محرك التكلفة اليومية</h2>
      <div className="card" style={{ marginBottom: 12, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          تاريخ التشغيل
          <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          إيراد يدوي (اختياري)
          <input type="number" step="any" value={revenueManual} onChange={(e) => setRevenueManual(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <button className="btn btn-ghost" onClick={() => void loadDay()}>تحديث البيانات</button>
        <button className="btn btn-primary" onClick={() => void closeDay()}>إقفال اليوم وحساب الربح</button>
      </div>

      <Section
        title="عهدة أول اليوم (مسلّم للمطبخ)"
        onAdd={() => addLine(setCustody)}
        onSave={() => void saveLines("custody")}
      >
        <LinesTable
          rows={custody}
          options={rawOptions}
          onUpdate={(i, p) => updateLine(custody, i, p, setCustody)}
          onRemove={(i) => setCustody((p) => p.filter((_, x) => x !== i))}
        />
      </Section>

      <Section
        title="المسترد آخر اليوم من العهدة"
        onAdd={() => addLine(setReturns)}
        onSave={() => void saveLines("returns")}
      >
        <LinesTable
          rows={returns}
          options={rawOptions}
          onUpdate={(i, p) => updateLine(returns, i, p, setReturns)}
          onRemove={(i) => setReturns((p) => p.filter((_, x) => x !== i))}
        />
      </Section>

      <Section title="مصاريف التشغيل اليومية (Free Hand)" onAdd={addOverhead} onSave={() => void saveLines("overhead")}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                <th style={{ padding: 6 }}>البند</th>
                <th style={{ padding: 6 }}>نوع الأساس</th>
                <th style={{ padding: 6 }}>قيمة الأساس</th>
                <th style={{ padding: 6 }}>المقسوم عليه</th>
                <th style={{ padding: 6 }}>التكلفة اليومية</th>
                <th style={{ padding: 6 }}>ملاحظة</th>
                <th style={{ padding: 6 }}></th>
              </tr>
            </thead>
            <tbody>
              {overhead.map((r, i) => (
                <tr key={`${i}-${r.costName}`} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <td style={{ padding: 6 }}><input value={r.costName} onChange={(e) => updateOverhead(i, { costName: e.target.value })} /></td>
                  <td style={{ padding: 6 }}>
                    <select
                      value={r.basisType}
                      onChange={(e) => {
                        const t = e.target.value as OverheadLine["basisType"];
                        const d = t === "monthly" ? 30 : t === "yearly" ? 365 : t === "hourly" ? 24 : 1;
                        updateOverhead(i, { basisType: t, divisor: d });
                      }}
                    >
                      <option value="daily">يومي</option>
                      <option value="monthly">شهري</option>
                      <option value="yearly">سنوي</option>
                      <option value="hourly">ساعة</option>
                    </select>
                  </td>
                  <td style={{ padding: 6 }}><input type="number" step="any" value={r.basisAmount} onChange={(e) => updateOverhead(i, { basisAmount: Number(e.target.value || 0) })} /></td>
                  <td style={{ padding: 6 }}><input type="number" step="any" value={r.divisor} onChange={(e) => updateOverhead(i, { divisor: Number(e.target.value || 1) })} /></td>
                  <td style={{ padding: 6 }}>{Number(r.dailyAmount || 0).toFixed(2)}</td>
                  <td style={{ padding: 6 }}><input value={r.note || ""} onChange={(e) => updateOverhead(i, { note: e.target.value })} /></td>
                  <td style={{ padding: 6 }}><button className="btn btn-ghost" onClick={() => setOverhead((p) => p.filter((_, x) => x !== i))}>حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>ملخص اليوم</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
          <Stat label="عهدة أول اليوم" value={(summary?.openingCustody ?? opening).toFixed(2)} />
          <Stat label="المسترد" value={(summary?.returnedCustody ?? returned).toFixed(2)} />
          <Stat label="المستهلك فعليًا من الخام" value={(summary?.rawConsumed ?? Math.max(opening - returned, 0)).toFixed(2)} />
          <Stat label="تكاليف التشغيل" value={(summary?.overheadTotal ?? overheadTotal).toFixed(2)} />
          <Stat label="إجمالي تكلفة اليوم" value={(summary?.totalCost ?? Math.max(opening - returned, 0) + overheadTotal).toFixed(2)} />
          <Stat label="إيراد اليوم" value={Number(summary?.revenueTotal ?? 0).toFixed(2)} />
          <Stat label="الربح اليومي" value={Number(summary?.profitTotal ?? 0).toFixed(2)} />
        </div>
      </div>

      {msg ? <div style={{ marginTop: 10, color: msg.startsWith("تعذر") || msg.startsWith("فشل") ? "#ef4444" : "#22c55e" }}>{msg}</div> : null}
    </div>
  );
}

function Section({
  title,
  children,
  onAdd,
  onSave,
}: {
  title: string;
  children: React.ReactNode;
  onAdd: () => void;
  onSave: () => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onAdd}>+ سطر</button>
          <button className="btn btn-primary" onClick={onSave}>حفظ</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function LinesTable({
  rows,
  options,
  onUpdate,
  onRemove,
}: {
  rows: Line[];
  options: ProductOption[];
  onUpdate: (i: number, p: Partial<Line>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.04)" }}>
            <th style={{ padding: 6 }}>الصنف الخام</th>
            <th style={{ padding: 6 }}>الكمية</th>
            <th style={{ padding: 6 }}>سعر الوحدة</th>
            <th style={{ padding: 6 }}>التكلفة</th>
            <th style={{ padding: 6 }}>ملاحظة</th>
            <th style={{ padding: 6 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${i}-${r.productGuide}`} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <td style={{ padding: 6 }}>
                <select
                  value={r.productGuide}
                  onChange={(e) => {
                    const pg = e.target.value;
                    const p = options.find((x) => x.CardGuide === pg);
                    onUpdate(i, { productGuide: pg, productName: p?.ProductName || r.productName, unitCost: Number(p?.Price || r.unitCost || 0) });
                  }}
                >
                  <option value="">— اختر —</option>
                  {options.map((p) => (
                    <option key={p.CardGuide} value={p.CardGuide}>
                      {p.ProductName}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: 6 }}><input type="number" step="any" value={r.qty} onChange={(e) => onUpdate(i, { qty: Number(e.target.value || 0) })} /></td>
              <td style={{ padding: 6 }}><input type="number" step="any" value={r.unitCost} onChange={(e) => onUpdate(i, { unitCost: Number(e.target.value || 0) })} /></td>
              <td style={{ padding: 6 }}>{Number(r.totalCost || 0).toFixed(2)}</td>
              <td style={{ padding: 6 }}><input value={r.note || ""} onChange={(e) => onUpdate(i, { note: e.target.value })} /></td>
              <td style={{ padding: 6 }}><button className="btn btn-ghost" onClick={() => onRemove(i)}>حذف</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 10 }}>
      <div style={{ color: "var(--muted)", fontSize: 13 }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

