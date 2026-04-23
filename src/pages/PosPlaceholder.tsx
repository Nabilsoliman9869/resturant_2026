import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { applyPromotions, type Promotion } from "../lib/posPromotions";
import { useVenue } from "../context/VenueContext";
import { computePosTotals, type PosLineInput } from "../lib/posTotals";
import { defaultOrderTypeForVenue, readCachedVenueType } from "../lib/venueType";

type Product = { CardGuide: string; ProductName: string; Price: number };
type CartLine = {
  id: string;
  productGuide: string;
  name: string;
  qty: number;
  unitPrice: number;
  /** استثناء السطر من احتساب خدمة 12.5% */
  excludeServiceCharge?: boolean;
  manualDiscountAmount?: number;
  manualDiscountPercent?: number;
};
type Agent = { CardGuide: string; AgentName: string; Phone: string; Mobile: string; Address: string };
type PosPolicy = { servicePercent: number; vatPercent: number; applyDiscountBeforeTax: boolean; serviceBeforeVat: boolean };

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export default function PosPlaceholder() {
  const { venueType, ready } = useVenue();
  const base = getApiBase();
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [policy, setPolicy] = useState<PosPolicy>({ servicePercent: 12.5, vatPercent: 14, applyDiscountBeforeTax: true, serviceBeforeVat: true });

  const [q, setQ] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<
    "table" | "takeaway" | "delivery" | "bar_quick" | "catering"
  >(() => defaultOrderTypeForVenue(readCachedVenueType() ?? "restaurant"));
  /** للطلب على الطاولة: يُفعَّل بعد «اكتمل الطلب» لاحتساب بند الخدمة */
  const [orderFinalized, setOrderFinalized] = useState(false);
  const [payment, setPayment] = useState("cash");

  const [phone, setPhone] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [deliveryName, setDeliveryName] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  /** رقم الطالب / هاتف إضافي للتتبع في ملاحظات الفاتورة */
  const [studentPhone, setStudentPhone] = useState("");
  const [courierName, setCourierName] = useState("");
  const [shippingCompany, setShippingCompany] = useState("");

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  /** null = استخدم نسبة سياسة POS من الخادم؛ رقم = تعديل لهذه الفاتورة فقط */
  const [servicePercentOverride, setServicePercentOverride] = useState<number | null>(null);

  async function loadProducts() {
    setMsg("");
    try {
      const [pr, pol, promo] = await Promise.all([
        fetch(`${base}/api/products`),
        fetch(`${base}/api/pos/policy`),
        fetch(`${base}/api/pos/promotions?active_only=true`),
      ]);
      const pj = tryParseJson<{ products?: unknown }>(await pr.text()) ?? {};
      const polj = tryParseJson<Record<string, unknown>>(await pol.text()) ?? {};
      const promoj = tryParseJson<{ promotions?: unknown }>(await promo.text()) ?? {};
      setProducts(Array.isArray(pj.products) ? (pj.products as Product[]) : []);
      setPolicy({
        servicePercent: toNum(polj.servicePercent, 12.5),
        vatPercent: toNum(polj.vatPercent, 14),
        applyDiscountBeforeTax: Boolean(polj.applyDiscountBeforeTax ?? true),
        serviceBeforeVat: Boolean(polj.serviceBeforeVat ?? true),
      });
      setPromotions(Array.isArray(promoj.promotions) ? (promoj.promotions as Promotion[]) : []);
    } catch (e) {
      setMsg(`تعذر تحميل البيانات: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  useEffect(() => {
    if (!ready) return;
    setOrderType(defaultOrderTypeForVenue(venueType));
  }, [ready, venueType]);

  useEffect(() => {
    if (orderType !== "table") setOrderFinalized(false);
  }, [orderType]);

  useEffect(() => {
    if (cart.length === 0) {
      setOrderFinalized(false);
      setServicePercentOverride(null);
    }
  }, [cart.length]);

  const effectiveServicePercent = servicePercentOverride ?? policy.servicePercent;

  async function lookupPhone() {
    setMsg("");
    if (!phone.trim()) return;
    try {
      const r = await fetch(`${base}/api/agents/by-phone?phone=${encodeURIComponent(phone.trim())}`);
      const j = tryParseJson<{ agents?: unknown[] }>(await r.text());
      const hit =
        j && Array.isArray(j.agents) && j.agents.length
          ? (j.agents[0] as Agent)
          : null;
      if (hit) {
        setAgent(hit);
        setDeliveryName(hit.AgentName || "");
        setDeliveryAddress(hit.Address || "");
        setMsg("تم العثور على العميل.");
      } else {
        setAgent(null);
        setMsg("لا يوجد عميل بهذا الرقم — سيتم إنشاء عميل دليفري عند الحفظ.");
      }
    } catch (e) {
      setMsg(String(e));
    }
  }

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return products;
    return products.filter((p) => p.ProductName.toLowerCase().includes(t));
  }, [products, q]);

  const promoResult = useMemo(() => applyPromotions(cart, promotions, couponCode), [cart, promotions, couponCode]);

  const posInputs: PosLineInput[] = useMemo(() => {
    const sub = cart.reduce((a, x) => a + x.qty * x.unitPrice, 0);
    return cart.map((l) => {
      const g = l.qty * l.unitPrice;
      const promoD = promoResult.lineDiscounts[l.id] || 0;
      const invShare = sub > 0 ? promoResult.invoiceDiscount * (g / sub) : 0;
      return {
        id: l.id,
        gross: g,
        promoDiscount: promoD + invShare,
        manualDiscountAmount: l.manualDiscountAmount ?? 0,
        manualDiscountPercent: l.manualDiscountPercent ?? 0,
        excludeServiceCharge: Boolean(l.excludeServiceCharge),
      };
    });
  }, [cart, promoResult.lineDiscounts, promoResult.invoiceDiscount]);

  const totals = useMemo(
    () =>
      computePosTotals({
        lines: posInputs,
        orderType,
        orderFinalized,
        servicePercent: effectiveServicePercent,
        vatPercent: policy.vatPercent,
        serviceBeforeVat: policy.serviceBeforeVat,
      }),
    [posInputs, orderType, orderFinalized, effectiveServicePercent, policy.vatPercent, policy.serviceBeforeVat],
  );

  const gross = totals.sumGross;
  const discountValue = totals.sumPromoDiscount + totals.sumManualDiscount;
  const netBeforeTax = totals.sumNet;
  const serviceCharge = totals.serviceCharge;
  const vatValue = totals.vatValue;
  const total = totals.total;

  function addProduct(p: Product) {
    setCart((prev) => {
      const ex = prev.find((x) => x.productGuide === p.CardGuide);
      if (ex) return prev.map((x) => (x.productGuide === p.CardGuide ? { ...x, qty: x.qty + 1 } : x));
      return [
        ...prev,
        {
          id: id(),
          productGuide: p.CardGuide,
          name: p.ProductName,
          qty: 1,
          unitPrice: p.Price || 0,
          excludeServiceCharge: false,
          manualDiscountAmount: 0,
          manualDiscountPercent: 0,
        },
      ];
    });
  }

  function patchLine(lineId: string, patch: Partial<Pick<CartLine, "excludeServiceCharge" | "manualDiscountAmount" | "manualDiscountPercent">>) {
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  }

  function setQty(lineId: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, qty: qty > 0 ? qty : 0 } : l)).filter((l) => l.qty > 0));
  }

  async function submitSale() {
    setMsg("");
    if (!cart.length) {
      setMsg("السلة فارغة.");
      return;
    }
    setLoading(true);
    try {
      let agentGuide = agent?.CardGuide || "";
      if (orderType === "delivery" && !agentGuide) {
        const upsert = await fetch(`${base}/api/agents/delivery-upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            AgentName: deliveryName,
            Phone: phone,
            Mobile: phone,
            FullAdress: deliveryAddress,
          }),
        });
        const ujText = await upsert.text();
        const uj = tryParseJson<{ success?: boolean; detail?: string; CardGuide?: string }>(ujText);
        if (!upsert.ok || !uj?.success) throw new Error(uj?.detail || ujText || "تعذر حفظ عميل الدليفري");
        agentGuide = String(uj.CardGuide || "");
      }

      const body = {
        orderType,
        agentGuide: agentGuide || undefined,
        paymentMethod: payment,
        orderFinalized: orderType === "table" ? orderFinalized : false,
        items: cart.map((l) => {
          const det = totals.lineDetails.find((d) => d.id === l.id);
          return {
            productGuide: l.productGuide,
            menuItemId: l.productGuide,
            name: l.name,
            quantity: l.qty,
            unitPrice: l.unitPrice,
            excludeServiceCharge: Boolean(l.excludeServiceCharge),
            manualDiscountAmount: l.manualDiscountAmount ?? 0,
            manualDiscountPercent: l.manualDiscountPercent ?? 0,
            lineNet: det?.net,
            lineServiceShare: det?.serviceShare,
            lineVatShare: det?.vatShare,
          };
        }),
        subtotal: netBeforeTax,
        discountValue,
        serviceCharge,
        tax: vatValue,
        total,
        delivery:
          orderType === "delivery"
            ? {
                phone,
                name: deliveryName,
                address: deliveryAddress,
                deliveryTime,
                payment,
                studentPhone: studentPhone.trim() || undefined,
                courierName: courierName.trim() || undefined,
                shippingCompany: shippingCompany.trim() || undefined,
              }
            : undefined,
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
      setMsg("تم تسجيل البيع بنجاح مع الخدمة والضريبة والعروض.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>نقطة البيع — احترافي</h2>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn" onClick={() => void loadProducts()}>
            تحديث البيانات
          </button>
          <select
            value={orderType}
            onChange={(e) => {
              setOrderType(
                e.target.value as "table" | "takeaway" | "delivery" | "bar_quick" | "catering",
              );
              setOrderFinalized(false);
            }}
          >
            <option value="table">طاولة (داخلي — خدمة بعد «اكتمل»)</option>
            <option value="takeaway">سفري</option>
            <option value="delivery">دليفري</option>
            <option value="bar_quick">بار / طلب سريع</option>
            <option value="catering">مناسبات / كاترينج</option>
          </select>
          {orderType === "table" && cart.length > 0 && (
            <>
              {!orderFinalized ? (
                <button type="button" className="btn btn-primary" onClick={() => setOrderFinalized(true)}>
                  اكتمل الطلب — احسب الخدمة {effectiveServicePercent}%
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => setOrderFinalized(false)}>
                  تعديل الطلب (إلغاء احتساب الخدمة)
                </button>
              )}
            </>
          )}
          <select value={payment} onChange={(e) => setPayment(e.target.value)}>
            <option value="cash">نقدي</option>
            <option value="card">بطاقة</option>
            <option value="digital">تحويل/رقمي</option>
          </select>
          <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="كوبون (اختياري)" style={{ maxWidth: 180 }} />
        </div>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "rgba(34, 211, 238, 0.06)",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem" }}>
            نسبة الخدمة لهذه الفاتورة %
            <input
              type="number"
              min={0}
              max={99}
              step={0.5}
              style={{ width: 72 }}
              value={servicePercentOverride ?? policy.servicePercent}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                setServicePercentOverride(v);
              }}
            />
          </label>
          <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
            الافتراضي من الإعدادات: {policy.servicePercent}%
          </span>
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.82rem" }} onClick={() => setServicePercentOverride(null)}>
            استخدام الافتراضي
          </button>
        </div>
        <div style={{ marginTop: 8, color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
          الخدمة الفعلية على هذه الفاتورة: <strong>{effectiveServicePercent}%</strong> على صافي الأسطر المؤهّلة (طاولة + بعد «اكتمل»
          فقط). VAT {policy.vatPercent}% {policy.serviceBeforeVat ? "على (صافي الأسطر + الخدمة)." : "على الصافي فقط."} خصم يدوي
          واستثناء سطر من الخدمة أدناه.
        </div>
      </div>

      {orderType === "delivery" && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>بيانات الدليفري</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 8 }}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="رقم الهاتف" />
            <button type="button" className="btn" onClick={() => void lookupPhone()}>
              بحث بالهاتف
            </button>
            <input value={deliveryName} onChange={(e) => setDeliveryName(e.target.value)} placeholder="اسم العميل" />
            <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="العنوان" />
            <input value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} placeholder="وقت التسليم" />
            <input value={studentPhone} onChange={(e) => setStudentPhone(e.target.value)} placeholder="رقم الطالب (اختياري)" />
            <input value={courierName} onChange={(e) => setCourierName(e.target.value)} placeholder="اسم الشاحن / الطيار" />
            <input value={shippingCompany} onChange={(e) => setShippingCompany(e.target.value)} placeholder="شركة الشحن (اختياري)" />
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>الأصناف</h3>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث صنف..." style={{ width: "100%", marginBottom: 8 }} />
          <div style={{ maxHeight: 420, overflow: "auto", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {filtered.map((p) => (
              <button key={p.CardGuide} type="button" className="btn" onClick={() => addProduct(p)}>
                + {p.ProductName}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>السلة</h3>
          {cart.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>لا توجد بنود.</div>
          ) : (
            <div style={{ maxHeight: 380, overflow: "auto" }}>
              {cart.map((l) => {
                const det = totals.lineDetails.find((x) => x.id === l.id);
                return (
                  <div key={l.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 88px", gap: 8, alignItems: "center" }}>
                      <div>{l.name}</div>
                      <input type="number" value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value) || 0)} />
                      <div style={{ fontWeight: 600 }}>{det ? det.net.toFixed(2) : "—"}</div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                        gap: 8,
                        marginTop: 8,
                        fontSize: "0.82rem",
                      }}
                    >
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(l.excludeServiceCharge)}
                          onChange={(e) => patchLine(l.id, { excludeServiceCharge: e.target.checked })}
                        />
                        بدون خدمة {effectiveServicePercent}%
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="خصم قيمة"
                        value={l.manualDiscountAmount ?? 0}
                        onChange={(e) => patchLine(l.id, { manualDiscountAmount: Number(e.target.value) || 0 })}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        placeholder="خصم %"
                        value={l.manualDiscountPercent ?? 0}
                        onChange={(e) => patchLine(l.id, { manualDiscountPercent: Number(e.target.value) || 0 })}
                      />
                    </div>
                    {det && (det.promoDiscount > 0 || det.manualDiscount > 0) && (
                      <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 4 }}>
                        خصم عرض: {det.promoDiscount.toFixed(2)} — يدوي: {det.manualDiscount.toFixed(2)}
                      </div>
                    )}
                    {orderType === "table" && orderFinalized && det && (
                      <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 2 }}>
                        حصة خدمة: {det.serviceShare.toFixed(2)} — حصة VAT تقديرية: {det.vatShare.toFixed(2)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: "0.92rem" }}>
            <div>الإجمالي قبل الخصم: {gross.toFixed(2)}</div>
            <div>الخصومات (عرض + يدوي): {discountValue.toFixed(2)}</div>
            <div>الصافي قبل الضريبة: {netBeforeTax.toFixed(2)}</div>
            {orderType === "table" && !orderFinalized && (
              <div style={{ color: "var(--warn)", marginTop: 4 }}>
                اضغط «اكتمل الطلب» لإظهار بند الخدمة {effectiveServicePercent}%.
              </div>
            )}
            {orderType === "table" && orderFinalized && (
              <div style={{ marginTop: 4, padding: "6px 8px", background: "rgba(34,211,238,0.08)", borderRadius: 6 }}>
                بند خدمة {effectiveServicePercent}% (أساس مؤهّل: {totals.eligibleNetForService.toFixed(2)}):{" "}
                <strong>{serviceCharge.toFixed(2)}</strong>
              </div>
            )}
            {(orderType !== "table" || !orderFinalized) && (
              <div style={{ color: "var(--muted)" }}>خدمة ({effectiveServicePercent}%): {serviceCharge.toFixed(2)}</div>
            )}
            <div>VAT ({policy.vatPercent}%): {vatValue.toFixed(2)}</div>
            <div style={{ fontWeight: 800, marginTop: 6 }}>الإجمالي النهائي: {total.toFixed(2)}</div>
          </div>

          {promoResult.promoNotes.length > 0 && (
            <div style={{ marginTop: 8, color: "var(--muted)", fontSize: "0.85rem" }}>
              {promoResult.promoNotes.map((n, i) => (
                <div key={i}>• {n}</div>
              ))}
            </div>
          )}

          <button type="button" className="btn btn-primary" onClick={() => void submitSale()} disabled={loading} style={{ marginTop: 10 }}>
            {loading ? "جاري الحفظ..." : "إتمام البيع"}
          </button>
        </div>
      </div>

      {msg && <p style={{ color: "var(--accent2)" }}>{msg}</p>}
    </div>
  );
}

