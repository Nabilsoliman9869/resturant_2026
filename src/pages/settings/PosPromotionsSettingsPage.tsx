import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type Promotion = {
  id: string;
  name: string;
  type: string;
  priority: number;
  isActive: boolean;
  isStackable: boolean;
  scopeType: string;
  notes: string;
  payload?: Record<string, unknown> | null;
};

const PROMO_TYPES = ["percent_invoice", "buy_x_get_y", "tiered_qty", "happy_hour", "coupon"];

export default function PosPromotionsSettingsPage() {
  const base = getApiBase();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState(PROMO_TYPES[0]);
  const [priority, setPriority] = useState(100);
  const [stackable, setStackable] = useState(true);
  const [scopeType, setScopeType] = useState("invoice");
  const [payloadText, setPayloadText] = useState('{"percent":10,"minSubtotal":500}');
  const [notes, setNotes] = useState("");

  async function loadAll() {
    setMsg("");
    try {
      const prRes = await fetch(`${base}/api/pos/promotions?active_only=false`);
      const pr = await prRes.json();
      setPromotions(Array.isArray(pr.promotions) ? pr.promotions : []);
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [base]);

  async function addPromotion() {
    setMsg("");
    try {
      const payload = JSON.parse(payloadText);
      const body = {
        name,
        type,
        priority,
        isActive: true,
        isStackable: stackable,
        scopeType,
        payload,
        notes,
      };
      const r = await fetch(`${base}/api/pos/promotions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setName("");
      setNotes("");
      await loadAll();
      setMsg("تمت الإضافة.");
    } catch (e) {
      setMsg(`فشل: ${String(e)}`);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>العروض</h2>
      <div className="grid-2" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>إضافة عرض</h3>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم العرض" style={{ width: "100%", marginBottom: 8 }} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
            {PROMO_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 100)}
            placeholder="الأولوية"
            style={{ width: "100%", marginBottom: 8 }}
          />
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
            <option value="invoice">invoice</option>
            <option value="line">line</option>
            <option value="order_type">order_type</option>
          </select>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="checkbox" checked={stackable} onChange={(e) => setStackable(e.target.checked)} /> قابل للتجميع
          </label>
          <textarea value={payloadText} onChange={(e) => setPayloadText(e.target.value)} rows={4} style={{ width: "100%", marginBottom: 8 }} />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات" style={{ width: "100%", marginBottom: 8 }} />
          <button type="button" className="btn btn-primary" onClick={() => void addPromotion()}>
            إضافة
          </button>
        </div>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>العروض الحالية</h3>
            <button type="button" className="btn btn-ghost" onClick={() => void loadAll()}>
              تحديث
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--muted)" }}>
                  <th style={{ padding: "6px 8px" }}>الاسم</th>
                  <th style={{ padding: "6px 8px" }}>النوع</th>
                  <th style={{ padding: "6px 8px" }}>الأولوية</th>
                  <th style={{ padding: "6px 8px" }}>Scope</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px" }}>{p.name}</td>
                    <td style={{ padding: "6px 8px" }}>{p.type}</td>
                    <td style={{ padding: "6px 8px" }}>{p.priority}</td>
                    <td style={{ padding: "6px 8px" }}>{p.scopeType || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {msg ? <p style={{ color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}
