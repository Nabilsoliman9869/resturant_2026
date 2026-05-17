import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import "../../styles/waiterUiEase.css";
import {
  PREVIEW_CATEGORIES,
  PREVIEW_PRODUCTS,
  PREVIEW_SEATS,
  PREVIEW_TABLE,
  type PreviewCartLine,
} from "./waiterUiPreviewMock";

type UiStyle = "classic" | "ease";
type EaseTab = "table" | "menu" | "cart" | "more";
type ClassicSection = "guests" | "cats" | "grid" | "cart";

function formatMoney(n: number): string {
  return `${n.toFixed(0)} ج.م`;
}

function cartLineId(productId: string, seatNo: number | null): string {
  return `${productId}::${seatNo ?? "g"}`;
}

export default function WaiterUiPreviewPage() {
  const [uiStyle, setUiStyle] = useState<UiStyle>("ease");
  const [categoryId, setCategoryId] = useState("all");
  const [search, setSearch] = useState("");
  const [activeSeat, setActiveSeat] = useState(1);
  const [easeTab, setEaseTab] = useState<EaseTab>("menu");
  const [classicSection, setClassicSection] = useState<ClassicSection>("grid");
  const [cart, setCart] = useState<PreviewCartLine[]>([
    { id: "p8::1", productId: "p8", name: "عصير برتقال", qty: 2, unitPrice: 28, seatNo: 1 },
  ]);
  const [feedback, setFeedback] = useState("");
  const [toast, setToast] = useState("");

  const filteredProducts = useMemo(() => {
    let list = PREVIEW_PRODUCTS;
    if (categoryId !== "all") list = list.filter((p) => p.categoryId === categoryId);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    return list;
  }, [categoryId, search]);

  const cartCount = useMemo(() => cart.reduce((s, l) => s + l.qty, 0), [cart]);
  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.qty * l.unitPrice, 0), [cart]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const addProduct = useCallback(
    (productId: string) => {
      const p = PREVIEW_PRODUCTS.find((x) => x.id === productId);
      if (!p) return;
      const seatNo = activeSeat === 0 ? null : activeSeat;
      const id = cartLineId(productId, seatNo);
      setCart((prev) => {
        const hit = prev.find((l) => l.id === id);
        if (hit) return prev.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l));
        return [...prev, { id, productId, name: p.name, qty: 1, unitPrice: p.price, seatNo }];
      });
      showToast(`أُضيف: ${p.name}`);
      if (uiStyle === "ease") setEaseTab("cart");
    },
    [activeSeat, showToast, uiStyle],
  );

  const changeQty = useCallback((lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.id === lineId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }, []);

  const copyFeedback = useCallback(() => {
    const styleLabel = uiStyle === "ease" ? "Style 2 (سهل)" : "Style 1 (كلاسيك)";
    const body = [
      "ملاحظات معاينة واجهة الجرسون — مطاعم",
      `النمط المعروض: ${styleLabel}`,
      `التاريخ: ${new Date().toLocaleString("ar-EG")}`,
      "",
      feedback.trim() || "(لا توجد ملاحظات مكتوبة)",
    ].join("\n");
    void navigator.clipboard.writeText(body).then(
      () => showToast("تم نسخ الملاحظات — الصقها في واتساب أو بريد"),
      () => showToast("انسخ الملاحظات يدوياً من الحقل"),
    );
  }, [feedback, showToast, uiStyle]);

  const seatLabel = (seatNo: number | null) => {
    if (seatNo == null || seatNo === 0) return "طلب عام";
    return PREVIEW_SEATS.find((s) => s.no === seatNo)?.label ?? `مقعد ${seatNo}`;
  };

  return (
    <PreviewFrame>
      {toast ? <div className="wui-preview__toast">{toast}</div> : null}

      <div className={`wui-preview wui-preview--${uiStyle}`}>
        <div className="wui-preview__banner">
          معاينة بصرية فقط — بيانات وهمية — لجمع اقتراحات الفريق قبل التطبيق الحقيقي
        </div>

        <div className="wui-preview__toolbar">
          <div className="wui-preview__style-toggle" role="group" aria-label="نمط العرض">
            <button type="button" className={uiStyle === "classic" ? "is-on" : ""} onClick={() => setUiStyle("classic")}>
              Style 1 — كلاسيك
            </button>
            <button type="button" className={uiStyle === "ease" ? "is-on" : ""} onClick={() => setUiStyle("ease")}>
              Style 2 — سهل
            </button>
          </div>
          <span className="wui-preview__table-pill">{PREVIEW_TABLE.name}</span>
          <span style={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: 700, width: "100%" }}>
            {uiStyle === "ease"
              ? "Style 2: تبويبات سفلية + فئات أفقية + بطاقات كبيرة + شريط إرسال ثابت"
              : "Style 1: شريط أقسام جانبي + تمرير طويل (قريب من الوضع الحالي)"}
          </span>
        </div>

        <div className="wui-preview__body">
          {uiStyle === "ease" ? (
            <EasePanels
              easeTab={easeTab}
              activeSeat={activeSeat}
              categoryId={categoryId}
              search={search}
              filteredProducts={filteredProducts}
              cart={cart}
              onSeat={setActiveSeat}
              onCategory={setCategoryId}
              onSearch={setSearch}
              onAdd={addProduct}
              onQty={changeQty}
              seatLabel={seatLabel}
            />
          ) : (
            <ClassicPanels
              classicSection={classicSection}
              activeSeat={activeSeat}
              categoryId={categoryId}
              search={search}
              filteredProducts={filteredProducts}
              cart={cart}
              cartCount={cartCount}
              cartTotal={cartTotal}
              onSeat={setActiveSeat}
              onCategory={setCategoryId}
              onSearch={setSearch}
              onAdd={addProduct}
              onQty={changeQty}
              onSection={setClassicSection}
              seatLabel={seatLabel}
            />
          )}
        </div>

        {uiStyle === "ease" ? (
          <>
            <nav className="wui-ease__tabs" aria-label="تنقل سريع">
              <TabBtn active={easeTab === "table"} icon="🪑" label="طاولة" onClick={() => setEaseTab("table")} />
              <TabBtn active={easeTab === "menu"} icon="📋" label="قائمة" onClick={() => setEaseTab("menu")} />
              <TabBtn
                active={easeTab === "cart"}
                icon="🛒"
                label="سلة"
                badge={cartCount}
                onClick={() => setEaseTab("cart")}
              />
              <TabBtn active={easeTab === "more"} icon="⋯" label="المزيد" onClick={() => setEaseTab("more")} />
            </nav>
            <div className="wui-ease__sendbar">
              <div className="wui-ease__send-summary">
                <strong>{formatMoney(cartTotal)}</strong>
                <span>{cartCount > 0 ? `${cartCount} صنف في السلة` : "السلة فارغة — أضف من القائمة"}</span>
              </div>
              <button
                type="button"
                className="wui-ease__send-btn"
                disabled={cartCount === 0}
                onClick={() => showToast("معاينة فقط — الإرسال غير متصل بالخادم")}
              >
                إرسال للمطبخ
              </button>
            </div>
          </>
        ) : null}

        <div className="wui-preview__feedback">
          <label htmlFor="wui-feedback">اقتراحاتكم (حجم الأزرار، ترتيب الفئات، ألوان…)</label>
          <textarea
            id="wui-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="مثال: نريد الفئات أكبر، زر الإرسال أعلى، شبكة 3 أعمدة للمشروبات…"
            rows={3}
          />
          <div className="wui-preview__feedback-actions">
            <button type="button" onClick={copyFeedback}>
              نسخ الملاحظات
            </button>
            <button type="button" onClick={() => setFeedback("")}>
              مسح
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: "0.68rem", color: "#64748b", lineHeight: 1.4 }}>
            الرابط: <code style={{ color: "#a5b4fc" }}>/preview/waiter-order-ui</code>
          </p>
        </div>
      </div>
    </PreviewFrame>
  );
}

