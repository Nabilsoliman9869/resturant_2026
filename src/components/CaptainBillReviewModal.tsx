import { useMemo } from "react";
import "../styles/operationalRoles.css";

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
    discount?: number;
  };
  /** خصم مدير قبل/مع اعتماد طلب الحساب — يظهر لصلاحية المدير فقط */
  allowManagerDiscount?: boolean;
  managerDiscountAmount?: string;
  managerDiscountPercent?: string;
  onManagerDiscountAmountChange?: (value: string) => void;
  onManagerDiscountPercentChange?: (value: string) => void;
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
    allowManagerDiscount,
    managerDiscountAmount,
    managerDiscountPercent,
    onManagerDiscountAmountChange,
    onManagerDiscountPercentChange,
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
      className="waiter-pos__glass-overlay"
      style={{ zIndex: 1310 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="waiter-pos__glass-panel waiter-pos__ops-modal--wide"
        style={{ padding: 0 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="waiter-pos__ops-modal__head">
          <div className="waiter-pos__ops-modal__head-copy">
            <h2 id="captain-bill-review-title" className="waiter-pos__ops-modal__title" style={{ fontSize: "1.28rem" }}>
              مراجعة طلب الحساب
            </h2>
            <div className="waiter-pos__ops-modal__note">
              الطاولة: {tableLabel || "—"} · الطلبات: {ordersCount} · البنود: {lines.length}
              {splitBySeat ? " · حساب على مستوى الكرسي" : ""}
            </div>
          </div>
          <button type="button" className="waiter-pos__ops-modal__close" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>

        <div className="waiter-pos__ops-modal__body" style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.5fr) minmax(280px,0.9fr)",
              gap: 16,
            }}
            className="captain-bill-review__grid"
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 16,
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.82)",
                  color: "#0f172a",
                }}
              >
                <div
                  style={{
                    padding: "12px 14px",
                    fontWeight: 900,
                    borderBottom: "1px solid rgba(15,23,42,0.1)",
                    color: "#0f172a",
                    background: "rgba(241,245,249,0.9)",
                  }}
                >
                  بنود الحساب قبل الاعتماد
                </div>
                <div style={{ maxHeight: "52vh", overflow: "auto" }}>
                  {lines.length === 0 ? (
                    <div style={{ padding: 14, color: "#475569", fontWeight: 700 }}>لا توجد بنود صالحة للمراجعة.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 12, padding: 12 }}>
                      {seatSections.map((section) => (
                        <div
                          key={section.label}
                          style={{
                            border: "1px solid rgba(15,23,42,0.12)",
                            borderRadius: 14,
                            overflow: "hidden",
                            background: "#ffffff",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 12px",
                              background: "rgba(254,243,199,0.65)",
                              borderBottom: "1px solid rgba(180,83,9,0.22)",
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 950, color: "#78350f" }}>{section.label}</div>
                              <div style={{ color: "#92400e", fontSize: "0.78rem", marginTop: 2, fontWeight: 700 }}>
                                عدد البنود: {section.itemsCount}
                              </div>
                            </div>
                            <div style={{ textAlign: "left" }}>
                              <div style={{ color: "#92400e", fontSize: "0.72rem", fontWeight: 700 }}>إجمالي الكرسي</div>
                              <div style={{ fontWeight: 950, color: "#0f172a" }}>{money(section.subtotal)}</div>
                            </div>
                          </div>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", color: "#0f172a" }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid rgba(15,23,42,0.1)", background: "rgba(248,250,252,0.95)" }}>
                                <th style={{ textAlign: "right", padding: "8px 10px", color: "#334155" }}>الصنف</th>
                                <th style={{ textAlign: "center", padding: "8px 10px", width: 80, color: "#334155" }}>كمية</th>
                                <th style={{ textAlign: "left", padding: "8px 10px", width: 92, color: "#334155" }}>سعر</th>
                                <th style={{ textAlign: "left", padding: "8px 10px", width: 110, color: "#334155" }}>إجمالي</th>
                              </tr>
                            </thead>
                            <tbody>
                              {section.lines.map((ln) => (
                                <tr key={ln.key} style={{ borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
                                  <td style={{ padding: "8px 10px" }}>
                                    <div style={{ fontWeight: 800, color: "#0f172a" }}>{ln.name}</div>
                                    <div style={{ color: "#475569", fontSize: "0.76rem", marginTop: 2, fontWeight: 600 }}>
                                      {ln.statusLabel || "—"}
                                    </div>
                                  </td>
                                  <td style={{ textAlign: "center", padding: "8px 10px", fontWeight: 800 }}>
                                    {ln.quantity % 1 === 0 ? String(ln.quantity) : ln.quantity.toFixed(2)}
                                  </td>
                                  <td style={{ textAlign: "left", padding: "8px 10px" }}>{money(ln.unitPrice)}</td>
                                  <td style={{ textAlign: "left", padding: "8px 10px", fontWeight: 900 }}>{money(ln.lineTotal)}</td>
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
              <div
                style={{
                  margin: 0,
                  border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 14,
                  padding: 14,
                  background: "rgba(255,255,255,0.88)",
                  color: "#0f172a",
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 8 }}>ملخص المراجعة</div>
                <div style={{ display: "grid", gap: 6, fontSize: "0.9rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#475569", fontWeight: 700 }}>مجموع الأصناف</span>
                    <strong>{money(totals.subtotal)}</strong>
                  </div>
                  {Number(totals.discount || 0) > 0.001 ? (
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#b45309" }}>
                      <span style={{ fontWeight: 800 }}>خصم المدير</span>
                      <strong>− {money(Number(totals.discount || 0))}</strong>
                    </div>
                  ) : null}
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#475569", fontWeight: 700 }}>الخدمة</span>
                    <strong>{money(totals.serviceCharge)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#475569", fontWeight: 700 }}>الضريبة</span>
                    <strong>{money(totals.vatValue)}</strong>
                  </div>
                  {totals.tipAmount > 0 ? (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#475569", fontWeight: 700 }}>تيبس</span>
                      <strong>{money(totals.tipAmount)}</strong>
                    </div>
                  ) : null}
                  {totals.minimumGap > 0 ? (
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#b91c1c" }}>
                      <span style={{ fontWeight: 800 }}>فرق الحد الأدنى</span>
                      <strong>{money(totals.minimumGap)}</strong>
                    </div>
                  ) : null}
                  {totals.ownerLabel ? (
                    <div style={{ color: "#475569", fontSize: "0.8rem", fontWeight: 700 }}>ملف الفوترة: {totals.ownerLabel}</div>
                  ) : null}
                  <div
                    style={{
                      marginTop: 6,
                      paddingTop: 8,
                      borderTop: "1px dashed rgba(15, 23, 42, 0.18)",
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontWeight: 900 }}>الإجمالي المتوقع</span>
                    <strong style={{ fontSize: "1.05rem" }}>{money(totals.total)}</strong>
                  </div>
                </div>
              </div>

              {allowManagerDiscount ? (
                <div
                  style={{
                    margin: 0,
                    border: "1px solid rgba(180, 83, 9, 0.35)",
                    borderRadius: 14,
                    padding: 14,
                    background: "rgba(255, 251, 235, 0.95)",
                    color: "#0f172a",
                  }}
                >
                  <div style={{ fontWeight: 900, marginBottom: 6, color: "#92400e" }}>خصم المدير</div>
                  <div style={{ color: "#78350f", fontSize: "0.82rem", lineHeight: 1.45, fontWeight: 650, marginBottom: 10 }}>
                    يمكن تطبيق خصم قيمة أو نسبة قبل اعتماد الشيك. بعد الطباعة يبقى الخصم متاحاً أيضاً من شاشة الشيك طالما لم يُسدَّد.
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ color: "#78350f", fontSize: "0.8rem", fontWeight: 700 }}>خصم قيمة (ج.م)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={managerDiscountAmount || ""}
                        onChange={(e) => onManagerDiscountAmountChange?.(e.target.value)}
                        placeholder="0"
                        disabled={confirmBusy}
                        style={{
                          padding: "0.55rem 0.7rem",
                          borderRadius: 10,
                          border: "1px solid rgba(180, 83, 9, 0.35)",
                          background: "#fff",
                          color: "#0f172a",
                          fontWeight: 700,
                        }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ color: "#78350f", fontSize: "0.8rem", fontWeight: 700 }}>خصم نسبة (%)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={managerDiscountPercent || ""}
                        onChange={(e) => onManagerDiscountPercentChange?.(e.target.value)}
                        placeholder="0"
                        disabled={confirmBusy}
                        style={{
                          padding: "0.55rem 0.7rem",
                          borderRadius: 10,
                          border: "1px solid rgba(180, 83, 9, 0.35)",
                          background: "#fff",
                          color: "#0f172a",
                          fontWeight: 700,
                        }}
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  margin: 0,
                  border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 14,
                  padding: 14,
                  background: "rgba(255,255,255,0.88)",
                  color: "#0f172a",
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 8 }}>المرتجع قبل طلب الحساب</div>
                <div style={{ color: "#334155", fontSize: "0.86rem", lineHeight: 1.5, fontWeight: 650 }}>
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

              <div
                style={{
                  margin: 0,
                  border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 14,
                  padding: 14,
                  background: "rgba(255,255,255,0.88)",
                  color: "#0f172a",
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 8 }}>طباعة شيك الكابتن</div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "#475569", fontSize: "0.84rem", fontWeight: 700 }}>الطابعة المعتمدة لهذه الشاشة</span>
                  <input
                    type="text"
                    value={printerHint}
                    onChange={(e) => onPrinterHintChange(e.target.value)}
                    placeholder="اسم الطابعة أو الوصف المعتمد"
                    style={{
                      padding: "0.55rem 0.7rem",
                      borderRadius: 10,
                      border: "1px solid rgba(15,23,42,0.16)",
                      background: "#fff",
                      color: "#0f172a",
                      fontWeight: 700,
                    }}
                  />
                </label>
                <div style={{ color: "#475569", fontSize: "0.78rem", marginTop: 8, lineHeight: 1.5, fontWeight: 650 }}>
                  بعد الاعتماد تُغلق نافذة طلب الحساب وتظهر الشيكات في قائمة الشيكات. يمكن بعد ذلك طباعة نسخة 1 ثم نسخة 2 وهكذا من نفس الشيك.
                </div>
              </div>

              <div
                style={{
                  margin: 0,
                  border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 14,
                  padding: 14,
                  background: "rgba(255,255,255,0.88)",
                  color: "#0f172a",
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 8 }}>قراءة الطاولة</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {seatSections.map((section) => (
                    <span
                      key={section.label}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 999,
                        background: "rgba(14,165,233,0.12)",
                        border: "1px solid rgba(14,165,233,0.35)",
                        fontSize: "0.78rem",
                        color: "#0c4a6e",
                        fontWeight: 800,
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
            <div
              style={{
                border: "1px solid rgba(185,28,28,0.35)",
                borderRadius: 14,
                overflow: "hidden",
                background: "rgba(254,226,226,0.45)",
              }}
            >
              <div style={{ padding: "10px 12px", fontWeight: 900, borderBottom: "1px solid rgba(185,28,28,0.25)", color: "#991b1b" }}>
                مرتجعات الطاولة (معتمدة)
              </div>
              <div style={{ maxHeight: "24vh", overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem", color: "#0f172a" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(185,28,28,0.18)", background: "rgba(255,255,255,0.55)" }}>
                      <th style={{ textAlign: "right", padding: "8px 10px" }}>الصنف</th>
                      <th style={{ textAlign: "center", padding: "8px 10px", width: 80 }}>كمية مرتجعة</th>
                      <th style={{ textAlign: "left", padding: "8px 10px", width: 92 }}>سعر</th>
                      <th style={{ textAlign: "left", padding: "8px 10px", width: 110 }}>إجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnedLines.map((ln) => (
                      <tr key={ln.key} style={{ borderBottom: "1px solid rgba(185,28,28,0.12)" }}>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 800 }}>{ln.name}</div>
                          <div style={{ color: "#7f1d1d", fontSize: "0.76rem", marginTop: 2 }}>{ln.statusLabel || "—"}</div>
                        </td>
                        <td style={{ textAlign: "center", padding: "8px 10px" }}>
                          {ln.quantity % 1 === 0 ? String(ln.quantity) : ln.quantity.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "left", padding: "8px 10px" }}>{money(ln.unitPrice)}</td>
                        <td style={{ textAlign: "left", padding: "8px 10px", fontWeight: 900 }}>{money(ln.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  padding: "8px 12px",
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1px solid rgba(185,28,28,0.18)",
                  fontWeight: 800,
                  color: "#7f1d1d",
                }}
              >
                <span>إجمالي المرتجعات</span>
                <span>{money(returnedLines.reduce((s, l) => s + l.lineTotal, 0))}</span>
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              رجوع
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={confirmBusy || lines.length === 0}
              onClick={onConfirm}
              style={{ fontWeight: 900, minHeight: 46, paddingInline: 18 }}
            >
              {confirmBusy ? "جاري الاعتماد…" : "اعتماد طلب الحساب وطباعة الشيك"}
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @media (max-width: 900px) {
          .captain-bill-review__grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
