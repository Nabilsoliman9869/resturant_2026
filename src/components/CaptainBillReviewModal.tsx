import { useMemo } from "react";

export type CaptainBillReviewLine = {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  seatNo?: number | null;
  statusLabel?: string;
};

type CaptainBillReviewModalProps = {
  open: boolean;
  tableLabel: string;
  ordersCount: number;
  splitBySeat: boolean;
  returnableCount: number;
  printerHint: string;
  lines: CaptainBillReviewLine[];
  returnedLines?: CaptainBillReviewLine[];
  totals: {
    subtotal: number;
    serviceCharge: number;
    vatValue: number;
    tipAmount: number;
    total: number;
    minimumGap: number;
    ownerLabel?: string;
  };
  confirmBusy?: boolean;
  onClose: () => void;
  onPrinterHintChange: (value: string) => void;
  onOpenGuestReturn: () => void;
  onConfirm: () => void;
};

function money(n: number): string {
  return `${Number(n || 0).toFixed(2)} ج.م`;
}

function seatLabel(seatNo?: number | null): string {
  return seatNo != null && Number(seatNo) >= 1 ? `كرسي ${seatNo}` : "بدون كرسي";
}

export default function CaptainBillReviewModal(props: CaptainBillReviewModalProps) {
  const {
    open,
    tableLabel,
    ordersCount,
    splitBySeat,
    returnableCount,
    printerHint,
    lines,
    returnedLines,
    totals,
    confirmBusy,
    onClose,
    onPrinterHintChange,
    onOpenGuestReturn,
    onConfirm,
  } = props;

  const seatSections = useMemo(() => {
    const m = new Map<string, { label: string; lines: CaptainBillReviewLine[]; subtotal: number; itemsCount: number }>();
    for (const ln of lines) {
      const numericSeat = ln.seatNo != null && Number(ln.seatNo) >= 1 ? Number(ln.seatNo) : null;
      const key = numericSeat != null ? `seat:${numericSeat}` : "seat:none";
      const current =
        m.get(key) ||
        {
          label: seatLabel(numericSeat),
          lines: [],
          subtotal: 0,
          itemsCount: 0,
        };
      current.lines.push(ln);
      current.subtotal += Number(ln.lineTotal || 0);
      current.itemsCount += 1;
      m.set(key, current);
    }
    return [...m.entries()]
      .sort((a, b) => {
        const sa = a[0] === "seat:none" ? Number.MAX_SAFE_INTEGER : Number(a[0].split(":")[1] || 0);
        const sb = b[0] === "seat:none" ? Number.MAX_SAFE_INTEGER : Number(b[0].split(":")[1] || 0);
        return sa - sb;
      })
      .map(([, v]) => ({
        ...v,
        subtotal: Number(v.subtotal || 0),
      }));
  }, [lines]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="captain-bill-review-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 81,
        background: "rgba(2, 6, 23, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: "min(900px, 100%)",
          maxHeight: "92vh",
          overflow: "auto",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", marginBottom: 10 }}>
          <div>
            <h2 id="captain-bill-review-title" style={{ margin: 0, fontSize: "1.12rem" }}>
              مراجعة طلب الحساب
            </h2>
            <div style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: 4 }}>
              الطاولة: {tableLabel || "—"} · الطلبات: {ordersCount} · البنود: {lines.length}
              {splitBySeat ? " · سبليت حسب المقاعد" : ""}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            إغلاق
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1.5fr) minmax(280px,0.9fr)",
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                border: "1px solid rgba(148,163,184,0.22)",
                borderRadius: 12,
                overflow: "hidden",
                background: "rgba(15,23,42,0.18)",
                color: "var(--text)",
              }}
            >
              <div style={{ padding: "10px 12px", fontWeight: 800, borderBottom: "1px solid rgba(148,163,184,0.18)" }}>
                بنود الحساب قبل الاعتماد
              </div>
              <div style={{ maxHeight: "52vh", overflow: "auto" }}>
                {lines.length === 0 ? (
                  <div style={{ padding: 14, color: "var(--muted)" }}>لا توجد بنود صالحة للمراجعة.</div>
                ) : (
                  <div style={{ display: "grid", gap: 12, padding: 12 }}>
                    {seatSections.map((section) => (
                      <div
                        key={section.label}
                        style={{
                          border: "1px solid rgba(148,163,184,0.2)",
                          borderRadius: 12,
                          overflow: "hidden",
                          background: "rgba(2,6,23,0.22)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 12px",
                            background: "rgba(15,23,42,0.5)",
                            borderBottom: "1px solid rgba(148,163,184,0.18)",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 900, color: "#f8fafc" }}>{section.label}</div>
                            <div style={{ color: "var(--muted)", fontSize: "0.76rem", marginTop: 2 }}>
                              عدد البنود: {section.itemsCount}
                            </div>
                          </div>
                          <div style={{ textAlign: "left" }}>
                            <div style={{ color: "var(--muted)", fontSize: "0.72rem" }}>إجمالي الكرسي</div>
                            <div style={{ fontWeight: 900, color: "#f8fafc" }}>{money(section.subtotal)}</div>
                          </div>
                        </div>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem", color: "var(--text)" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.18)", background: "rgba(255,255,255,0.02)" }}>
                              <th style={{ textAlign: "right", padding: "8px 10px", color: "var(--text)" }}>الصنف</th>
                              <th style={{ textAlign: "center", padding: "8px 10px", width: 80, color: "var(--text)" }}>كمية</th>
                              <th style={{ textAlign: "left", padding: "8px 10px", width: 92, color: "var(--text)" }}>سعر</th>
                              <th style={{ textAlign: "left", padding: "8px 10px", width: 110, color: "var(--text)" }}>إجمالي</th>
                            </tr>
                          </thead>
                          <tbody>
                            {section.lines.map((ln) => (
                              <tr key={ln.key} style={{ borderBottom: "1px solid rgba(148,163,184,0.14)" }}>
                                <td style={{ padding: "8px 10px", color: "var(--text)" }}>
                                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{ln.name}</div>
                                  <div style={{ color: "var(--muted)", fontSize: "0.76rem", marginTop: 2 }}>
                                    {ln.statusLabel || "—"}
                                  </div>
                                </td>
                                <td style={{ textAlign: "center", padding: "8px 10px", color: "var(--text)" }}>
                                  {ln.quantity % 1 === 0 ? String(ln.quantity) : ln.quantity.toFixed(2)}
                                </td>
                                <td style={{ textAlign: "left", padding: "8px 10px", color: "var(--text)" }}>{money(ln.unitPrice)}</td>
                                <td style={{ textAlign: "left", padding: "8px 10px", fontWeight: 800, color: "var(--text)" }}>
                                  {money(ln.lineTotal)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ minWidth: 0, display: "grid", gap: 12, alignContent: "start" }}>
            <div className="card" style={{ margin: 0, border: "1px solid rgba(148,163,184,0.18)" }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>ملخص المراجعة</div>
              <div style={{ display: "grid", gap: 6, fontSize: "0.88rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>مجموع الأصناف</span>
                  <strong>{money(totals.subtotal)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>الخدمة</span>
                  <strong>{money(totals.serviceCharge)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>الضريبة</span>
                  <strong>{money(totals.vatValue)}</strong>
                </div>
                {totals.tipAmount > 0 ? (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>تيبس</span>
                    <strong>{money(totals.tipAmount)}</strong>
                  </div>
                ) : null}
                {totals.minimumGap > 0 ? (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#fca5a5" }}>
                    <span>فرق الحد الأدنى</span>
                    <strong>{money(totals.minimumGap)}</strong>
                  </div>
                ) : null}
                {totals.ownerLabel ? (
                  <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>ملف الفوترة: {totals.ownerLabel}</div>
                ) : null}
                <div style={{ marginTop: 6, paddingTop: 8, borderTop: "1px dashed rgba(148,163,184,0.28)", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 800 }}>الإجمالي المتوقع</span>
                  <strong style={{ fontSize: "1rem" }}>{money(totals.total)}</strong>
                </div>
              </div>
            </div>

            <div className="card" style={{ margin: 0, border: "1px solid rgba(148,163,184,0.18)" }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>المرتجع قبل طلب الحساب</div>
              <div style={{ color: "var(--muted)", fontSize: "0.84rem", lineHeight: 1.5 }}>
                راجع أي اعتراض أو إلغاء قبل إرسال الحساب للكاشير. المرتجع المعتمد فقط هو الذي ينعكس على الفاتورة النهائية.
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: 10, width: "100%", fontWeight: 800 }}
                onClick={onOpenGuestReturn}
                disabled={returnableCount <= 0}
              >
                {returnableCount > 0 ? `ترتيب المرتجع (${returnableCount})` : "لا توجد بنود متاحة للمرتجع"}
              </button>
            </div>

            <div className="card" style={{ margin: 0, border: "1px solid rgba(148,163,184,0.18)" }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>طباعة شيك الكابتن</div>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: "0.84rem" }}>الطابعة المعتمدة لهذه الشاشة</span>
                <input
                  type="text"
                  value={printerHint}
                  onChange={(e) => onPrinterHintChange(e.target.value)}
                  placeholder="اسم الطابعة أو الوصف المعتمد"
                />
              </label>
              <div style={{ color: "var(--muted)", fontSize: "0.77rem", marginTop: 8, lineHeight: 1.5 }}>
                بعد الاعتماد تُغلق نافذة طلب الحساب وتظهر الشيكات في قائمة الشيكات. يمكن بعد ذلك طباعة نسخة 1 ثم نسخة 2 وهكذا من نفس الشيك.
              </div>
            </div>

            <div className="card" style={{ margin: 0, border: "1px solid rgba(148,163,184,0.18)" }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>قراءة الطاولة</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {seatSections.map((section) => (
                  <span
                    key={section.label}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      background: "rgba(59,130,246,0.12)",
                      border: "1px solid rgba(59,130,246,0.25)",
                      fontSize: "0.76rem",
                      color: "var(--text)",
                    }}
                  >
                    {section.label}: {section.itemsCount}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {returnedLines && returnedLines.length > 0 ? (
          <div style={{ marginTop: 14, border: "1px solid rgba(239,68,68,0.35)", borderRadius: 12, overflow: "hidden", background: "rgba(239,68,68,0.06)" }}>
            <div style={{ padding: "10px 12px", fontWeight: 800, borderBottom: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
              مرتجعات الطاولة (معتمدة)
            </div>
            <div style={{ maxHeight: "24vh", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem", color: "var(--text)" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(239,68,68,0.18)", background: "rgba(255,255,255,0.02)" }}>
                    <th style={{ textAlign: "right", padding: "8px 10px" }}>الصنف</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", width: 80 }}>كمية مرتجعة</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", width: 92 }}>سعر</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", width: 110 }}>إجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {returnedLines.map((ln) => (
                    <tr key={ln.key} style={{ borderBottom: "1px solid rgba(239,68,68,0.12)" }}>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ fontWeight: 700 }}>{ln.name}</div>
                        <div style={{ color: "var(--muted)", fontSize: "0.76rem", marginTop: 2 }}>{ln.statusLabel || "—"}</div>
                      </td>
                      <td style={{ textAlign: "center", padding: "8px 10px" }}>
                        {ln.quantity % 1 === 0 ? String(ln.quantity) : ln.quantity.toFixed(2)}
                      </td>
                      <td style={{ textAlign: "left", padding: "8px 10px" }}>{money(ln.unitPrice)}</td>
                      <td style={{ textAlign: "left", padding: "8px 10px", fontWeight: 800 }}>{money(ln.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(239,68,68,0.18)" }}>
              <span style={{ fontWeight: 700 }}>إجمالي المرتجعات</span>
              <span style={{ fontWeight: 800 }}>{money(returnedLines.reduce((s, l) => s + l.lineTotal, 0))}</span>
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            رجوع
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={confirmBusy || lines.length === 0}
            onClick={onConfirm}
            style={{ fontWeight: 800 }}
          >
            {confirmBusy ? "جاري الاعتماد…" : "اعتماد طلب الحساب وطباعة الشيك"}
          </button>
        </div>
      </div>
    </div>
  );
}
