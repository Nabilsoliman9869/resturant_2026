import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { todayYmd } from "../lib/dailyMenuSettings";
import { tryParseJson } from "../lib/tryParseJson";
import SmartProductSearch from "../components/SmartProductSearch";
import { CashierPayInvoiceModal, type CashierInvoiceRow } from "../components/CashierPayInvoiceModal";

type PaymentFilter = "awaiting" | "paid" | "on_account" | "all";

export default function CashierInvoicesLocalPage() {
  const base = getApiBase();
  const [from, setFrom] = useState(() => todayYmd());
  const [to, setTo] = useState(() => todayYmd());
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("awaiting");
  const [rows, setRows] = useState<CashierInvoiceRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);
  const [payInitialRow, setPayInitialRow] = useState<CashierInvoiceRow | null>(null);

  const load = useCallback(async () => {
    setMsg("");
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (from) q.set("date_from", from);
      if (to) q.set("date_to", to);
      q.set("payment_status", paymentFilter);
      const r = await fetch(`${base}/api/restaurant/invoices-local?${q.toString()}`);
      const txt = await r.text();
      const j = tryParseJson<{ invoices?: unknown; detail?: unknown }>(txt) ?? {};
      if (!r.ok) {
        const d = j.detail;
        throw new Error(typeof d === "string" ? d : txt.slice(0, 200) || "فشل التحميل");
      }
      let list = Array.isArray(j.invoices) ? (j.invoices as CashierInvoiceRow[]) : [];
      const qtxt = searchText.trim().toLowerCase();
      if (qtxt) {
        list = list.filter((inv) => {
          const id = String(inv.invoiceId || "").toLowerCase();
          const sid = String(inv.sessionId || "").toLowerCase();
          const tbl = String((inv as { tableLabel?: string }).tableLabel || "").toLowerCase();
          const tname = String((inv as { tableName?: string }).tableName || "").toLowerCase();
          const bn = String((inv as { billNumber?: number }).billNumber ?? "").toLowerCase();
          return id.includes(qtxt) || sid.includes(qtxt) || tbl.includes(qtxt) || tname.includes(qtxt) || bn.includes(qtxt);
        });
      }
      setRows(list);
    } catch (e) {
      setMsg(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [base, from, to, paymentFilter, searchText]);

  useEffect(() => {
    void load();
  }, [load]);

  function openPay(inv: CashierInvoiceRow) {
    const id = String(inv.invoiceId || "").trim();
    if (!id) return;
    setPayInitialRow(inv);
    setPayInvoiceId(id);
    setPayOpen(true);
  }

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>فواتير المطعم (كاشير)</h1>

      <CashierPayInvoiceModal
        open={payOpen}
        invoiceId={payInvoiceId}
        initialRow={payInitialRow}
        onChanged={() => {
          void load();
        }}
        onClose={() => {
          setPayOpen(false);
          setPayInvoiceId(null);
          setPayInitialRow(null);
        }}
        onPaid={() => {
          setMsg("تم التسديد.");
          void load();
        }}
      />

      <div className="card" style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ color: "var(--muted)" }}>الحالة</span>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
            aria-label="تصفية حسب التسديد"
          >
            <option value="awaiting">في انتظار التسديد</option>
            <option value="paid">مُسدَّدة</option>
            <option value="on_account">على حساب</option>
            <option value="all">الكل</option>
          </select>
        </label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ color: "var(--muted)" }}>من</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ color: "var(--muted)" }}>إلى</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load()}>
          {loading ? "…" : "تطبيق"}
        </button>
      </div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <SmartProductSearch
          onSelect={(hit) => {
            const id = String(hit.CardGuide || "");
            setSearchText(id);
          }}
          placeholder="بحث سريع عن فاتورة/جلسة (اكتب جزء من المعرف أو اسم الصنف)"
        />
      </div>

      {msg && <div className="card" style={{ marginBottom: "1rem" }}>{msg}</div>}

      <div className="card" style={{ overflowX: "auto" }}>
        {rows.length === 0 && !loading ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>لا توجد فواتير في النطاق.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
            <thead>
              <tr style={{ textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "0.5rem" }}>طلب الحساب</th>
                <th style={{ padding: "0.5rem" }}>التسديد</th>
                <th style={{ padding: "0.5rem" }}>الإجمالي</th>
                <th style={{ padding: "0.5rem" }}>رقم الفاتورة</th>
                <th style={{ padding: "0.5rem" }}>اسم الطاولة</th>
                <th style={{ padding: "0.5rem" }}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv, i) => {
                const id = String(inv.invoiceId || "");
                const awaiting = Boolean(inv.awaitingPayment);
                const onAccount = (inv.paymentStatus || "") === "on_account";
                const req = (inv.requestedAt || "").replace("T", " ").slice(0, 19) || "—";
                const paid = (inv.paidAt || "").replace("T", " ").slice(0, 19) || "—";
                const onAccountAt = (inv.onAccountAt || "").replace("T", " ").slice(0, 19) || "—";
                const billNo = inv.billNumber != null ? String(inv.billNumber) : "—";
                const tableTitle = (inv.tableName && inv.tableName.trim()) || inv.tableLabel || "—";
                return (
                  <tr key={`${id}-${i}`} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.6rem", whiteSpace: "nowrap" }}>{req}</td>
                    <td style={{ padding: "0.6rem", whiteSpace: "nowrap" }}>{onAccount ? `على حساب — ${onAccountAt}` : paid}</td>
                    <td style={{ padding: "0.6rem" }}>{inv.total != null ? Number(inv.total).toFixed(2) : "—"}</td>
                    <td style={{ padding: "0.6rem", fontWeight: 700 }}>{billNo}</td>
                    <td style={{ padding: "0.6rem" }}>{tableTitle}</td>
                    <td style={{ padding: "0.6rem", verticalAlign: "middle" }}>
                      {id ? (
                        <button type="button" className={awaiting ? "btn btn-primary" : onAccount ? "btn btn-ghost" : "btn btn-ghost"} style={{ fontSize: "0.85rem" }} onClick={() => openPay(inv)}>
                          {awaiting ? "تسديد / طباعة" : onAccount ? "معاينة" : "معاينة / طباعة"}
                        </button>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
