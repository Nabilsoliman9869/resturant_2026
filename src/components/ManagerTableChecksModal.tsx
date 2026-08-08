import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { buildMat3amActor } from "../lib/mat3amActor";
import { tryParseJson } from "../lib/tryParseJson";
import { useAuth } from "../auth/AuthContext";
import { CashierPayInvoiceModal, type CashierInvoiceRow } from "./CashierPayInvoiceModal";

type AmendLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  productGuide?: string | null;
  lineId?: string | null;
  seatNo?: number | null;
};

type ManagerTableChecksModalProps = {
  open: boolean;
  tableId: string;
  tableLabel: string;
  onClose: () => void;
};

function money(n: number): string {
  return `${(Number.isFinite(n) ? n : 0).toFixed(2)} ج.م`;
}

function statusLabel(inv: CashierInvoiceRow): string {
  if (String(inv.paidAt || "").trim()) return "مسدد";
  if (String((inv as { paymentStatus?: string }).paymentStatus || "") === "on_account") return "آجل";
  if (inv.awaitingPayment) return "بانتظار الدفع";
  return "—";
}

export function ManagerTableChecksModal({ open, tableId, tableLabel, onClose }: ManagerTableChecksModalProps) {
  const base = getApiBase();
  const { user } = useAuth();
  const [rows, setRows] = useState<CashierInvoiceRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [daysBack, setDaysBack] = useState(7);
  const [payOpen, setPayOpen] = useState(false);
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);
  const [payInitial, setPayInitial] = useState<CashierInvoiceRow | null>(null);
  const [amendInv, setAmendInv] = useState<CashierInvoiceRow | null>(null);
  const [amendLines, setAmendLines] = useState<AmendLine[]>([]);
  const [amendPayMethod, setAmendPayMethod] = useState("");
  const [amendNote, setAmendNote] = useState("");
  const [amendBusy, setAmendBusy] = useState(false);

  const dateRange = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Math.max(1, daysBack) * 86400000);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    return { from: ymd(from), to: ymd(to) };
  }, [daysBack]);

  const load = useCallback(async () => {
    if (!tableId) return;
    setLoading(true);
    setMsg("");
    try {
      const q = new URLSearchParams();
      q.set("table_id", tableId);
      q.set("payment_status", "all");
      q.set("date_from", dateRange.from);
      q.set("date_to", dateRange.to);
      const r = await fetch(`${base}/api/restaurant/invoices-local?${q.toString()}`);
      const t = await r.text();
      const j = tryParseJson<{ invoices?: CashierInvoiceRow[]; detail?: unknown }>(t) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t.slice(0, 200) || "فشل التحميل");
      setRows(Array.isArray(j.invoices) ? j.invoices : []);
    } catch (e) {
      setMsg(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [base, tableId, dateRange.from, dateRange.to]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !payOpen && !amendInv) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, payOpen, amendInv]);

  function openCheck(inv: CashierInvoiceRow) {
    const id = String(inv.invoiceId || "").trim();
    if (!id) return;
    setPayInitial(inv);
    setPayInvoiceId(id);
    setPayOpen(true);
  }

  function startAmend(inv: CashierInvoiceRow) {
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    setAmendInv(inv);
    setAmendLines(
      lines.map((ln) => {
        const qty = Math.max(0, Number(ln.quantity || 0));
        const up = Math.max(0, Number(ln.unitPrice || 0));
        return {
          name: String(ln.name || "صنف"),
          quantity: qty,
          unitPrice: up,
          lineTotal: qty * up,
          productGuide: (ln as { productGuide?: string }).productGuide ?? null,
          lineId: (ln as { lineId?: string }).lineId ?? null,
          seatNo: (ln as { seatNo?: number | null }).seatNo ?? null,
        };
      }),
    );
    setAmendPayMethod(String(inv.paymentMethod || ""));
    setAmendNote("");
  }

  async function submitAmend() {
    if (!amendInv?.invoiceId) return;
    if (!amendNote.trim()) {
      setMsg("اكتب سبب التصحيح للتدقيق.");
      return;
    }
    setAmendBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/invoices-local/manager-amend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: amendInv.invoiceId,
          note: amendNote.trim(),
          paymentMethod: amendPayMethod.trim() || undefined,
          lines: amendLines.map((ln) => ({
            name: ln.name,
            quantity: ln.quantity,
            unitPrice: ln.unitPrice,
            productGuide: ln.productGuide,
            lineId: ln.lineId,
            seatNo: ln.seatNo,
          })),
          mat3amActor: buildMat3amActor(user),
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ detail?: unknown; invoice?: CashierInvoiceRow }>(t) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t.slice(0, 240) || "فشل التصحيح");
      setAmendInv(null);
      setMsg("تم حفظ تصحيح المدير على الشيك.");
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setAmendBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="شيكات الطاولة"
      className="waiter-pos__glass-overlay"
      style={{ zIndex: 1320 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !payOpen && !amendInv) onClose();
      }}
    >
      <div
        className="waiter-pos__glass-panel waiter-pos__ops-modal--wide"
        style={{ padding: 0, overflow: "hidden" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="waiter-pos__ops-modal__head">
          <div className="waiter-pos__ops-modal__head-copy">
            <h2 className="waiter-pos__ops-modal__title" style={{ fontSize: "1.25rem" }}>
              شيكات الطاولة
            </h2>
            <div className="waiter-pos__ops-modal__note">
              {tableLabel || "طاولة"} · آخر {daysBack} يوم · كل الشيكات المنفَّذة/المعلّقة
            </div>
          </div>
          <button type="button" className="waiter-pos__ops-modal__close" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        <div className="waiter-pos__ops-modal__body">

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: "0.86rem", fontWeight: 800, color: "#0f172a" }}>
            المدى:{" "}
            <select value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value) || 7)} style={{ marginInlineStart: 6 }}>
              <option value={1}>اليوم</option>
              <option value={3}>3 أيام</option>
              <option value={7}>7 أيام</option>
              <option value={30}>30 يوم</option>
            </select>
          </label>
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.82rem" }} onClick={() => void load()} disabled={loading}>
            {loading ? "…" : "تحديث"}
          </button>
        </div>

        {msg ? (
          <p style={{ marginTop: 10, color: msg.includes("تم") ? "#166534" : "#b91c1c", fontSize: "0.88rem", fontWeight: 700 }}>{msg}</p>
        ) : null}

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", color: "#0f172a" }}>
            <thead>
              <tr style={{ textAlign: "right", borderBottom: "1px solid rgba(15,23,42,0.12)" }}>
                <th style={{ padding: "0.55rem", color: "#334155" }}>الوقت</th>
                <th style={{ padding: "0.55rem", color: "#334155" }}>رقم</th>
                <th style={{ padding: "0.55rem", color: "#334155" }}>الحالة</th>
                <th style={{ padding: "0.55rem", color: "#334155" }}>الدفع</th>
                <th style={{ padding: "0.55rem", color: "#334155" }}>الإجمالي</th>
                <th style={{ padding: "0.55rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "1rem", color: "#475569", fontWeight: 700 }}>
                    {loading ? "جاري التحميل…" : "لا شيكات لهذه الطاولة في المدى المحدد."}
                  </td>
                </tr>
              ) : (
                rows.map((inv) => {
                  const when = String(inv.paidAt || inv.requestedAt || "").replace("T", " ").slice(0, 16);
                  return (
                    <tr key={String(inv.invoiceId)} style={{ borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
                      <td style={{ padding: "0.55rem" }}>{when || "—"}</td>
                      <td style={{ padding: "0.55rem", fontWeight: 900 }}>
                        {inv.billNumber != null ? `#${inv.billNumber}` : String(inv.invoiceId || "").slice(0, 8)}
                      </td>
                      <td style={{ padding: "0.55rem" }}>{statusLabel(inv)}</td>
                      <td style={{ padding: "0.55rem" }}>{inv.paymentMethod || "—"}</td>
                      <td style={{ padding: "0.55rem", fontWeight: 900 }}>{money(Number(inv.total || 0))}</td>
                      <td style={{ padding: "0.55rem" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" className="btn btn-primary" style={{ fontSize: "0.78rem", padding: "0.28rem 0.65rem" }} onClick={() => openCheck(inv)}>
                            فتح / طباعة
                          </button>
                          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.28rem 0.65rem" }} onClick={() => startAmend(inv)}>
                            تصحيح
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      <CashierPayInvoiceModal
        open={payOpen}
        invoiceId={payInvoiceId}
        initialRow={payInitial}
        allowPayment
        dialogTitle="شيك الطاولة — مدير"
        onClose={() => {
          setPayOpen(false);
          setPayInvoiceId(null);
          setPayInitial(null);
        }}
        onChanged={() => void load()}
        onPaid={() => void load()}
      />

      {amendInv ? (
        <div
          role="dialog"
          aria-modal="true"
          className="waiter-pos__glass-overlay"
          style={{ zIndex: 1330 }}
          onClick={() => !amendBusy && setAmendInv(null)}
        >
          <div
            className="waiter-pos__glass-panel"
            style={{ width: "min(720px, calc(100vw - 28px))", maxHeight: "90vh", overflow: "auto", padding: "1.15rem 1.25rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 950, marginBottom: 8, color: "#0f172a", fontSize: "1.12rem" }}>
              تصحيح شيك {amendInv.billNumber != null ? `#${amendInv.billNumber}` : String(amendInv.invoiceId || "").slice(0, 8)}
            </div>
            <div style={{ fontSize: "0.86rem", color: "#334155", marginBottom: 10, fontWeight: 700, lineHeight: 1.5 }}>
              عدّل الأصناف/الأسعار وطريقة الدفع ثم احفظ مع سبب إلزامي (يُسجَّل في التدقيق).
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {amendLines.map((ln, idx) => (
                <div key={`al-${idx}`} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr 0.7fr auto", gap: 6, alignItems: "center" }}>
                  <input
                    value={ln.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAmendLines((prev) => prev.map((x, i) => (i === idx ? { ...x, name: v } : x)));
                    }}
                  />
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={ln.quantity}
                    onChange={(e) => {
                      const qty = Math.max(0, Number(e.target.value) || 0);
                      setAmendLines((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, quantity: qty, lineTotal: qty * x.unitPrice } : x)),
                      );
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={ln.unitPrice}
                    onChange={(e) => {
                      const up = Math.max(0, Number(e.target.value) || 0);
                      setAmendLines((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, unitPrice: up, lineTotal: x.quantity * up } : x)),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: "0.75rem" }}
                    onClick={() => setAmendLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    حذف
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 8, fontSize: "0.8rem" }}
              onClick={() =>
                setAmendLines((prev) => [...prev, { name: "صنف", quantity: 1, unitPrice: 0, lineTotal: 0 }])
              }
            >
              + بند
            </button>
            <label style={{ display: "block", marginTop: 12, fontSize: "0.82rem", fontWeight: 700 }}>
              طريقة الدفع
              <select
                value={amendPayMethod}
                onChange={(e) => setAmendPayMethod(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 4 }}
              >
                <option value="">— بدون تغيير / فارغ —</option>
                <option value="cash">نقدي</option>
                <option value="card">بطاقة</option>
                <option value="mixed">مختلط</option>
                <option value="on_account">آجل</option>
                <option value="guest">ضيف</option>
              </select>
            </label>
            <label style={{ display: "block", marginTop: 10, fontSize: "0.82rem", fontWeight: 700 }}>
              سبب التصحيح *
              <textarea
                value={amendNote}
                onChange={(e) => setAmendNote(e.target.value)}
                rows={2}
                style={{ display: "block", width: "100%", marginTop: 4 }}
                placeholder="مثال: خطأ سعر على طاولة 5 — تصحيح بعد مراجعة المدير"
              />
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn btn-ghost" disabled={amendBusy} onClick={() => setAmendInv(null)}>
                إلغاء
              </button>
              <button type="button" className="btn btn-primary" disabled={amendBusy} onClick={() => void submitAmend()}>
                {amendBusy ? "…" : "حفظ التصحيح"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