function PreviewFrame({ children }: { children: ReactNode }) {
  return (
    <div className="wui-preview-frame-wrap">
      <div className="wui-preview-frame">{children}</div>
      <p className="wui-preview-frame-hint">
        على الكمبيوتر: المعاينة داخل إطار جوال — افتح نفس الرابط على الهاتف للتجربة الحقيقية
      </p>
    </div>
  );
}

function TabBtn({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`wui-ease__tab${active ? " is-on" : ""}`} onClick={onClick}>
      <span className="wui-ease__tab-icon">{icon}</span>
      {label}
      {badge != null && badge > 0 ? <span className="wui-ease__tab-badge">{badge}</span> : null}
    </button>
  );
}

function EasePanels(props: {
  easeTab: EaseTab;
  activeSeat: number;
  categoryId: string;
  search: string;
  filteredProducts: typeof PREVIEW_PRODUCTS;
  cart: PreviewCartLine[];
  onSeat: (n: number) => void;
  onCategory: (id: string) => void;
  onSearch: (v: string) => void;
  onAdd: (id: string) => void;
  onQty: (id: string, d: number) => void;
  seatLabel: (n: number | null) => string;
}) {
  const {
    easeTab,
    activeSeat,
    categoryId,
    search,
    filteredProducts,
    cart,
    onSeat,
    onCategory,
    onSearch,
    onAdd,
    onQty,
    seatLabel,
  } = props;

  return (
    <>
      <section className={`wui-ease__panel${easeTab === "table" ? " is-active" : ""}`} aria-hidden={easeTab !== "table"}>
        <PanelHdr title="الطاولة والضيوف" sub={`${PREVIEW_TABLE.guests} مقاعد`} />
        <p style={{ fontSize: "0.82rem", color: "#94a3b8", margin: "0 0 12px", lineHeight: 1.45 }}>
          اختر المقعد قبل الإضافة — كل ضيف له سلّة (معاينة).
        </p>
        <SeatPills activeSeat={activeSeat} onSeat={onSeat} />
        <div className="wui-ease__more-grid" style={{ marginTop: 16 }}>
          <button type="button" className="wui-ease__more-btn">
            طلب الحساب
          </button>
          <button type="button" className="wui-ease__more-btn">
            استدعاء كاشير
          </button>
        </div>
      </section>

      <section className={`wui-ease__panel${easeTab === "menu" ? " is-active" : ""}`} aria-hidden={easeTab !== "menu"}>
        <PanelHdr title="القائمة" sub={`مقعد: ${seatLabel(activeSeat === 0 ? null : activeSeat)}`} />
        <SeatPills activeSeat={activeSeat} onSeat={onSeat} compact />
        <div className="wui-ease__cats" role="tablist" aria-label="فئات">
          {PREVIEW_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={categoryId === c.id}
              className={`wui-ease__cat${categoryId === c.id ? " is-on" : ""}`}
              onClick={() => onCategory(c.id)}
            >
              <span className="wui-ease__cat-emoji">{c.emoji}</span>
              {c.name}
            </button>
          ))}
        </div>
        <input
          className="wui-ease__search"
          type="search"
          placeholder="بحث سريع عن صنف…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          enterKeyHint="search"
        />
        <div className="wui-ease__grid">
          {filteredProducts.map((p) => (
            <article key={p.id} className="wui-ease__product">
              <div className="wui-ease__product-name">{p.name}</div>
              <div className="wui-ease__product-meta">{p.prepMin ? `~${p.prepMin} د` : "—"}</div>
              <div className="wui-ease__product-foot">
                <span className="wui-ease__product-price">{formatMoney(p.price)}</span>
                <button type="button" className="wui-ease__product-add" aria-label={`إضافة ${p.name}`} onClick={() => onAdd(p.id)}>
                  +
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`wui-ease__panel${easeTab === "cart" ? " is-active" : ""}`} aria-hidden={easeTab !== "cart"}>
        <PanelHdr title="السلة — قبل الإرسال" />
        <CartList cart={cart} onQty={onQty} seatLabel={seatLabel} />
      </section>

      <section className={`wui-ease__panel${easeTab === "more" ? " is-active" : ""}`} aria-hidden={easeTab !== "more"}>
        <PanelHdr title="خيارات إضافية" />
        <div className="wui-ease__more-grid">
          <button type="button" className="wui-ease__more-btn">
            تحويل طاولة
          </button>
          <button type="button" className="wui-ease__more-btn">
            دمج جلسة
          </button>
          <button type="button" className="wui-ease__more-btn">
            تقرير الطاولة
          </button>
          <button type="button" className="wui-ease__more-btn">
            إيقاف صنف مطبخ
          </button>
        </div>
      </section>
    </>
  );
}

