import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../lib/apiBase";

/** مطابق لـ backend/constants.py — مجموعة الموردين في TBL015 / MainGroupGuide في TBL016 */
const SUPPLIER_GROUP_GUID = "26CBD95C-98CB-48F3-8EEA-EE5D2B0D0500";

const LS_DRAFT = "xtra-purchases-draft-v1";

type InvoiceTypeRow = { InvoiceName: string; CardGuide: string };
type AgentRow = { CardGuide: string; AgentName: string };
type ProductRow = { CardGuide: string; ProductName: string; Price: number };

type Line = {
  id: string;
  productGuide: string;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
};

function todayDMY() {
  const d = new Date();
  const dd = `${d.getDate()}`.padStart(2, "0");
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function pickPurchaseType(types: InvoiceTypeRow[]): InvoiceTypeRow | null {
  if (!types.length) return null;
  const ar = (s: string) => s.toLowerCase();
  const score = (t: InvoiceTypeRow) => {
    const n = ar(t.InvoiceName);
    if (n.includes("مشتري")) return 4;
    if (n.includes("وارد")) return 3;
    if (n.includes("شراء")) return 2;
    if (n.includes("توريد")) return 1;
    return 0;
  };
  const sorted = [...types].sort((a, b) => score(b) - score(a));
  return sorted[0] ?? types[0];
}

function nextLineId() {
  return `L-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function PurchasesPage() {
  const base = getApiBase();

  const [apiStatus, setApiStatus] = useState<"idle" | "ok" | "fail">("idle");
  const [loadErr, setLoadErr] = useState("");

  const [invoiceTypes, setInvoiceTypes] = useState<InvoiceTypeRow[]>([]);
  const [suppliers, setSuppliers] = useState<AgentRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);

  const [invoiceTypeGuid, setInvoiceTypeGuid] = useState("");
  const [supplierGuid, setSupplierGuid] = useState("");
  const [billDate, setBillDate] = useState(todayDMY);
  const [doneIn, setDoneIn] = useState(todayDMY);
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("آجل");
  const [billNumber, setBillNumber] = useState<number | null>(null);

  const [lines, setLines] = useState<Line[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");

  const [productFilter, setProductFilter] = useState("");

  const filteredProducts = useMemo(() => {
    const q = productFilter.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.ProductName.toLowerCase().includes(q));
  }, [products, productFilter]);

  const totals = useMemo(() => {
    const sum = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    return { sum };
  }, [lines]);

  const refreshNextNumber = useCallback(
    async (typeGuid: string) => {
      if (!typeGuid) {
        setBillNumber(null);
        return;
      }
      try {
        const u = new URL(`${base}/api/invoices/next-number`);
        u.searchParams.set("invoice_type", typeGuid);
        const r = await fetch(u.toString());
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setBillNumber(typeof j.next_number === "number" ? j.next_number : null);
      } catch {
        setBillNumber(null);
      }
    },
    [base]
  );

  const loadAll = useCallback(async () => {
    setLoadErr("");
    setApiStatus("idle");
    try {
      const [tRes, aRes, pRes, hRes] = await Promise.all([
        fetch(`${base}/api/invoice-types`),
        fetch(`${base}/api/agents?group_guide=${encodeURIComponent(SUPPLIER_GROUP_GUID)}`),
        fetch(`${base}/api/products`),
        fetch(`${base}/api/health`).catch(() => null),
      ]);

      if (hRes && hRes.ok) setApiStatus("ok");
      else if (hRes) setApiStatus("fail");
      else setApiStatus("ok");

      if (!tRes.ok) throw new Error(`أنواع الفواتير: ${tRes.status}`);
      if (!aRes.ok) throw new Error(`الموردين: ${aRes.status}`);
      if (!pRes.ok) throw new Error(`الأصناف: ${pRes.status}`);

      const tJson = await tRes.json();
      const aJson = await aRes.json();
      const pJson = await pRes.json();

      const types: InvoiceTypeRow[] = (tJson.invoice_types || []).map((x: { InvoiceName: string; CardGuide: string }) => ({
        InvoiceName: x.InvoiceName,
        CardGuide: String(x.CardGuide).toUpperCase(),
      }));
      setInvoiceTypes(types);

      const chosen = pickPurchaseType(types);
      if (chosen) {
        setInvoiceTypeGuid(chosen.CardGuide);
        void refreshNextNumber(chosen.CardGuide);
      }

      setSuppliers((aJson.agents || []).map((x: { CardGuide: string; AgentName: string }) => ({ CardGuide: x.CardGuide, AgentName: x.AgentName })));
      setProducts(
        (pJson.products || []).map((x: { CardGuide: string; ProductName: string; Price?: number }) => ({
          CardGuide: x.CardGuide,
          ProductName: x.ProductName,
          Price: typeof x.Price === "number" ? x.Price : 0,
        }))
      );
    } catch (e) {
      setApiStatus("fail");
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [base, refreshNextNumber]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_DRAFT);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        invoiceTypeGuid?: string;
        supplierGuid?: string;
        billDate?: string;
        doneIn?: string;
        notes?: string;
        paymentMethod?: string;
        lines?: Line[];
      };
      if (d.invoiceTypeGuid) setInvoiceTypeGuid(d.invoiceTypeGuid);
      if (d.supplierGuid) setSupplierGuid(d.supplierGuid);
      if (d.billDate) setBillDate(d.billDate);
      if (d.doneIn) setDoneIn(d.doneIn);
      if (d.notes) setNotes(d.notes);
      if (d.paymentMethod) setPaymentMethod(d.paymentMethod);
      if (d.lines && Array.isArray(d.lines) && d.lines.length) setLines(d.lines);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(
          LS_DRAFT,
          JSON.stringify({
            invoiceTypeGuid,
            supplierGuid,
            billDate,
            doneIn,
            notes,
            paymentMethod,
            lines,
          })
        );
      } catch {
        /* ignore */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [invoiceTypeGuid, supplierGuid, billDate, doneIn, notes, paymentMethod, lines]);

  function addLineFromProduct(p: ProductRow) {
    setLines((prev) => [
      ...prev,
      {
        id: nextLineId(),
        productGuide: p.CardGuide,
        productName: p.ProductName,
        quantity: 1,
        unit: "PK",
        unitPrice: p.Price > 0 ? p.Price : 0,
      },
    ]);
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveErr("");
    setSaveMsg("");
    if (!invoiceTypeGuid) {
      setSaveErr("اختر نوع فاتورة (من TBL020).");
      return;
    }
    if (!supplierGuid) {
      setSaveErr("اختر المورد من قائمة الموردين (مجموعة الموردين في TBL016).");
      return;
    }
    if (!lines.length) {
      setSaveErr("أضف سطراً واحداً على الأقل من الأصناف (TBL007).");
      return;
    }
    if (billNumber == null) {
      setSaveErr("تعذر جلب رقم الفاتورة التالي — تحقق من الاتصال أو نوع الفاتورة.");
      return;
    }

    const items = lines.map((l) => {
      const tv = Math.round(l.quantity * l.unitPrice * 10000) / 10000;
      return {
        ProductGuide: l.productGuide,
        ProductName: l.productName,
        Quantity: l.quantity,
        Unit: l.unit || "PK",
        UnitPrice: l.unitPrice,
        TotalValue: tv,
      };
    });

    const body = {
      BillNumber: billNumber,
      BillDate: billDate,
      DoneIn: doneIn,
      AgentGuide: supplierGuid,
      Notes: notes || undefined,
      InvoiceType: invoiceTypeGuid,
      PaymentMethod: paymentMethod,
      Discount: 0,
      TaxValue: 0,
      LocalAdministrativeTax: 0,
      Items: items,
    };

    setSaving(true);
    try {
      const r = await fetch(`${base}/api/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) {
        let detail = text;
        try {
          const j = JSON.parse(text) as { detail?: string };
          if (j.detail) detail = j.detail;
        } catch {
          /* keep text */
        }
        throw new Error(detail || `HTTP ${r.status}`);
      }
      const j = JSON.parse(text) as { MainGuide?: string; message?: string };
      setSaveMsg(j.message || "تم حفظ فاتورة المشتريات في TBL022 / TBL023.");
      setLines([]);
      try {
        localStorage.removeItem(LS_DRAFT);
      } catch {
        /* ignore */
      }
      void refreshNextNumber(invoiceTypeGuid);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function exportJson() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            invoiceTypeGuid,
            supplierGuid,
            billDate,
            doneIn,
            notes,
            paymentMethod,
            lines,
            total: totals.sum,
          },
          null,
          2
        ),
      ],
      { type: "application/json;charset=utf-8" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `purchase-draft-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>فاتورة مشتريات</h2>
      <p style={{ color: "var(--muted)" }}>
        إدخال فاتورة وارد مرتبطة بنوع من{" "}
        <code style={{ color: "var(--text)" }}>TBL020</code>، والمورد من مجموعة الموردين في{" "}
        <code style={{ color: "var(--text)" }}>TBL016</code>، والأصناف من{" "}
        <code style={{ color: "var(--text)" }}>TBL007</code>. يتطلب تشغيل خادم{" "}
        <code style={{ color: "var(--text)" }}>api_server.py</code> على نفس عنوان{" "}
        <code style={{ color: "var(--text)" }}>VITE_XTRA_API</code>.
      </p>

      {apiStatus === "fail" && (
        <div className="card" style={{ borderColor: "rgba(248, 113, 113, 0.35)", marginBottom: "1rem" }}>
          <strong>تعذر التحقق من الـ API.</strong> تأكد أن الخادم يعمل على {base}
        </div>
      )}

      {loadErr && (
        <div className="card" style={{ borderColor: "rgba(248, 113, 113, 0.35)", marginBottom: "1rem" }}>
          تعذر تحميل البيانات: {loadErr}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={() => void loadAll()}>
              إعادة المحاولة
            </button>
          </div>
        </div>
      )}

      <form className="card" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            نوع الفاتورة (TBL020)
            <select
              value={invoiceTypeGuid}
              onChange={(e) => {
                const v = e.target.value;
                setInvoiceTypeGuid(v);
                void refreshNextNumber(v);
              }}
              required
            >
              <option value="">— اختر —</option>
              {invoiceTypes.map((t) => (
                <option key={t.CardGuide} value={t.CardGuide}>
                  {t.InvoiceName}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            المورد (TBL016 — مجموعة الموردين)
            <select value={supplierGuid} onChange={(e) => setSupplierGuid(e.target.value)} required>
              <option value="">— اختر مورداً —</option>
              {suppliers.map((s) => (
                <option key={s.CardGuide} value={s.CardGuide}>
                  {s.AgentName}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            تاريخ الفاتورة (يوم-شهر-سنة)
            <input value={billDate} onChange={(e) => setBillDate(e.target.value)} placeholder="DD-MM-YYYY" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            تاريخ التنفيذ
            <input value={doneIn} onChange={(e) => setDoneIn(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            طريقة الدفع
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="نقدي">نقدي</option>
              <option value="آجل">آجل</option>
              <option value="شيك">شيك</option>
              <option value="بطاقات مصرفيه">بطاقات مصرفيه</option>
              <option value="بنك مصر">بنك مصر</option>
              <option value="دفع نقدي">دفع نقدي</option>
              <option value="سوبر كاش">سوبر كاش</option>
            </select>
          </label>
        </div>

        <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          رقم الفاتورة التالي (تقديري):{" "}
          <strong style={{ color: "var(--text)" }}>{billNumber != null ? billNumber : "—"}</strong>
        </div>

        {suppliers.length === 0 && !loadErr && (
          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            لا يوجد موردون ضمن مجموعة الموردين. أنشئ مورداً في إكسترا ضمن مجموعة الموردين، أو راجع بيانات{" "}
            <code>TBL016.MainGroupGuide</code>.
          </div>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          ملاحظات
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>إضافة أصناف</div>
          <input
            type="search"
            placeholder="تصفية الأصناف..."
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            style={{ width: "100%", maxWidth: 360, marginBottom: 8 }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 140, overflow: "auto", padding: 4 }}>
            {filteredProducts.map((p) => (
              <button key={p.CardGuide} type="button" className="btn" onClick={() => addLineFromProduct(p)}>
                + {p.ProductName}
              </button>
            ))}
          </div>
          {products.length === 0 && !loadErr && (
            <div style={{ color: "var(--muted)", marginTop: 8 }}>لا توجد أصناف من الخادم — تحقق من TBL007 أو الاتصال.</div>
          )}
        </div>

        {lines.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>بنود الفاتورة</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                    <th style={{ padding: "6px 8px" }}>الصنف</th>
                    <th style={{ padding: "6px 8px" }}>الكمية</th>
                    <th style={{ padding: "6px 8px" }}>الوحدة</th>
                    <th style={{ padding: "6px 8px" }}>سعر الوحدة</th>
                    <th style={{ padding: "6px 8px" }}>الإجمالي</th>
                    <th style={{ padding: "6px 8px" }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <td style={{ padding: "6px 8px" }}>{l.productName}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <input
                          type="number"
                          min={0.001}
                          step="any"
                          value={l.quantity}
                          onChange={(e) => updateLine(l.id, { quantity: Number(e.target.value) || 0 })}
                          style={{ width: 88 }}
                        />
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <input value={l.unit} onChange={(e) => updateLine(l.id, { unit: e.target.value })} style={{ width: 64 }} />
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={l.unitPrice}
                          onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })}
                          style={{ width: 100 }}
                        />
                      </td>
                      <td style={{ padding: "6px 8px" }}>{(l.quantity * l.unitPrice).toFixed(2)}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <button type="button" className="btn" onClick={() => removeLine(l.id)}>
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontWeight: 700 }}>الإجمالي: {totals.sum.toFixed(2)}</div>
          </div>
        )}

        {saveMsg && (
          <div style={{ color: "rgba(52, 211, 153, 0.95)" }}>{saveMsg}</div>
        )}
        {saveErr && (
          <div style={{ color: "rgba(248, 113, 113, 0.95)" }}>{saveErr}</div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "جاري الحفظ…" : "حفظ في قاعدة البيانات (TBL022 / TBL023)"}
          </button>
          <button type="button" className="btn" onClick={exportJson}>
            تصدير مسودة JSON
          </button>
        </div>
      </form>
    </div>
  );
}

