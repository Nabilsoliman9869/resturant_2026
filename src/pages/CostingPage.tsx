import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../lib/apiBase";

type ComponentLine = {
  id: string;
  /** CardGuide من TBL007 — يُخزَّن في الوصفة ويُمرَّر لحركة المخزون عند البيع */
  componentGuide: string;
  name: string;
  qty: number;
  unit: string;
  unitCost: number;
  locked?: boolean;
  priceSource?: "fun182" | "purchase" | "catalog";
  latestAt?: string;
};

type Product = {
  CardGuide: string;
  ProductName: string;
  Price: number;
  GroupGuide?: string;
  GroupGuid?: string;
};
type ProductGroup = {
  CardGuide: string;
  MainGuide?: string;
  LatinName?: string;
  GroupName: string;
};
type BalanceRow = { itemName: string; unitCode: string; qtyBalance: number };
type RawPriceRow = { productGuide: string; latestUnitCost: number; latestAt?: string };

const LS_KEY = "mat3am_costing_draft_v1";

function nextId() {
  return `C-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as {
      selectedProduct?: string;
      salePrice?: number;
      overheadPercent?: number;
      adminShare?: number;
      lines?: ComponentLine[];
    };
  } catch {
    return null;
  }
}

export default function CostingPage() {
  const draft = loadDraft();
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(draft?.selectedProduct || "");
  const [selectedRawGroup, setSelectedRawGroup] = useState("ALL");
  const [salePrice, setSalePrice] = useState<number>(draft?.salePrice ?? 0);
  const [overheadPercent, setOverheadPercent] = useState<number>(draft?.overheadPercent ?? 20);
  const [adminShare, setAdminShare] = useState<number>(draft?.adminShare ?? 0);
  const [lines, setLines] = useState<ComponentLine[]>(() => {
    if (draft?.lines?.length) {
      return draft.lines.map((l) => ({
        id: l.id || nextId(),
        componentGuide: (l as ComponentLine).componentGuide || "",
        name: l.name || "",
        qty: l.qty ?? 0,
        unit: l.unit || "وحدة",
        unitCost: l.unitCost ?? 0,
        locked: Boolean((l as ComponentLine).locked),
      }));
    }
    return [{ id: nextId(), componentGuide: "", name: "", qty: 0, unit: "وحدة", unitCost: 0, locked: false }];
  });
  const [msg, setMsg] = useState("");
  const [stock, setStock] = useState<BalanceRow[]>([]);
  const [rawPriceByGuide, setRawPriceByGuide] = useState<Map<string, RawPriceRow>>(() => new Map());
  const [rawProducts, setRawProducts] = useState<Product[]>([]);
  const [rawProductsAll, setRawProductsAll] = useState<Product[]>([]);

  async function loadProducts() {
    setMsg("");
    try {
      const [rp, rg, rr] = await Promise.allSettled([
        fetch(`${getApiBase()}/api/products`),
        fetch(`${getApiBase()}/api/costing/raw-groups`),
        fetch(`${getApiBase()}/api/costing/raw-material-prices`),
      ]);
      const jp =
        rp.status === "fulfilled" ? await rp.value.json().catch(() => ({})) : {};
      const jg =
        rg.status === "fulfilled" ? await rg.value.json().catch(() => ({})) : {};
      const jr =
        rr.status === "fulfilled" ? await rr.value.json().catch(() => ({})) : {};
      const list: Product[] = Array.isArray(jp.products) ? jp.products : [];
      const gl: ProductGroup[] = Array.isArray(jg.groups) ? jg.groups : [];
      const prices: RawPriceRow[] = Array.isArray(jr.prices) ? jr.prices : [];
      const priceMap = new Map<string, RawPriceRow>();
      for (const pr of prices) {
        const k = String(pr?.productGuide || "").trim();
        if (!k) continue;
        priceMap.set(k, pr);
      }
      setRawPriceByGuide(priceMap);
      setGroups(gl);
      setProducts(list);
      setLoaded(true);
      await loadRawProducts("ALL", true);
      if (!list.length) {
        setMsg("لم يتم تحميل أصناف من TBL007. تحقق من بيانات الأصناف أو اتصال الـ API.");
      }
    } catch (e) {
      setMsg(`تعذر تحميل الأصناف: ${String(e)}`);
    }
  }

  async function loadRawProducts(groupGuid = "ALL", keepAsAll = false) {
    try {
      const r = await fetch(`${getApiBase()}/api/costing/raw-products?group_guid=${encodeURIComponent(groupGuid)}`);
      if (!r.ok) return;
      const j = await r.json().catch(() => ({}));
      const list: Product[] = Array.isArray(j.products) ? j.products : [];
      setRawProducts(list);
      if (keepAsAll || groupGuid === "ALL") setRawProductsAll(list);
    } catch {
      setRawProducts([]);
    }
  }

  async function loadRecipe(productGuide: string) {
    if (!productGuide) return;
    try {
      const r = await fetch(`${getApiBase()}/api/costing/recipes?product_guide=${encodeURIComponent(productGuide)}`);
      if (!r.ok) return;
      const j = await r.json();
      const rec = j.recipe;
      if (!rec) return;
      setSalePrice(Number(rec.salePrice || 0));
      setOverheadPercent(Number(rec.overheadPercent || 0));
      setAdminShare(Number(rec.adminShareValue || 0));
      const savedLines: ComponentLine[] = Array.isArray(rec.lines)
        ? rec.lines.map(
            (ln: {
              componentProductGuide?: string;
              componentName?: string;
              quantity?: number;
              unitCode?: string;
              unitCost?: number;
            }) => ({
              id: nextId(),
              componentGuide: (ln.componentProductGuide || "").trim(),
              name: ln.componentName || "",
              qty: Number(ln.quantity || 0),
              unit: ln.unitCode || "EA",
              unitCost: Number(ln.unitCost || 0),
            }),
          )
        : [];
      if (savedLines.length) setLines(savedLines);
    } catch {
      // ignore recipe load failure
    }
  }

  async function loadStockBalance() {
    try {
      const r = await fetch(`${getApiBase()}/api/stock/balance`);
      if (!r.ok) return;
      const j = await r.json();
      const rows: BalanceRow[] = Array.isArray(j.balances)
        ? j.balances.map((x: { itemName?: string; unitCode?: string; qtyBalance?: number }) => ({
            itemName: x.itemName || "",
            unitCode: x.unitCode || "",
            qtyBalance: Number(x.qtyBalance || 0),
          }))
        : [];
      setStock(rows);
    } catch {
      setStock([]);
    }
  }

  async function saveRecipe() {
    setMsg("");
    if (!selectedProduct) {
      setMsg("اختر المنتج النهائي أولاً.");
      return;
    }
    const p = products.find((x) => x.CardGuide === selectedProduct);
    if (!p) {
      setMsg("تعذر تحديد المنتج.");
      return;
    }
    const recipeLines = lines.filter((ln) => ln.componentGuide.trim() && ln.qty > 0);
    if (!recipeLines.length) {
      setMsg("أضف مكوناً واحداً على الأقل: اختر صنفاً من TBL007 وكمية أكبر من صفر.");
      return;
    }
    try {
      const body = {
        productGuide: selectedProduct,
        productName: p.ProductName,
        salePrice,
        overheadPercent,
        adminShareValue: adminShare,
        lines: recipeLines.map((ln) => ({
          componentProductGuide: ln.componentGuide.trim(),
          componentName: ln.name,
          quantity: ln.qty,
          unitCode: ln.unit,
          unitCost: ln.unitCost,
        })),
      };
      const r = await fetch(`${getApiBase()}/api/costing/recipes/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg("تم حفظ الوصفة، وسيتم خصم مشتقاتها تلقائياً عند أي بيع لهذا المنتج.");
      await loadStockBalance();
    } catch (e) {
      setMsg(`فشل حفظ الوصفة: ${String(e)}`);
    }
  }

  const selected = useMemo(() => products.find((p) => p.CardGuide === selectedProduct) || null, [products, selectedProduct]);
  const rawGroups = groups;
  const filteredRawProducts = useMemo(() => rawProducts.filter((p) => p.CardGuide !== selectedProduct), [rawProducts, selectedProduct]);
  const componentOptionsByLine = useMemo(() => {
    const byLine = new Map<string, Product[]>();
    for (const l of lines) {
      // غير مثبت: خيارات القائمة وفق مجموعة المواد الخام المختارة فقط.
      // مثبت (ثابت): لا يخضع لفلترة المجموعة — كل أصناف الخام المتاحة.
      const source = l.locked ? rawProductsAll : rawProducts;
      const arr = source.filter((p) => {
        if (p.CardGuide === selectedProduct) return false;
        return true;
      });
      if (l.componentGuide && !arr.some((p) => p.CardGuide === l.componentGuide)) {
        const fromAll = rawProductsAll.find((p) => p.CardGuide === l.componentGuide) || products.find((p) => p.CardGuide === l.componentGuide);
        if (fromAll) arr.push(fromAll);
      }
      byLine.set(l.id, arr);
    }
    return byLine;
  }, [lines, rawProducts, rawProductsAll, products, selectedProduct]);

  useEffect(() => {
    void loadRawProducts(selectedRawGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRawGroup]);

  useEffect(() => {
    if (!loaded) void loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const materialCost = useMemo(() => lines.reduce((acc, l) => acc + l.qty * l.unitCost, 0), [lines]);
  const overheadValue = useMemo(() => (materialCost * overheadPercent) / 100, [materialCost, overheadPercent]);
  const finalCost = materialCost + overheadValue + adminShare;
  const margin = salePrice - finalCost;
  const marginPct = salePrice > 0 ? (margin / salePrice) * 100 : 0;

  function syncDraft(nextLines = lines) {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          selectedProduct,
          salePrice,
          overheadPercent,
          adminShare,
          lines: nextLines,
        })
      );
    } catch {
      // ignore local storage failure
    }
  }

  function onSelectProduct(v: string) {
    setSelectedProduct(v);
    const p = products.find((x) => x.CardGuide === v);
    if (p) setSalePrice(p.Price || 0);
    void loadRecipe(v);
    syncDraft();
  }

  function addLine() {
    const next = [...lines, { id: nextId(), componentGuide: "", name: "", qty: 0, unit: "وحدة", unitCost: 0, locked: false }];
    setLines(next);
    syncDraft(next);
  }

  async function applyComponentProduct(lineId: string, cardGuide: string) {
    const pr = products.find((x) => x.CardGuide === cardGuide);
    const purchase = rawPriceByGuide.get(cardGuide);
    let fun182Cost = 0;
    try {
      if (cardGuide) {
        const r = await fetch(`${getApiBase()}/api/costing/unit-price?product_guide=${encodeURIComponent(cardGuide)}`);
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          fun182Cost = Number(j.unitPrice || 0);
        }
      }
    } catch {
      // fallback below
    }
    const pickedCost =
      fun182Cost > 0
        ? fun182Cost
        : purchase && purchase.latestUnitCost > 0
          ? purchase.latestUnitCost
          : pr && pr.Price > 0
            ? pr.Price
            : 0;
    const next = lines.map((l) =>
      l.id === lineId
        ? {
            ...l,
            componentGuide: cardGuide,
            name: pr?.ProductName || l.name,
            unitCost: pickedCost,
            priceSource: (fun182Cost > 0 ? "fun182" : purchase && purchase.latestUnitCost > 0 ? "purchase" : "catalog") as "fun182" | "purchase" | "catalog",
            latestAt: purchase?.latestAt || "",
          }
        : l,
    );
    setLines(next);
    syncDraft(next);
  }

  function updateLine(id: string, patch: Partial<ComponentLine>) {
    const next = lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
    setLines(next);
    syncDraft(next);
  }

  function removeLine(id: string) {
    const next = lines.filter((l) => l.id !== id);
    setLines(next);
    syncDraft(next);
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>تكلفة الطبق</h2>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn" onClick={() => void loadProducts()}>
            {loaded ? "تحديث البيانات" : "تحميل الأصناف"}
          </button>
          <button type="button" className="btn" onClick={() => void loadStockBalance()}>
            عرض رصيد المخزون
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            الإعداد (الوجبة الجاهزة)
            <select value={selectedProduct} onChange={(e) => onSelectProduct(e.target.value)}>
              <option value="">— اختر الإعداد —</option>
              {products.map((p) => (
                <option key={p.CardGuide} value={p.CardGuide}>
                  {p.ProductName}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            سعر البيع
            <input type="number" step="any" value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value) || 0)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            نسبة تكاليف التشغيل (%)
            <input
              type="number"
              step="any"
              value={overheadPercent}
              onChange={(e) => setOverheadPercent(Number(e.target.value) || 0)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            نصيب المصروفات الإدارية/التشغيلية (قيمة)
            <input type="number" step="any" value={adminShare} onChange={(e) => setAdminShare(Number(e.target.value) || 0)} />
          </label>
        </div>
        {selected && <div style={{ marginTop: 8, color: "var(--muted)" }}>تم اختيار: {selected.ProductName}</div>}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ marginBottom: 8, fontWeight: 700 }}>
          مجموعات المواد الخام (TBL006)
          <span style={{ marginInlineStart: 8, color: "var(--muted)", fontWeight: 600 }}>
            — خامات الطبخ بالمطعم / Cooking ingredients
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={() => setSelectedRawGroup("ALL")}>
            ALL
          </button>
          {rawGroups.map((g) => (
            <button
              key={g.CardGuide}
              type="button"
              className="btn btn-ghost"
              style={{
                borderColor: selectedRawGroup === g.CardGuide ? "#0ea5e9" : undefined,
                boxShadow: selectedRawGroup === g.CardGuide ? "0 0 0 2px rgba(14,165,233,0.25)" : undefined,
              }}
              onClick={() => setSelectedRawGroup(g.CardGuide)}
            >
              {g.GroupName}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>مكونات الطبق (Recipe / BOM)</h3>
          <button type="button" className="btn" onClick={addLine}>
            + مكون
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--muted)" }}>
                <th style={{ padding: "6px 8px" }}>صنف TBL007</th>
                <th style={{ padding: "6px 8px" }}>الاسم (من القاعدة)</th>
                <th style={{ padding: "6px 8px" }}>تأكيد</th>
                <th style={{ padding: "6px 8px" }}>الكمية</th>
                <th style={{ padding: "6px 8px" }}>الوحدة</th>
                <th style={{ padding: "6px 8px" }}>سعر الوحدة</th>
                <th style={{ padding: "6px 8px" }}>مصدر السعر</th>
                <th style={{ padding: "6px 8px" }}>التكلفة</th>
                <th style={{ padding: "6px 8px" }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px", minWidth: 200 }}>
                    <select
                      value={l.componentGuide}
                      onChange={(e) => applyComponentProduct(l.id, e.target.value)}
                      disabled={Boolean(l.locked)}
                      style={{ width: "100%" }}
                    >
                      <option value="">— اختر صنفاً —</option>
                      {(componentOptionsByLine.get(l.id) ?? filteredRawProducts).map((p) => (
                          <option key={p.CardGuide} value={p.CardGuide}>
                            {p.ProductName}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{l.name || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(l.locked)}
                        onChange={(e) => updateLine(l.id, { locked: e.target.checked })}
                      />
                      ثابت
                    </label>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input
                      type="number"
                      step="any"
                      value={l.qty}
                      onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) || 0 })}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input value={l.unit} onChange={(e) => updateLine(l.id, { unit: e.target.value })} style={{ width: 90 }} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input
                      type="number"
                      step="any"
                      value={l.unitCost}
                      onChange={(e) => updateLine(l.id, { unitCost: Number(e.target.value) || 0 })}
                      style={{ width: 110 }}
                    />
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: "0.82rem" }}>
                    {l.priceSource === "fun182" ? "Fun182" : l.priceSource === "purchase" ? "شراء يومي" : l.priceSource === "catalog" ? "سعر البطاقة" : "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{(l.qty * l.unitCost).toFixed(2)}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <button type="button" className="btn btn-ghost" onClick={() => removeLine(l.id)}>
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>ملخص التكلفة</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
          <div>تكلفة المواد المباشرة: <strong>{materialCost.toFixed(2)}</strong></div>
          <div>تكاليف التشغيل (%): <strong>{overheadValue.toFixed(2)}</strong></div>
          <div>نصيب إداري/تشغيلي: <strong>{adminShare.toFixed(2)}</strong></div>
          <div>التكلفة النهائية للوجبة: <strong>{finalCost.toFixed(2)}</strong></div>
          <div>سعر البيع: <strong>{salePrice.toFixed(2)}</strong></div>
          <div>الهامش: <strong>{margin.toFixed(2)} ({marginPct.toFixed(1)}%)</strong></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-primary" onClick={() => void saveRecipe()}>
            حفظ الوصفة وربطها بحركة البيع
          </button>
        </div>
      </div>

      {stock.length > 0 && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>رصيد المخزون الحالي</h3>
          <div style={{ maxHeight: 260, overflow: "auto", fontSize: "0.9rem" }}>
            {stock.slice(0, 100).map((r, i) => (
              <div key={`${r.itemName}-${i}`} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", padding: "6px 0" }}>
                <span>{r.itemName}</span>
                <span>{r.qtyBalance.toFixed(3)} {r.unitCode || ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {msg && <p style={{ color: "var(--accent2)" }}>{msg}</p>}
    </div>
  );
}
