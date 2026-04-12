import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { todayYmd } from "../lib/dailyMenuSettings";
import { tryParseJson } from "../lib/tryParseJson";
import SmartProductSearch from "../components/SmartProductSearch";

type LocalInv = {
  sessionId?: string;
  invoiceId?: string;
  total?: number;
  paidAt?: string | null;
  requestedAt?: string;
  awaitingPayment?: boolean;
  paymentMethod?: string;
};

type PaymentFilter = "awaiting" | "paid" | "all";

export default function CashierInvoicesLocalPage() {
  const base = getApiBase();
  const [from, setFrom] = useState(() => todayYmd());
  const [to, setTo] = useState(() => todayYmd());
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("awaiting");
  const [rows, setRows] = useState<LocalInv[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [methodById, setMethodById] = useState<Record<string, string>>({});
  const [closeSessionById, setCloseSessionById] = useState<Record<string, boolean>>({});
  const [searchText, setSearchText] = useState("");

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
      let list = Array.isArray(j.invoices) ? (j.invoices as LocalInv[]) : [];
      const qtxt = searchText.trim().toLowerCase();
      if (qtxt) {
        list = list.filter((inv) => {
          const id = String(inv.invoiceId || "").toLowerCase();
          const sid = String(inv.sessionId || "").toLowerCase();
          return id.includes(qtxt) || sid.includes(qtxt);
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

  async function markPaid(inv: LocalInv) {
    const invoiceId = String(inv.invoiceId || "").trim();
    if (!invoiceId) return;
    const method = (methodById[invoiceId] || "cash").trim() || "cash";
    const closeSession = Boolean(closeSessionById[invoiceId]);
    setPayingId(invoiceId);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/invoices-local/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, paymentMethod: method, closeSession }),
      });
      const txt = await r.text();
      const j = tryParseJson<{ detail?: unknown }>(txt) ?? {};
      if (!r.ok) {
        const d = j.detail;
        throw new Error(typeof d === "string" ? d : txt.slice(0, 200) || "فشل التسديد");
      }
      setMsg(closeSession ? "تم التسديد وإغلاق الجلسة." : "تم التسديد.");
      void load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setPayingId(null);
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>فواتير المطعم (كاشير)</h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6, marginTop: 0 }}>
        بعد «طلب الحساب» من الجرسون تظهر الفواتير هنا في انتظار التسديد. الطلبات المفتوحة لا تُفوتر في SQL حتى هذه
        الخطوة.
      </p>

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
                <th style={{ padding: "0.5rem" }}>طريقة الدفع</th>
                <th style={{ padding: "0.5rem" }}>معرّف الفاتورة</th>
                <th style={{ padding: "0.5rem" }}>جلسة</th>
                <th style={{ padding: "0.5rem" }}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv, i) => {
                const id = String(inv.invoiceId || "");
                const awaiting = Boolean(inv.awaitingPayment);
                const req = (inv.requestedAt || "").replace("T", " ").slice(0, 19) || "—";
                const paid = (inv.paidAt || "").replace("T", " ").slice(0, 19) || "—";
                return (
                  <tr key={`${id}-${i}`} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.6rem", whiteSpace: "nowrap" }}>{req}</td>
                    <td style={{ padding: "0.6rem", whiteSpace: "nowrap" }}>{paid}</td>
                    <td style={{ padding: "0.6rem" }}>{inv.total != null ? Number(inv.total).toFixed(2) : "—"}</td>
                    <td style={{ padding: "0.6rem" }}>{inv.paymentMethod || "—"}</td>
                    <td style={{ padding: "0.6rem", fontFamily: "monospace", fontSize: "0.8rem", wordBreak: "break-all" }}>
                      {id || "—"}
                    </td>
                    <td style={{ padding: "0.6rem", fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-all" }}>
                      {inv.sessionId || "—"}
                    </td>
                    <td style={{ padding: "0.6rem", verticalAlign: "middle" }}>
                      {awaiting && id ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch", minWidth: 140 }}>
                          <select
                            value={methodById[id] || "cash"}
                            onChange={(e) => setMethodById((m) => ({ ...m, [id]: e.target.value }))}
                            aria-label="طريقة الدفع"
                          >
                            <option value="cash">نقدي</option>
                            <option value="card">بطاقة</option>
                            <option value="split">تقسيم</option>
                          </select>
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.85rem" }}>
                            <input
                              type="checkbox"
                              checked={Boolean(closeSessionById[id])}
                              onChange={(e) => setCloseSessionById((m) => ({ ...m, [id]: e.target.checked }))}
                            />
                            إغلاق الجلسة
                          </label>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: "0.85rem" }}
                            disabled={payingId === id}
                            onClick={() => void markPaid(inv)}
                          >
                            {payingId === id ? "…" : "تسديد"}
                          </button>
                        </div>
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