function PanelHdr({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="wui-ease__hdr">
      <h2>{title}</h2>
      {sub ? <span>{sub}</span> : null}
    </div>
  );
}

function ClassicPanels(props: {
  classicSection: ClassicSection;
  activeSeat: number;
  categoryId: string;
  search: string;
  filteredProducts: typeof PREVIEW_PRODUCTS;
  cart: PreviewCartLine[];
  cartCount: number;
  cartTotal: number;
  onSeat: (n: number) => void;
  onCategory: (id: string) => void;
  onSearch: (v: string) => void;
  onAdd: (id: string) => void;
  onQty: (id: string, d: number) => void;
  onSection: (s: ClassicSection) => void;
  seatLabel: (n: number | null) => string;
}) {
  const {
    classicSection,
    activeSeat,
    categoryId,
    search,
    filteredProducts,
    cart,
    cartCount,
    cartTotal,
    onSeat,
    onCategory,
    onSearch,
    onAdd,
    onQty,
    onSection,
    seatLabel,
  } = props;

  const rail: { id: ClassicSection; label: string }[] = [
    { id: "guests", label: "ضيوف" },
    { id: "cats", label: "فئات" },
    { id: "grid", label: "أصناف" },
    { id: "cart", label: "سلة" },
  ];

  return (
    <div className="wui-classic">
      <nav className="wui-classic__rail" aria-label="أقسام">
        {rail.map((r) => (
          <button
            key={r.id}
            type="button"
            className={classicSection === r.id ? "is-on" : ""}
            onClick={() => {
              onSection(r.id);
              document.getElementById(`wui-cl-${r.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {r.label}
          </button>
        ))}
      </nav>

      <div id="wui-cl-guests" className="wui-classic__section">
        <h3>تعريف الضيوف</h3>
        <SeatPills activeSeat={activeSeat} onSeat={onSeat} />
      </div>

      <div id="wui-cl-cats" className="wui-classic__section">
        <h3>التصنيف — الفئة</h3>
        <div className="wui-classic__cats">
          {PREVIEW_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`wui-classic__cat${categoryId === c.id ? " is-on" : ""}`}
              onClick={() => onCategory(c.id)}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
      </div>

      <div id="wui-cl-grid" className="wui-classic__section">
        <h3>الأصناف — مقعد: {seatLabel(activeSeat === 0 ? null : activeSeat)}</h3>
        <input
          className="wui-ease__search"
          type="search"
          placeholder="بحث…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <div className="wui-classic__grid">
          {filteredProducts.map((p) => (
            <button key={p.id} type="button" className="wui-classic__product" onClick={() => onAdd(p.id)}>
              <b>{p.name}</b>
              {formatMoney(p.price)}
            </button>
          ))}
        </div>
      </div>

      <div id="wui-cl-cart" className="wui-classic__section">
        <h3>قيد الإرسال</h3>
        <CartList cart={cart} onQty={onQty} seatLabel={seatLabel} />
      </div>

      <div className="wui-classic__send-float">
        <button type="button" disabled={cartCount === 0}>
          إرسال ({formatMoney(cartTotal)})
        </button>
      </div>
    </div>
  );
}

function SeatPills({
  activeSeat,
  onSeat,
  compact,
}: {
  activeSeat: number;
  onSeat: (n: number) => void;
  compact?: boolean;
}) {
  const seatStyle: CSSProperties | undefined = compact ? { marginBottom: 8 } : undefined;
  return (
    <div className="wui-ease__seats" style={seatStyle}>
      {PREVIEW_SEATS.map((s) => (
        <button
          key={s.no}
          type="button"
          className={`wui-ease__seat${activeSeat === s.no ? " is-on" : ""}`}
          onClick={() => onSeat(s.no)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function CartList({
  cart,
  onQty,
  seatLabel,
}: {
  cart: PreviewCartLine[];
  onQty: (id: string, d: number) => void;
  seatLabel: (n: number | null) => string;
}) {
  if (cart.length === 0) {
    return <p className="wui-ease__empty">السلة فارغة — أضف أصنافاً من تبويب القائمة</p>;
  }
  return (
    <div className="wui-ease__cart-list">
      {cart.map((l) => (
        <div key={l.id} className="wui-ease__cart-row">
          <div>
            <div className="wui-ease__cart-name">{l.name}</div>
            <div className="wui-ease__cart-seat">
              {seatLabel(l.seatNo)} · {formatMoney(l.unitPrice)}
            </div>
          </div>
          <div className="wui-ease__qty">
            <button type="button" aria-label="نقص" onClick={() => onQty(l.id, -1)}>
              −
            </button>
            <span>{l.qty}</span>
            <button type="button" aria-label="زيادة" onClick={() => onQty(l.id, 1)}>
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
