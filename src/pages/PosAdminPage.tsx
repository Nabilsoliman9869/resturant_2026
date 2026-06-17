import { useEffect, useState } from "react";
import { useVenue } from "../context/VenueContext";
import { getApiBase } from "../lib/apiBase";
import type { VenueType } from "../lib/venueType";

type Policy = {
  servicePercent: number;
  vatPercent: number;
  applyDiscountBeforeTax: boolean;
  serviceBeforeVat: boolean;
};

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

export default function PosAdminPage() {
  const base = getApiBase();
  const { refresh: refreshVenue } = useVenue();
  const [policy, setPolicy] = useState<Policy>({
    servicePercent: 12.5,
    vatPercent: 14,
    applyDiscountBeforeTax: true,
    serviceBeforeVat: true,
  });
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [msg, setMsg] = useState("");

  const [name, setName] = useState("");
  const [type, setType] = useState(PROMO_TYPES[0]);
  const [priority, setPriority] = useState(100);
  const [stackable, setStackable] = useState(true);
  const [scopeType, setScopeType] = useState("invoice");
  const [payloadText, setPayloadText] = useState('{"percent":10,"minSubtotal":500}');
  const [notes, setNotes] = useState("");
  const [venueType, setVenueType] = useState<VenueType>("restaurant");
  const [kdsPrep, setKdsPrep] = useState(20);
  const [kdsWarn, setKdsWarn] = useState(5);

  async function loadAll() {
    setMsg("");
    try {
      const [pRes, prRes, vRes, kRes] = await Promise.all([
        fetch(`${base}/api/pos/policy`),
        fetch(`${base}/api/pos/promotions?active_only=false`),
        fetch(`${base}/api/restaurant/venue`),
        fetch(`${base}/api/restaurant/kds-settings`),
      ]);
      const p = await pRes.json();
      const pr = await prRes.json();
      const vj = await vRes.json();
      const kj = await kRes.json();
      setVenueType(vj.venueType === "coffee_shop" ? "coffee_shop" : "restaurant");
      setKdsPrep(Number(kj.prepTargetMinutes) || 20);
      setKdsWarn(Number(kj.warnBeforeEndMinutes) || 5);
      setPolicy({
        servicePercent: Number(p.servicePercent ?? 12.5),
        vatPercent: Number(p.vatPercent ?? 14),
        applyDiscountBeforeTax: Boolean(p.applyDiscountBeforeTax ?? true),
        serviceBeforeVat: Boolean(p.serviceBeforeVat ?? true),
      });
      setPromotions(Array.isArray(pr.promotions) ? pr.promotions : []);
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function savePolicy() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/pos/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg("تم حفظ سياسة الخدمة والضريبة.");
    } catch (e) {
      setMsg(`فشل حفظ السياسة: ${String(e)}`);
    }
  }

  async function addPromotion() {
    setMsg("");
    if (!name.trim()) {
      setMsg("اسم العرض مطلوب.");
      return;
    }
    if (!type.trim()) {
      setMsg("نوع العرض مطلوب.");
      return;
    }
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
      setMsg("تمت إضافة العرض بنجاح.");
    } catch (e) {
      setMsg(`فشل إضافة العرض: ${String(e)}`);
    }
  }

  async function saveKds() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/kds-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prepTargetMinutes: kdsPrep, warnBeforeEndMinutes: kdsWarn }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg("تم حفظ إعدادات المطبخ (زمن التحضير والتنبيه).");
    } catch (e) {
      setMsg(`فشل حفظ KDS: ${String(e)}`);
    }
  }

  async function saveVenue() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/venue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueType }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      await refreshVenue();
      setMsg("تم حفظ نوع المنشأ (مطعم / كوفي شوب) وتحديث الواجهة.");
    } catch (e) {
      setMsg(`فشل حفظ نوع المنشأ: ${String(e)}`);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>إدارة ضرائب POS والعروض</h2>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>نوع المنشأ</h3>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="radio"
              name="venue"
              checked={venueType === "restaurant"}
              onChange={() => setVenueType("restaurant")}
            />
            مطعم (جلسة — افتراضي طاولة في POS)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="radio"
              name="venue"
              checked={venueType === "coffee_shop"}
              onChange={() => setVenueType("coffee_shop")}
            />
            كوفي شوب (افتراضي سفري في POS)
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void saveVenue()}>
            حفظ نوع المنشأ
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>شاشة المطبخ (KDS)</h3>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "block" }}>
            زمن التحضير الافتراضي (دقيقة)
            <input
              type="number"
              min={1}
              max={240}
              value={kdsPrep}
              onChange={(e) => setKdsPrep(Number(e.target.value) || 20)}
              style={{ display: "block", width: 160, marginTop: 6 }}
            />
          </label>
          <label style={{ display: "block" }}>
            تنبيه قبل النهاية (دقيقة)
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={kdsWarn}
              onChange={(e) => setKdsWarn(Number(e.target.value) || 5)}
              style={{ display: "block", width: 160, marginTop: 6 }}
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void saveKds()}>
            حفظ إعدادات KDS
          </button>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>سياسة الضريبة والخدمة</h3>
          <label style={{ display: "block", marginBottom: 6 }}>
            خدمة (%)
            <input
              type="number"
              step="any"
              value={policy.servicePercent}
              onChange={(e) => setPolicy((s) => ({ ...s, servicePercent: Number(e.target.value) || 0 }))}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>
            VAT (%)
            <input
              type="number"
              step="any"
              value={policy.vatPercent}
              onChange={(e) => setPolicy((s) => ({ ...s, vatPercent: Number(e.target.value) || 0 }))}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={policy.applyDiscountBeforeTax}
              onChange={(e) => setPolicy((s) => ({ ...s, applyDiscountBeforeTax: e.target.checked }))}
            />{" "}
            الخصم قبل الضريبة
          </label>
          <label style={{ display: "block", marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={policy.serviceBeforeVat}
              onChange={(e) => setPolicy((s) => ({ ...s, serviceBeforeVat: e.target.checked }))}
            />{" "}
            الخدمة قبل VAT
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void savePolicy()}>
            حفظ السياسة
          </button>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>إضافة عرض جديد</h3>
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
          <button type="button" className="btn" onClick={() => void addPromotion()}>
            إضافة العرض
          </button>
        </div>
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
                <th style={{ padding: "6px 8px" }}>Stackable</th>
                <th style={{ padding: "6px 8px" }}>Scope</th>
                <th style={{ padding: "6px 8px" }}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px" }}>{p.name}</td>
                  <td style={{ padding: "6px 8px" }}>{p.type}</td>
                  <td style={{ padding: "6px 8px" }}>{p.priority}</td>
                  <td style={{ padding: "6px 8px" }}>{p.isStackable ? "نعم" : "لا"}</td>
                  <td style={{ padding: "6px 8px" }}>{p.scopeType || "-"}</td>
                  <td style={{ padding: "6px 8px", whiteSpace: "pre-wrap" }}>{p.payload ? JSON.stringify(p.payload) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {msg && <p style={{ color: "var(--accent2)" }}>{msg}</p>}
    </div>
  );
}


