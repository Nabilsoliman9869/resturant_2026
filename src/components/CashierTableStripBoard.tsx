import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { CashierPayInvoiceModal } from "./CashierPayInvoiceModal";

export type TableOverviewSession = {
  sessionId: string;
  tableId?: string;
  tableDisplayName?: string;
  guestCount?: number;
  billingRequestedAt?: string | null;
  awaitingPayment?: boolean;
  awaitingInvoiceId?: string | null;
  orderCount?: number;
  kitchenInProgressCount?: number;
  linesPreview?: string;
  itemsSubtotal?: number;
};

const POLL_MS = 28000;

export function CashierTableStripBoard() {
  const base = getApiBase();
  const [sessions, setSessions] = useState<TableOverviewSession[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/table-overview`);
      const txt = await r.text();
      const j = tryParseJson<{ sessions?: TableOverviewSession[]; generatedAt?: string; detail?: unknown }>(txt) ?? {};
      if (!r.ok) {
        const d = j.detail;
        throw new Error(typeof d === "string" ? d : "فشل تحميل الملخص");
      }
      setSessions(Array.isArray(j.sessions) ? j.sessions : []);
      setGeneratedAt(typeof j.generatedAt === "string" ? j.generatedAt : "");
      setMsg("");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading && sessions.length === 0) {
    return (
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ margin: 0, color: "var(--muted)" }}>جاري تحميل ملخص الطاولات…</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <CashierPayInvoiceModal
        open={payOpen}
        invoiceId={payInvoiceId}
        initialRow={null}
        onClose={() => {
          setPayOpen(false);
          setPayInvoiceId(null);
        }}
        onPaid={() => {
          void load();
        }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem" }}>شرائح الطاولات النشطة</h3>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {generatedAt ? (
            <span style={{ fontSize: "0.72rem", color: "var(--muted)" }} title={generatedAt}>
              تحديث: {generatedAt.replace("T", " ").slice(0, 19)}
            </span>
          ) : null}
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={() => void load()}>
            تحديث
          </button>
          <NavLink to="../table-sessions" className="btn btn-ghost" style={{ fontSize: "0.78rem", textDecoration: "none" }}>
            جلسات
          </NavLink>
          <NavLink to="../invoices-local" className="btn btn-ghost" style={{ fontSize: "0.78rem", textDecoration: "none" }}>
            تسديد
          </NavLink>
        </div>
      </div>
      {msg ? <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>{msg}</p> : null}

      {sessions.length === 0 ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>لا توجد جلسات نشطة.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "0.65rem",
          }}
        >
          {sessions.map((s) => (
            <TableStrip
              key={s.sessionId}
              s={s}
              onOpenPay={(invoiceId) => {
                setPayInvoiceId(invoiceId);
                setPayOpen(true);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TableStrip({ s, onOpenPay }: { s: TableOverviewSession; onOpenPay: (invoiceId: string) => void }) {
  const bill = Boolean(s.billingRequestedAt);
  const pay = Boolean(s.awaitingPayment);
  const sub = typeof s.itemsSubtotal === "number" ? s.itemsSubtotal : 0;
  const kc = typeof s.kitchenInProgressCount === "number" ? s.kitchenInProgressCount : 0;
  const oc = typeof s.orderCount === "number" ? s.orderCount : 0;

  let border = "1px solid var(--border)";
  if (pay) border = "1px solid rgba(234, 179, 8, 0.55)";
  else if (bill) border = "1px solid rgba(249, 115, 22, 0.45)";

  return (
    <div
      style={{
        border,
        borderRadius: 10,
        padding: "0.65rem 0.75rem",
        background: pay ? "rgba(234, 179, 8, 0.06)" : bill ? "rgba(249, 115, 22, 0.05)" : "rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{s.tableDisplayName || "طاولة"}</div>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 2 }}>
        جلسة {s.sessionId.length > 10 ? `${s.sessionId.slice(0, 8)}…` : s.sessionId}
        {s.guestCount != null ? ` · ${s.guestCount} ضيف` : ""}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, fontSize: "0.75rem" }}>
        {pay && s.awaitingInvoiceId ? (
          <button
            type="button"
            onClick={() => onOpenPay(String(s.awaitingInvoiceId))}
            style={{
              padding: "2px 10px",
              borderRadius: 999,
              background: "rgba(234,179,8,0.28)",
              fontWeight: 700,
              border: "1px solid rgba(234,179,8,0.45)",
              color: "inherit",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            تسديد
          </button>
        ) : pay ? (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(234,179,8,0.2)", fontWeight: 700 }}>بانتظار التسديد</span>
        ) : null}
        {bill && !pay ? (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(249,115,22,0.15)", fontWeight: 600 }}>طُلِب الحساب</span>
        ) : null}
        {kc > 0 ? (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(59,130,246,0.15)" }}>مطبخ {kc}</span>
        ) : null}
        <span style={{ color: "var(--muted)" }}>{oc} طلب</span>
      </div>
      <div style={{ fontSize: "0.82rem", marginTop: 8, lineHeight: 1.45, color: "var(--muted)", maxHeight: 56, overflow: "hidden" }}>
        {s.linesPreview || "—"}
      </div>
      <div style={{ marginTop: 8, fontWeight: 700, fontSize: "0.9rem" }}>{sub.toFixed(2)} ج.م تقريبي</div>
    </div>
  );
}
