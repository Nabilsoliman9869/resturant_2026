import { useEffect, useMemo, useState } from "react";
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

type Product = { CardGuide: string; ProductName: string };

const PROMO_TYPES: { key: string; label: string; template: string }[] = [
  { key: "percent_invoice", label: "نسبة خصم على الفاتورة", template: '{"percent":10,"minSubtotal":500}' },
  { key: "buy_x_get_y", label: "اشتري X واحصل على Y", template: '{"productGuide":"","buyQty":2,"freeQty":1}' },
  { key: "tiered_qty", label: "خصم تدرجي حسب الكمية", template: '{"productGuide":"","tiers":[{"minQty":3,"percent":5},{"minQty":5,"percent":10}]}' },
  { key: "happy_hour", label: "Happy Hour (وقت محدد)", template: '{"percent":15,"from":"16:00","to":"18:00"}' },
  { key: "coupon", label: "كوبون خصم", template: '{"code":"SAVE10","percent":10}' },
];

const TYPE_NEEDS_PRODUCT = new Set(["buy_x_get_y", "tiered_qty"]);

export default function PosPromotionsSettingsPage() {
  const base = getApiBase();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState(PROMO_TYPES[0].key);
  const [priority, setPriority] = useState(100);
  const [stackable, setStackable] = useState(true);
  const [scopeType, setScopeType] = useState("invoice");
  const [payloadText, setPayloadText] = useState(PROMO_TYPES[0].template);
  const [notes, setNotes] = useState("");
  const [selectedProductGuid, setSelectedProductGuid] = useState("");

  const needsProduct = TYPE_NEEDS_PRODUCT.has(type);

  async function loadAll() {
    setMsg("");
    try {
      const [prRes, prodRes] = await Promise.all([
        fetch(`${base}/api/pos/promotions?active_only=false`),
        fetch(`${base}/api/products`),
      ]);
      const pr = await prRes.json();
      const prod = await prodRes.json().catch(() => ({}));
      setPromotions(Array.isArray(pr.promotions) ? pr.promotions : []);
      setProducts(Array.isArray(prod.products) ? (prod.products as Product[]) : []);
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [base]);

  // Update payload template when type changes
  useEffect(() => {
    const t = PROMO_TYPES.find((x) => x.key === type);
    if (t) setPayloadText(t.template);
    setSelectedProductGuid("");
  }, [type]);

  // Inject selected product GUID into payload when applicable
  useEffect(() => {
    if (!needsProduct || !selectedProductGuid) return;
    try {
      const obj = JSON.parse(payloadText);
      obj.productGuide = selectedProductGuid;
      setPayloadText(JSON.stringify(obj));
    } catch {
      // ignore malformed JSON
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProductGuid]);

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
      if (needsProduct && !String(payload.productGuide || "").trim()) {
        setMsg("اختر صنفاً من القائمة (مطلوب لهذا النوع).");
        return;
      }
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
      setSelectedProductGuid("");
      await loadAll();
      setMsg("تمت الإضافة.");
    } catch (e) {
      setMsg(`فشل: ${String(e)}`);
    }
  }

  const typeInfo = useMemo(() => PROMO_TYPES.find((x) => x.key === type), [type]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>العروض والتخفيضات</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        العروض تُطبّق تلقائياً في نقاط البيع (طلب سريع / جرسون) عند توفر الشروط.
      </p>

      <div className="grid-2" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>إضافة عرض</h3>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم العرض (مثال: عرض الويكند)" style={{ width: "100%", marginBottom: 8 }} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
            {PROMO_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 100)}
            placeholder="الأولوية (أقل رقم = أولوية أعلى)"
            style={{ width: "100%", marginBottom: 8 }}
          />
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
            <option value="invoice">على مستوى الفاتورة</option>
            <option value="line">على مستوى السطر</option>
            <option value="order_type">نوع الطلب</option>
          </select>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="checkbox" checked={stackable} onChange={(e) => setStackable(e.target.checked)} /> قابل للتجميع مع عروض أخرى
          </label>

          {needsProduct && (
            <select
              value={selectedProductGuid}
              onChange={(e) => setSelectedProductGuid(e.target.value)}
              style={{ width: "100%", marginBottom: 8 }}
            >
              <option value="">اختر الصنف المستهدف…</option>
              {products.map((p) => (
                <option key={p.CardGuide} value={p.CardGuide}>
                  {p.ProductName}
                </option>
              ))}
            </select>
          )}

          <textarea value={payloadText} onChange={(e) => setPayloadText(e.target.value)} rows={4} style={{ width: "100%", marginBottom: 8, direction: "ltr" }} />
          {typeInfo && (
            <p style={{ margin: "0 0 8px", fontSize: "0.82rem", color: "var(--muted)" }}>
              <strong>المفتاح:</strong> {typeInfo.label} — يُخزّن في حقل Payload JSON.
            </p>
          )}
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات" style={{ width: "100%", marginBottom: 8 }} />
          <button type="button" className="btn btn-primary" onClick={() => void addPromotion()}>
            إضافة العرض
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
                  <th style={{ padding: "6px 8px" }}>المجال</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px" }}>{p.name}</td>
                    <td style={{ padding: "6px 8px" }}>{PROMO_TYPES.find((x) => x.key === p.type)?.label || p.type}</td>
                    <td style={{ padding: "6px 8px" }}>{p.priority}</td>
                    <td style={{ padding: "6px 8px" }}>{p.scopeType || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h4 style={{ marginTop: 0 }}>كيفية استخدام العروض</h4>
        <ul style={{ fontSize: "0.88rem", color: "var(--muted)", lineHeight: 1.6, paddingRight: 18 }}>
          <li><strong>نسبة خصم على الفاتورة:</strong> يُطبّق تلقائياً إذا تجاوز الإجمالي الحد الأدنى (minSubtotal).</li>
          <li><strong>اشتري X واحصل على Y:</strong> يتطلب اختيار <em>صنف محدد</em> من القائمة. يُحتسب على السطر (line).</li>
          <li><strong>خصم تدرجي حسب الكمية:</strong> يتطلب اختيار <em>صنف محدد</em> + تعريف tiers (كمية → نسبة خصم).</li>
          <li><strong>Happy Hour:</strong> يُطبّق تلقائياً خلال الفترة الزمنية المحددة (من / إلى).</li>
          <li><strong>كوبون خصم:</strong> يُطبّق فقط إذا أدخل العميل الكود في حقل «قيمة الكوبون» أثناء الطلب.</li>
        </ul>
        <p style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 0 }}>
          ملاحظة: العروض غير القابلة للتجميع (قابل للتجميع = لا) تُوقف تطبيق أي عرض لاحق بمجرد تطبيقها.
        </p>
      </div>

      {msg ? <p style={{ color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}
