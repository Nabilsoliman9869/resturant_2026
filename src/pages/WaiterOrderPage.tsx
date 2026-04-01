import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { applyPromotions, type Promotion } from "../lib/posPromotions";
import "../styles/operationalRoles.css";

type Product = {
  CardGuide: string;
  ProductName: string;
  Price: number;
  GroupGuid?: string | null;
};

type ProductGroup = { CardGuide: string; GroupName: string };

type RestTable = {
  id: string;
  name: string;
  seats?: number;
  number?: number;
};

type CartLine = {
  id: string;
  productGuide: string;
  name: string;
  qty: number;
  unitPrice: number;
  seatLabel: string | null;
};

type PosPolicy = {
  servicePercent: number;
  vatPercent: number;
  applyDiscountBeforeTax: boolean;
  serviceBeforeVat: boolean;
};

function lineId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function prepMinutes(p: Product) {
  let s = 0;
  for (let i = 0; i < p.CardGuide.length; i++) s += p.CardGuide.charCodeAt(i);
  return 10 + (s % 26);
}

export default function WaiterOrderPage() {
  const base = getApiBase();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [tables, setTables] = useState<RestTable[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [policy, setPolicy] = useState<PosPolicy>({
    servicePercent: 12,
    vatPercent: 14,
    applyDiscountBeforeTax: true,
    serviceBeforeVat: true,
  });

  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [assignmentMode, setAssignmentMode] = useState<"per_seat" | "general">("per_seat");
  const [selectedSeat, setSelectedSeat] = useState(1);
  const [categoryKey, setCategoryKey] = useState<string>("all");
  const [couponCode, setCouponCode] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const groupNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) m.set(g.CardGuide, g.GroupName);
    return m;
  }, [groups]);

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) || null,
    [tables, selectedTableId]
  );

  const seatCount = Math.max(1, selectedTable?.seats ?? 2);

  const loadAll = useCallback(async () => {
    setMsg("");
    try {
      const [pr, gr, tb, pol, promo] = await Promise.all([
        fetch(`${base}/api/products`),
        fetch(`${base}/api/product-groups`),
        fetch(`${base}/api/restaurant/tables`),
        fetch(`${base}/api/pos/policy`),
        fetch(`${base}/api/pos/promotions?active_only=true`),
      ]);
      const pj = await pr.json();
      const gj = await gr.json();
      const tj = await tb.json();
      const polj = await pol.json();
      const promoj = await promo.json();

      setProducts(Array.isArray(pj.products) ? pj.products : []);
      setGroups(Array.isArray(gj.groups) ? gj.groups : []);
      const tlist: RestTable[] = Array.isArray(tj.tables) ? tj.tables : [];
      setTables(tlist);

      const fromUrl = searchParams.get("tableId");
      setSelectedTableId((prev) => {
        if (fromUrl && tlist.some((x) => x.id === fromUrl)) return fromUrl;
        if (prev && tlist.some((x) => x.id === prev)) return prev;
        if (tlist.length) {
          const t2 = tlist.find((x) => String(x.name).includes("2")) || tlist[0];
          return t2.id;
        }
        return "";
      });

      setPolicy({
        servicePercent: toNum(polj.servicePercent, 12),
        vatPercent: toNum(polj.vatPercent, 14),
        applyDiscountBeforeTax: Boolean(polj.applyDiscountBeforeTax ?? true),
        serviceBeforeVat: Boolean(polj.serviceBeforeVat ?? true),
      });
      setPromotions(Array.isArray(promoj.promotions) ? promoj.promotions : []);
    } catch (e) {
      setMsg(`تعذر تحميل البيانات: ${String(e)}`);
    }
  }, [base, searchParams]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (selectedSeat > seatCount) setSelectedSeat(seatCount);
  }, [seatCount, selectedSeat]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (categoryKey !== "all") {
      list = list.filter((p) => (p.GroupGuid || "") === categoryKey);
    }
    return list;
  }, [products, categoryKey]);

  const cartForPromo = useMemo(
    () => cart.map((l) => ({ id: l.id, productGuide: l.productGuide, name: l.name, qty: l.qty, unitPrice: l.unitPrice })),
    [cart]
  );

  const promoResult = useMemo(() => applyPromotions(cartForPromo, promotions, couponCode), [cartForPromo, promotions, couponCode]);

  const gross = useMemo(() => cart.reduce((a, l) => a + l.qty * l.unitPrice, 0), [cart]);
  const lineDiscountTotal = useMemo(
    () => Object.values(promoResult.lineDiscounts).reduce((a, v) => a + v, 0),
    [promoResult.lineDiscounts]
  );
  const discountValue = promoResult.invoiceDiscount + lineDiscountTotal;
  const netBeforeTax = Math.max(0, gross - discountValue);

  const serviceCharge = useMemo(() => {
    const baseAmount = policy.applyDiscountBeforeTax ? netBeforeTax : gross;
    return (baseAmount * policy.servicePercent) / 100;
  }, [policy.applyDiscountBeforeTax, netBeforeTax, gross, policy.servicePercent]);

  const vatValue = useMemo(() => {
    if (policy.serviceBeforeVat) {
      return ((netBeforeTax + serviceCharge) * policy.vatPercent) / 100;
    }
    return (netBeforeTax * policy.vatPercent) / 100;
  }, [policy.serviceBeforeVat, netBeforeTax, serviceCharge, policy.vatPercent]);

  const total = Math.max(0, netBeforeTax + serviceCharge + vatValue);
  const itemCount = cart.reduce((a, l) => a + l.qty, 0);

  function addProduct(p: Product) {
    const seatLabel = assignmentMode === "general" ? null : `كرسي ${selectedSeat}`;
    setCart((prev) => {
      const ex = prev.find((x) => x.productGuide === p.CardGuide && x.seatLabel === seatLabel);
      if (ex) {
        return prev.map((x) =>
          x.productGuide === p.CardGuide && x.seatLabel === seatLabel ? { ...x, qty: x.qty + 1 } : x
        );
      }
      return [
        ...prev,
        {
          id: lineId(),
          productGuide: p.CardGuide,
          name: p.ProductName,
          qty: 1,
          unitPrice: p.Price || 0,
          seatLabel,
        },
      ];
    });
  }

  function setQty(lineIdStr: string, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.id === lineIdStr ? { ...l, qty: qty > 0 ? qty : 0 } : l))
        .filter((l) => l.qty > 0)
    );
  }

  async function submitSale() {
    setMsg("");
    if (!cart.length) {
      setMsg("الطلب فارغ.");
      return;
    }
    if (!selectedTable) {
      setMsg("اختر طاولة.");
      return;
    }
    setLoading(true);
    try {
      const items = cart.map((l) => ({
        productGuide: l.productGuide,
        menuItemId: l.productGuide,
        name: l.seatLabel ? `${l.name} (${l.seatLabel})` : l.name,
        quantity: l.qty,
        unitPrice: l.unitPrice,
      }));

      const body = {
        orderType: "table",
        sessionId: selectedTable.id,
        paymentMethod: "cash",
        items,
        subtotal: netBeforeTax,
        discountValue,
        serviceCharge,
        tax: vatValue,
        total,
      };

      const r = await fetch(`${base}/api/restaurant/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setCart([]);
      setCouponCode("");
      setMsg("تم إرسال الطلب للمطبخ/الكاشير بنجاح.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="role-op waiter-pos">
      <OperationalRoleHeader
        roleTitle="جارسون الطلبات"
        onBack={() => navigate("/app/waiter/tables")}
        rightSlot={
          <>
            <select
              className="waiter-pos__select"
              value={selectedTableId}
              onChange={(e) => setSelectedTableId(e.target.value)}
              aria-label="اختيار الطاولة"
            >
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || `طاولة ${t.number ?? ""}`}
                </option>
              ))}
            </select>
            <div className="waiter-pos__table-pill">
              <span>{selectedTable?.name ?? "طاولة"}</span>
              <span style={{ color: "var(--wp-muted)", fontSize: "0.85rem" }}>عنصر {itemCount}</span>
            </div>
            <button type="button" className="waiter-pos__close" onClick={() => navigate("/app/waiter/tables")} aria-label="إغلاق">
              ×
            </button>
          </>
        }
      />

      <div className="waiter-pos__body">
        <aside className="waiter-pos__sidebar">
          <h3>توزيع الطلب</h3>
          <div className="waiter-pos__toggle-row">
            <button
              type="button"
              className={`waiter-pos__toggle ${assignmentMode === "per_seat" ? "waiter-pos__toggle--on" : ""}`}
              onClick={() => setAssignmentMode("per_seat")}
            >
              لكل كرسي
            </button>
            <button
              type="button"
              className={`waiter-pos__toggle ${assignmentMode === "general" ? "waiter-pos__toggle--on" : ""}`}
              onClick={() => setAssignmentMode("general")}
            >
              عام
            </button>
          </div>
          {assignmentMode === "per_seat" && (
            <div className="waiter-pos__seats">
              {Array.from({ length: seatCount }).map((_, i) => {
                const n = i + 1;
                return (
                  <button
                    key={n}
                    type="button"
                    className={`waiter-pos__seat ${selectedSeat === n ? "waiter-pos__seat--sel" : ""}`}
                    onClick={() => setSelectedSeat(n)}
                  >
                    <span aria-hidden>🪑</span>
                    كرسي {n}
                  </button>
                );
              })}
            </div>
          )}

          <h3>الطلب الحالي</h3>
          <div className="waiter-pos__order-box">
            {cart.length === 0 ? (
              <div style={{ color: "var(--wp-muted)", fontSize: "0.9rem" }}>لا توجد عناصر</div>
            ) : (
              cart.map((l) => {
                const grossLine = l.qty * l.unitPrice;
                const d = promoResult.lineDiscounts[l.id] || 0;
                const netLine = Math.max(0, grossLine - d);
                return (
                  <div key={l.id} className="waiter-pos__order-line">
                    <div>
                      {l.name}
                      {l.seatLabel && (
                        <span style={{ fontSize: "0.75rem", color: "var(--wp-muted)" }}> — {l.seatLabel}</span>
                      )}
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => setQty(l.id, Number(e.target.value) || 0)}
                    />
                    <span>{netLine.toFixed(0)} ج.م</span>
                  </div>
                );
              })
            )}
          </div>

          <input
            className="waiter-pos__coupon"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            placeholder="كوبون (اختياري)"
          />

          <div className="waiter-pos__footer-totals">
            <div>خدمة {policy.servicePercent}%: {serviceCharge.toFixed(2)}</div>
            <div>VAT {policy.vatPercent}%: {vatValue.toFixed(2)}</div>
            <div style={{ fontWeight: 800, marginTop: 6 }}>الإجمالي: {total.toFixed(2)} ج.م</div>
            <div className="waiter-pos__actions">
              <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" onClick={() => void loadAll()}>
                تحديث
              </button>
              <button type="button" className="waiter-pos__btn waiter-pos__btn--primary" disabled={loading} onClick={() => void submitSale()}>
                {loading ? "جاري الإرسال..." : "إرسال الطلب"}
              </button>
            </div>
          </div>
          {msg && <div className="waiter-pos__msg">{msg}</div>}
        </aside>

        <main className="waiter-pos__main">
          <div className="waiter-pos__cats">
            <button
              type="button"
              className={`waiter-pos__cat ${categoryKey === "all" ? "waiter-pos__cat--active" : ""}`}
              onClick={() => setCategoryKey("all")}
            >
              الكل
            </button>
            {groups.map((g) => (
              <button
                key={g.CardGuide}
                type="button"
                className={`waiter-pos__cat ${categoryKey === g.CardGuide ? "waiter-pos__cat--active" : ""}`}
                onClick={() => setCategoryKey(g.CardGuide)}
              >
                {g.GroupName}
              </button>
            ))}
          </div>

          <div className="waiter-pos__grid">
            {filteredProducts.map((p) => {
              const hue = hashHue(p.CardGuide);
              const bg = `linear-gradient(135deg, hsl(${hue}, 55%, 42%) 0%, hsl(${(hue + 40) % 360}, 45%, 32%) 100%)`;
              const initial = (p.ProductName || "?").trim().charAt(0);
              return (
                <button key={p.CardGuide} type="button" className="waiter-pos__card" onClick={() => addProduct(p)}>
                  <div className="waiter-pos__ribbon">{Math.round(p.Price || 0)} ج.م</div>
                  <div className="waiter-pos__card-img" style={{ background: bg }}>
                    {initial}
                  </div>
                  <div className="waiter-pos__card-body">
                    <div className="waiter-pos__card-name">{p.ProductName}</div>
                    <div className="waiter-pos__card-meta">
                      <span>🕐 {prepMinutes(p)} دقيقة</span>
                      {p.GroupGuid && <span>{groupNameById.get(p.GroupGuid) ?? ""}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}
