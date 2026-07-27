import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { computePosTotals, type PosLineInput } from "../lib/posTotals";
import SmartProductSearch from "../components/SmartProductSearch";
import "../styles/deliveryOrderPage.css";

type AgentHit = {
  CardGuide: string;
  AgentName: string;
  Phone?: string;
  Mobile?: string;
  Phone2?: string;
  Address?: string;
  FullAdress?: string;
};

type Product = { CardGuide: string; ProductName: string; Price: number };
type FavItem = Product & { qtyOrdered?: number; invoiceCount?: number; lastOrderedAt?: string | null };
type CartLine = {
  id: string;
  productGuide: string;
  name: string;
  qty: number;
  unitPrice: number;
  excludeServiceCharge?: boolean;
};
type ShipSvc = { CardGuide: string; ProductName: string; Price: number };

const SHIPPING_LINE_ID = "__delivery_shipping_svc__";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** شاشة طلب التوصيل — مثل جرسون الطلبات (منيو + سلة) بشروط الدليفري، بدون طاولات وبدون إطار «نقطة بيع». */
export default function DeliveryOrderPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const base = getApiBase();
  const role = String(user?.role || "cashier");
  const backTo = useMemo(() => `/app/${role}/delivery-hub`, [role]);

  const [searchQ, setSearchQ] = useState("");
  const [hits, setHits] = useState<AgentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const [agentGuid, setAgentGuid] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [driverName, setDriverName] = useState("");
  const [noVat, setNoVat] = useState(true);
  const [shippingFee, setShippingFee] = useState(0);
  const [shippingMode, setShippingMode] = useState<"service_item" | "fee">("service_item");
  const [shippingProductGuide, setShippingProductGuide] = useState("");
  const [shippingProductName, setShippingProductName] = useState("");
  const [shippingServices, setShippingServices] = useState<ShipSvc[]>([]);
  const [shippingGroupName, setShippingGroupName] = useState("خدمات الشحن");
  const [prepaidAmount, setPrepaidAmount] = useState(0);
  const [prepaidMethod, setPrepaidMethod] = useState("cash");
  const [paymentMode, setPaymentMode] = useState<"cod" | "prepaid" | "partial">("cod");
  const [deliveryTicketId, setDeliveryTicketId] = useState("");
  const [payment, setPayment] = useState("cash");

  const [catalogTab, setCatalogTab] = useState<"menu" | "favorites">("menu");
  const [products, setProducts] = useState<Product[]>([]);
  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [favHint, setFavHint] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState({ servicePercent: 0, vatPercent: 14 });

  // hydrate from hub query
  useEffect(() => {
    const ag = String(params.get("agentGuid") || "").trim();
    const n = String(params.get("name") || "").trim();
    const ph = String(params.get("phone") || "").trim();
    const ad = String(params.get("address") || "").trim();
    if (ag) setAgentGuid(ag);
    if (n) {
      setName(n);
      setSearchQ(n);
    }
    if (ph) setPhone(ph);
    if (ad) setAddress(ad);
    if (params.get("deliveryTime")) setDeliveryTime(String(params.get("deliveryTime")));
    if (params.get("driverName")) setDriverName(String(params.get("driverName")));
    if (params.get("shippingFee")) setShippingFee(toNum(params.get("shippingFee"), 0));
    if (params.get("shippingMode") === "fee" || params.get("shippingMode") === "service_item") {
      setShippingMode(params.get("shippingMode") as "fee" | "service_item");
    }
    if (params.get("shippingProductGuide")) setShippingProductGuide(String(params.get("shippingProductGuide")));
    if (params.get("shippingProductName")) setShippingProductName(String(params.get("shippingProductName")));
    if (params.get("noVat") === "0") setNoVat(false);
    if (params.get("prepaidAmount")) setPrepaidAmount(toNum(params.get("prepaidAmount"), 0));
    if (params.get("prepaidMethod")) setPrepaidMethod(String(params.get("prepaidMethod")));
    if (params.get("paymentMode") === "prepaid" || params.get("paymentMode") === "partial" || params.get("paymentMode") === "cod") {
      setPaymentMode(params.get("paymentMode") as "cod" | "prepaid" | "partial");
    }
    if (params.get("deliveryTicketId")) setDeliveryTicketId(String(params.get("deliveryTicketId")));
  }, [params]);

  useEffect(() => {
    void (async () => {
      try {
        const [pr, pol, sh] = await Promise.all([
          fetch(`${base}/api/products`),
          fetch(`${base}/api/pos/policy`),
          fetch(`${base}/api/restaurant/delivery/shipping-services`),
        ]);
        const pj = tryParseJson<{ products?: Product[] }>(await pr.text()) ?? {};
        const polj = tryParseJson<Record<string, unknown>>(await pol.text()) ?? {};
        const shj =
          tryParseJson<{
            services?: ShipSvc[];
            groupName?: string;
          }>(await sh.text()) ?? {};
        setProducts(Array.isArray(pj.products) ? pj.products : []);
        setPolicy({
          servicePercent: 0,
          vatPercent: toNum(polj.vatPercent, 14),
        });
        setShippingServices(Array.isArray(shj.services) ? shj.services : []);
        if (shj.groupName) setShippingGroupName(String(shj.groupName));
      } catch {
        setMsg("تعذر تحميل المنيو أو خدمات الشحن");
      }
    })();
  }, [base]);

  const loadFavorites = useCallback(
    async (guid: string) => {
      if (!guid) {
        setFavorites([]);
        setFavHint("اختر عميلاً لعرض الأصناف المحببة من فواتيره السابقة");
        return;
      }
      try {
        const r = await fetch(
          `${base}/api/restaurant/delivery/customer-favorites?agent_guide=${encodeURIComponent(guid)}&limit=40`,
        );
        const j =
          tryParseJson<{ favorites?: FavItem[]; hint?: string }>(await r.text()) ?? {};
        setFavorites(Array.isArray(j.favorites) ? j.favorites : []);
        setFavHint(j.hint || null);
      } catch {
        setFavorites([]);
        setFavHint("تعذر جلب الأصناف المحببة");
      }
    },
    [base],
  );

  useEffect(() => {
    void loadFavorites(agentGuid);
  }, [agentGuid, loadFavorites]);

  // customer smart search — top of screen
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const text = searchQ.trim();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const r = await fetch(`${base}/api/agents/search?search_text=${encodeURIComponent(text)}`);
          const j = tryParseJson<{ agents?: AgentHit[]; detail?: string }>(await r.text()) ?? {};
          if (!r.ok) {
            setHits([]);
            setMsg(typeof j.detail === "string" ? j.detail : "فشل بحث العملاء");
            return;
          }
          setHits(Array.isArray(j.agents) ? j.agents.slice(0, 14) : []);
        } catch {
          setHits([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 200);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [searchQ, base]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) setHits([]);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pickAgent(a: AgentHit) {
    setAgentGuid(a.CardGuide);
    setName(String(a.AgentName || ""));
    setPhone(String(a.Phone || a.Mobile || ""));
    setAddress(String(a.FullAdress || a.Address || ""));
    setSearchQ(String(a.AgentName || ""));
    setHits([]);
    setCatalogTab("favorites");
    setMsg(`تم تحميل بيانات العميل: ${a.AgentName}`);
  }

  async function ensureCustomerSaved(): Promise<string> {
    if (!name.trim() || !phone.trim()) {
      throw new Error("مطلوب اسم العميل ورقم الهاتف");
    }
    const upsert = await fetch(`${base}/api/agents/delivery-upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        AgentName: name.trim(),
        Phone: phone.trim(),
        Mobile: phone.trim(),
        FullAdress: address.trim(),
      }),
    });
    const ujText = await upsert.text();
    const uj = tryParseJson<{ success?: boolean; detail?: string; CardGuide?: string }>(ujText);
    if (!upsert.ok || !uj?.success) throw new Error(uj?.detail || ujText || "تعذر حفظ العميل في TBL016");
    const g = String(uj.CardGuide || "").trim();
    setAgentGuid(g);
    return g;
  }

  async function saveCustomerNow() {
    setMsg("");
    setBusy(true);
    try {
      const g = await ensureCustomerSaved();
      setMsg(`تم حفظ العميل في الدليل (${g.slice(0, 8)}…)`);
      await loadFavorites(g);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  function addProduct(p: { CardGuide: string; ProductName: string; Price?: number }) {
    const price = toNum(p.Price, 0);
    setCart((prev) => {
      const ex = prev.find((x) => x.productGuide === p.CardGuide && x.id !== SHIPPING_LINE_ID);
      if (ex) return prev.map((x) => (x.productGuide === p.CardGuide ? { ...x, qty: x.qty + 1 } : x));
      return [
        ...prev,
        {
          id: uid(),
          productGuide: p.CardGuide,
          name: p.ProductName,
          qty: 1,
          unitPrice: price,
          excludeServiceCharge: true,
        },
      ];
    });
  }

  function setQty(lineId: string, qty: number) {
    setCart((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, qty: qty > 0 ? qty : 0 } : l)).filter((l) => l.qty > 0),
    );
  }

  useEffect(() => {
    if (shippingMode !== "service_item") {
      setCart((prev) => prev.filter((l) => l.id !== SHIPPING_LINE_ID));
      return;
    }
    setCart((prev) => {
      const rest = prev.filter((l) => l.id !== SHIPPING_LINE_ID);
      if (!(shippingFee > 0)) return rest;
      return [
        ...rest,
        {
          id: SHIPPING_LINE_ID,
          productGuide: shippingProductGuide || "MAT3AM_DELIVERY_SHIPPING",
          name: shippingProductName || "خدمة توصيل / شحن",
          qty: 1,
          unitPrice: shippingFee,
          excludeServiceCharge: true,
        },
      ];
    });
  }, [shippingMode, shippingFee, shippingProductGuide, shippingProductName]);

  const posInputs: PosLineInput[] = useMemo(
    () =>
      cart.map((l) => ({
        id: l.id,
        gross: l.qty * l.unitPrice,
        promoDiscount: 0,
        manualDiscountAmount: 0,
        manualDiscountPercent: 0,
        excludeServiceCharge: true,
      })),
    [cart],
  );

  const totals = useMemo(
    () =>
      computePosTotals({
        lines: posInputs,
        orderType: "delivery",
        orderFinalized: false,
        servicePercent: 0,
        vatPercent: policy.vatPercent,
        serviceBeforeVat: true,
      }),
    [posInputs, policy.vatPercent],
  );

  const vatValue = noVat ? 0 : totals.vatValue;
  const shippingAddOn = shippingMode === "fee" ? shippingFee : 0;
  const total = (noVat ? totals.sumNet : totals.total) + shippingAddOn;
  const balanceDue = Math.max(0, Math.round((total - prepaidAmount) * 100) / 100);

  const menuList = useMemo(() => {
    const t = productFilter.trim().toLowerCase();
    if (!t) return products.slice(0, 80);
    return products.filter((p) => p.ProductName.toLowerCase().includes(t)).slice(0, 80);
  }, [products, productFilter]);

  async function submitOrder() {
    setMsg("");
    const foodLines = cart.filter((l) => l.id !== SHIPPING_LINE_ID);
    if (!foodLines.length && !(shippingFee > 0)) {
      setMsg("أضف أصنافاً أو خدمة شحن قبل الإرسال");
      return;
    }
    setBusy(true);
    try {
      const agentGuide = await ensureCustomerSaved();
      const body = {
        orderType: "delivery",
        agentGuide,
        paymentMethod: payment,
        orderFinalized: false,
        items: foodLines.map((l) => ({
          productGuide: l.productGuide,
          menuItemId: l.productGuide,
          name: l.name,
          quantity: l.qty,
          unitPrice: l.unitPrice,
          excludeServiceCharge: true,
        })),
        subtotal: totals.sumNet,
        discountValue: 0,
        serviceCharge: 0,
        tax: vatValue,
        total,
        delivery: {
          phone,
          name,
          address,
          deliveryTime,
          payment,
          courierName: driverName.trim() || undefined,
          shippingFee,
          shippingMode: shippingProductGuide ? "service_item" : shippingMode,
          shippingProductGuide: shippingProductGuide || undefined,
          shippingProductName: shippingProductName || undefined,
          noVat,
          paymentMode,
          prepaidAmount: prepaidAmount > 0 ? prepaidAmount : undefined,
          prepaidMethod: prepaidAmount > 0 ? prepaidMethod : undefined,
          deliveryTicketId: deliveryTicketId || undefined,
        },
        paymentBreakdown:
          prepaidAmount > 0
            ? (() => {
                const parts: Record<string, number> = {};
                const paid = Math.min(prepaidAmount, total);
                parts[prepaidMethod || payment] = paid;
                const rem = Math.max(0, Math.round((total - paid) * 100) / 100);
                if (rem > 0) parts[payment] = (parts[payment] || 0) + rem;
                return parts;
              })()
            : undefined,
      };
      const r = await fetch(`${base}/api/restaurant/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t || "فشل تسجيل الطلب");
      setCart([]);
      setMsg("تم تسجيل طلب الدليفري — العميل محفوظ في الدليل والفواتير.");
      await loadFavorites(agentGuide);
    } catch (e) {
      setMsg(`فشل الإرسال: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="delivery-order-page" dir="rtl">
      <header className="dop-top">
        <div>
          <p className="dop-eyebrow">طلب توصيل</p>
          <h1>شاشة طلب التوصيل</h1>
          <p className="dop-sub">منيو وإرسال للمطبخ — بدون طاولات · العميل يُحفظ في الدليل ويظهر في الفاتورة</p>
        </div>
        <button type="button" className="btn" onClick={() => navigate(backTo)}>
          رجوع لإدارة الدليفري
        </button>
      </header>

      {/* بحث العميل — أعلى شيء، بارز بخلفية مختلفة وعلامة بحث */}
      <div className="dop-customer-search" ref={searchWrapRef}>
        <div className="dop-customer-search__bar">
          <span className="dop-customer-search__icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
              <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
          <input
            className="dop-customer-search__input"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="ابحث عن عميل: الاسم · الهاتف · العنوان — مثال: مازن محمد"
            autoFocus
            aria-label="بحث العملاء"
          />
          {searching ? <span className="dop-customer-search__busy">بحث…</span> : null}
        </div>
        {hits.length > 0 ? (
          <ul className="dop-customer-search__hits">
            {hits.map((a) => (
              <li key={a.CardGuide}>
                <button type="button" onClick={() => pickAgent(a)}>
                  <strong>{a.AgentName}</strong>
                  <span>
                    {a.Phone || a.Mobile || "—"} · {(a.FullAdress || a.Address || "").slice(0, 70)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="dop-customer-search__hint">
          إن وُجد العميل تُملأ الخانات تلقائياً وتُفتح تبويبة الأصناف المحببة من فواتيره (TBL022 + TBL023).
        </p>
      </div>

      {msg ? <div className="dop-msg">{msg}</div> : null}

      <section className="dop-customer-card">
        <div className="dop-customer-card__grid">
          <label>
            الاسم *
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم العميل" />
          </label>
          <label>
            الهاتف *
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="رقم الهاتف" />
          </label>
          <label className="dop-span2">
            العنوان
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان الكامل" />
          </label>
          <label>
            خدمة الشحن ({shippingGroupName})
            <select
              value={shippingProductGuide}
              onChange={(e) => {
                const gid = e.target.value;
                setShippingProductGuide(gid);
                const hit = shippingServices.find((s) => s.CardGuide === gid);
                if (hit) {
                  setShippingProductName(hit.ProductName);
                  setShippingFee(Number(hit.Price) || 0);
                  setShippingMode("service_item");
                } else {
                  setShippingProductName("");
                }
              }}
            >
              <option value="">— اختر منطقة/خدمة —</option>
              {shippingServices.map((s) => (
                <option key={s.CardGuide} value={s.CardGuide}>
                  {s.ProductName} — {Number(s.Price || 0).toFixed(2)}
                </option>
              ))}
            </select>
          </label>
          <label>
            مصروف الشحن
            <input
              type="number"
              min={0}
              step={0.5}
              value={shippingFee}
              onChange={(e) => setShippingFee(toNum(e.target.value, 0))}
            />
          </label>
          <label>
            وقت التسليم
            <input value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} placeholder="فوري / اليوم 8 م" />
          </label>
          <label>
            الطيار
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="اسم الطيار" />
          </label>
          <label>
            مدفوع مسبقاً
            <input
              type="number"
              min={0}
              step={0.5}
              value={prepaidAmount}
              onChange={(e) => {
                const n = toNum(e.target.value, 0);
                setPrepaidAmount(n);
                setPaymentMode(n <= 0 ? "cod" : n >= total && total > 0 ? "prepaid" : "partial");
              }}
            />
          </label>
          <label>
            وسيلة المسبق
            <select value={prepaidMethod} onChange={(e) => setPrepaidMethod(e.target.value)} disabled={!(prepaidAmount > 0)}>
              <option value="cash">نقدي</option>
              <option value="card">بطاقة</option>
              <option value="digital">تحويل / محفظة</option>
            </select>
          </label>
          <label className="dop-check">
            <input type="checkbox" checked={noVat} onChange={(e) => setNoVat(e.target.checked)} />
            بدون ضريبة
          </label>
        </div>
        <div className="dop-customer-card__actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void saveCustomerNow()}>
            حفظ العميل في الدليل
          </button>
          {agentGuid ? <span className="dop-hint">مربوط: {agentGuid.slice(0, 8)}…</span> : null}
          <span className="dop-totals-inline">
            الإجمالي <strong>{total.toFixed(2)}</strong>
            {" · "}
            متبقي التسليم <strong>{balanceDue.toFixed(2)}</strong>
          </span>
        </div>
      </section>

      <div className="dop-workspace">
        <div className="dop-catalog">
          <div className="dop-tabs">
            <button
              type="button"
              className={`dop-tab${catalogTab === "menu" ? " is-on" : ""}`}
              onClick={() => setCatalogTab("menu")}
            >
              الأصناف
            </button>
            <button
              type="button"
              className={`dop-tab dop-tab--fav${catalogTab === "favorites" ? " is-on" : ""}`}
              onClick={() => setCatalogTab("favorites")}
            >
              الأصناف المحببة
            </button>
          </div>

          {catalogTab === "menu" ? (
            <>
              <div className="dop-product-search">
                <SmartProductSearch
                  onSelect={(hit) =>
                    addProduct({
                      CardGuide: hit.CardGuide,
                      ProductName: hit.ProductName,
                      Price: hit.Price,
                    })
                  }
                  placeholder="بحث صنف…"
                />
                <input
                  className="dop-filter"
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  placeholder="تصفية القائمة…"
                />
              </div>
              <div className="dop-product-grid">
                {menuList.map((p) => (
                  <button key={p.CardGuide} type="button" className="dop-product" onClick={() => addProduct(p)}>
                    <span>{p.ProductName}</span>
                    <em>{toNum(p.Price, 0).toFixed(2)}</em>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="dop-fav">
              {!agentGuid ? (
                <p className="dop-empty">ابحث واختر عميلاً أولاً لعرض ما طلبه سابقاً من الفواتير.</p>
              ) : favorites.length === 0 ? (
                <p className="dop-empty">{favHint || "لا أصناف محببة بعد — أول طلب يبني هذه القائمة."}</p>
              ) : (
                <div className="dop-product-grid">
                  {favorites.map((p) => (
                    <button key={p.CardGuide} type="button" className="dop-product dop-product--fav" onClick={() => addProduct(p)}>
                      <span>{p.ProductName}</span>
                      <em>{toNum(p.Price, 0).toFixed(2)}</em>
                      <small>
                        ×{Math.round(toNum(p.invoiceCount, 0))} فاتورة
                        {p.qtyOrdered ? ` · كمية ${toNum(p.qtyOrdered, 0)}` : ""}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="dop-cart">
          <h2>السلة</h2>
          <label className="dop-pay">
            تحصيل عند التسليم
            <select value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="cash">نقدي</option>
              <option value="card">بطاقة</option>
              <option value="digital">محفظة</option>
            </select>
          </label>
          {cart.length === 0 ? (
            <p className="dop-empty">السلة فارغة — اختر من الأصناف أو المحببة.</p>
          ) : (
            <ul className="dop-cart-list">
              {cart.map((l) => (
                <li key={l.id}>
                  <div>
                    <strong>{l.name}</strong>
                    <span>{(l.qty * l.unitPrice).toFixed(2)}</span>
                  </div>
                  <div className="dop-qty">
                    <button type="button" onClick={() => setQty(l.id, l.qty - 1)}>
                      −
                    </button>
                    <em>{l.qty}</em>
                    <button type="button" onClick={() => setQty(l.id, l.qty + 1)}>
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="dop-cart-sum">
            <div>
              <span>الصافي</span>
              <strong>{totals.sumNet.toFixed(2)}</strong>
            </div>
            {!noVat ? (
              <div>
                <span>ضريبة</span>
                <strong>{vatValue.toFixed(2)}</strong>
              </div>
            ) : null}
            <div>
              <span>الإجمالي</span>
              <strong>{total.toFixed(2)}</strong>
            </div>
            <div className="dop-cart-sum__due">
              <span>المتبقي عند التسليم</span>
              <strong>{balanceDue.toFixed(2)}</strong>
            </div>
          </div>
          <button type="button" className="btn btn-primary dop-submit" disabled={busy} onClick={() => void submitOrder()}>
            إرسال طلب الدليفري
          </button>
        </aside>
      </div>
    </div>
  );
}
