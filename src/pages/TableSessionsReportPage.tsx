import { useCallback, useEffect, useMemo, useState } from "react";
import { repairArabicDisplayText } from "../auth/displayUser";
import { getApiBase } from "../lib/apiBase";
import { safeFetch } from "../lib/safeFetch";
import { tryParseJson } from "../lib/tryParseJson";

/* ─── types ─── */
type OrderItem = {
  name?: string;
  quantity?: number;
  unitPrice?: number;
};

type OrderRow = {
  id?: string;
  sessionId?: string;
  tableId?: string;
  status?: string;
  createdAt?: string;
  prepStartTime?: string;
  prepTargetMinutes?: number;
  completedAt?: string;
  kpiLeadMinutes?: number;
  items?: OrderItem[];
};

type TableSession = {
  id?: string;
  tableId?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  guestCount?: number;
  minimumChargePerSeat?: number;
  captainName?: string;
  captainLogin?: string;
  tableDisplayName?: string;
  guestSession?: boolean;
};

type TableReportRow = {
  session: TableSession;
  orders: OrderRow[];
  qtyTotal: number;
  qtyArrived: number;
  qtyKitchen: number;
  pendingCount: number;
  preparingCount: number;
  readyCount: number;
  servedCount: number;
  cancelledCount: number;
  totalCost: number;
  serviceCharge: number;
  vatValue: number;
  grandTotal: number;
};

type Policy = { servicePercent: number; vatPercent: number; serviceBeforeVat: boolean };

/* ─── helpers ─── */
function todayISO() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function orderQty(o: OrderRow): number {
  return (o.items || []).reduce((a, it) => a + Math.max(0, Number(it?.quantity ?? 0)), 0);
}

function orderTotal(o: OrderRow): number {
  return (o.items || []).reduce(
    (a, it) => a + Math.max(0, Number(it?.quantity ?? 0)) * Math.max(0, Number(it?.unitPrice ?? 0)),
    0,
  );
}

function orderStatusAr(st: string): string {
  const k = String(st || "").toLowerCase();
  const map: Record<string, string> = {
    pending: "انتظار",
    preparing: "تحضير",
    ready: "جاهز",
    served: "واصل",
    cancelled: "ملغى",
    paid: "مدفوع",
  };
  return map[k] || k || "—";
}

function isKitchen(st: string): boolean {
  const k = String(st || "").toLowerCase();
  return ["pending", "preparing", "ready"].includes(k);
}

function isArrived(st: string): boolean {
  return String(st || "").toLowerCase() === "served";
}

function formatDateShort(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString("ar-EG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function orderPrepLabel(o: OrderRow): string {
  const st = String(o.status || "").toLowerCase();
  if (st === "served" || st === "paid") {
    if (typeof o.kpiLeadMinutes === "number" && Number.isFinite(o.kpiLeadMinutes)) {
      return `${o.kpiLeadMinutes.toFixed(1)} د`;
    }
    return "—";
  }
  if (st === "cancelled") return "—";
  const target = Number(o.prepTargetMinutes) > 0 ? Number(o.prepTargetMinutes) : 20;
  const prepStart = o.prepStartTime ? new Date(o.prepStartTime).getTime() : NaN;
  if (!Number.isFinite(prepStart)) {
    return st === "pending" ? "بانتظار البدء" : "—";
  }
  const deadline = prepStart + target * 60 * 1000;
  const now = Date.now();
  const remSec = Math.ceil((deadline - now) / 1000);
  if (remSec <= 0) {
    const lateMin = Math.ceil(Math.abs(remSec) / 60);
    return `متأخر ${lateMin} د`;
  }
  const remMin = Math.ceil(remSec / 60);
  return `متبقي ${remMin} د`;
}

function orderPrepColor(o: OrderRow): string {
  const st = String(o.status || "").toLowerCase();
  if (st === "served" || st === "paid" || st === "cancelled") return "#64748b";
  const target = Number(o.prepTargetMinutes) > 0 ? Number(o.prepTargetMinutes) : 20;
  const prepStart = o.prepStartTime ? new Date(o.prepStartTime).getTime() : NaN;
  if (!Number.isFinite(prepStart)) return "#64748b";
  const deadline = prepStart + target * 60 * 1000;
  const now = Date.now();
  const remSec = Math.ceil((deadline - now) / 1000);
  if (remSec <= 0) return "#dc2626";
  if (remSec <= 5 * 60) return "#d97706";
  return "#16a34a";
}

function sessionAvgKpi(orders: OrderRow[]): string {
  const served = orders.filter((o) => ["served", "paid"].includes(String(o.status || "").toLowerCase()));
  if (!served.length) return "—";
  const valid = served.filter((o) => typeof o.kpiLeadMinutes === "number" && Number.isFinite(o.kpiLeadMinutes));
  if (!valid.length) return "—";
  const avg = valid.reduce((a, o) => a + (o.kpiLeadMinutes || 0), 0) / valid.length;
  return `${avg.toFixed(1)} د`;
}

/* ─── component ─── */
export default function TableSessionsReportPage() {
  const base = getApiBase();

  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  const [policy, setPolicy] = useState<Policy>({ servicePercent: 12, vatPercent: 14, serviceBeforeVat: true });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<string>("startTime");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [searchTable, setSearchTable] = useState("");
  const [searchCaptain, setSearchCaptain] = useState("");

  /* ─── load helpers ─── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [ts, os, tb, ops] = await Promise.all([
        safeFetch(`${base}/api/restaurant/table-sessions?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`),
        safeFetch(`${base}/api/restaurant/orders?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`),
        safeFetch(`${base}/api/restaurant/tables`),
        safeFetch(`${base}/api/restaurant/ops-settings`),
      ]);

      const tj = tryParseJson<{ sessions?: TableSession[] }>(await ts.text()) ?? {};
      const oj = tryParseJson<{ orders?: OrderRow[] }>(await os.text()) ?? {};
      const tbj = tryParseJson<{ tables?: { id: string; name: string }[] }>(await tb.text()) ?? {};
      const opsj = tryParseJson<{ value?: string }>(await ops.text()) ?? {};
      const parsedOps = tryParseJson<{ servicePercent?: number; vatPercent?: number; serviceBeforeVat?: boolean }>(
        opsj.value || "{}",
      ) ?? {};

      setSessions(tj.sessions || []);
      setOrders(oj.orders || []);
      setTables(tbj.tables || []);
      setPolicy({
        servicePercent: Math.max(0, Number(parsedOps.servicePercent ?? 12)),
        vatPercent: Math.max(0, Number(parsedOps.vatPercent ?? 14)),
        serviceBeforeVat: parsedOps.serviceBeforeVat !== false,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [base, fromDate, toDate]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /* ─── build rows ─── */
  const rows: TableReportRow[] = useMemo(() => {
    const tableNameById = new Map(tables.map((t) => [t.id, t.name]));

    return sessions.map((session) => {
      const sid = String(session.id || "").trim();
      const tid = String(session.tableId || "").trim();
      const related = orders.filter(
        (o) => String(o?.sessionId || "") === sid || (!sid && String(o?.tableId || "") === tid),
      );

      const qtyTotal = related.reduce((a, o) => a + orderQty(o), 0);
      const qtyArrived = related.filter((o) => isArrived(o.status || "")).reduce((a, o) => a + orderQty(o), 0);
      const qtyKitchen = related.filter((o) => isKitchen(o.status || "")).reduce((a, o) => a + orderQty(o), 0);
      const totalCost = related.reduce((a, o) => a + orderTotal(o), 0);

      const pendingCount = related.filter((o) => String(o.status || "").toLowerCase() === "pending").length;
      const preparingCount = related.filter((o) => String(o.status || "").toLowerCase() === "preparing").length;
      const readyCount = related.filter((o) => String(o.status || "").toLowerCase() === "ready").length;
      const servedCount = related.filter((o) => String(o.status || "").toLowerCase() === "served").length;
      const cancelledCount = related.filter((o) => String(o.status || "").toLowerCase() === "cancelled").length;

      const svc = (totalCost * policy.servicePercent) / 100;
      const vat = policy.serviceBeforeVat
        ? ((totalCost + svc) * policy.vatPercent) / 100
        : (totalCost * policy.vatPercent) / 100;

      return {
        session: {
          ...session,
          tableDisplayName: session.tableDisplayName || tableNameById.get(tid) || tid,
        },
        orders: related,
        qtyTotal,
        qtyArrived,
        qtyKitchen,
        pendingCount,
        preparingCount,
        readyCount,
        servedCount,
        cancelledCount,
        totalCost,
        serviceCharge: svc,
        vatValue: vat,
        grandTotal: Math.max(0, totalCost + svc + vat),
      };
    });
  }, [sessions, orders, tables, policy]);

  /* ─── filter & sort ─── */
  const filtered = useMemo(() => {
    let list = [...rows];
    if (searchTable.trim()) {
      const q = searchTable.trim().toLowerCase();
      list = list.filter((r) => String(r.session.tableDisplayName || "").toLowerCase().includes(q));
    }
    if (searchCaptain.trim()) {
      const q = searchCaptain.trim().toLowerCase();
      list = list.filter(
        (r) =>
          String(r.session.captainName || "").toLowerCase().includes(q) ||
          String(r.session.captainLogin || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, searchTable, searchCaptain]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case "table":
          av = String(a.session.tableDisplayName || "");
          bv = String(b.session.tableDisplayName || "");
          break;
        case "captain":
          av = String(a.session.captainName || a.session.captainLogin || "");
          bv = String(b.session.captainName || b.session.captainLogin || "");
          break;
        case "startTime":
          av = String(a.session.startTime || "");
          bv = String(b.session.startTime || "");
          break;
        case "guests":
          av = Number(a.session.guestCount || 0);
          bv = Number(b.session.guestCount || 0);
          break;
        case "orders":
          av = a.orders.length;
          bv = b.orders.length;
          break;
        case "qty":
          av = a.qtyTotal;
          bv = b.qtyTotal;
          break;
        case "cost":
          av = a.totalCost;
          bv = b.totalCost;
          break;
        case "grand":
          av = a.grandTotal;
          bv = b.grandTotal;
          break;
        case "kpi":
          av = a.orders.reduce((sum, o) => sum + (Number(o.kpiLeadMinutes) || 0), 0);
          bv = b.orders.reduce((sum, o) => sum + (Number(o.kpiLeadMinutes) || 0), 0);
          break;
        default:
          av = String(a.session.startTime || "");
          bv = String(b.session.startTime || "");
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return 0;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  /* ─── totals ─── */
  const totals = useMemo(() => {
    const acc = sorted.reduce(
      (acc, r) => {
        acc.sessions += 1;
        acc.orders += r.orders.length;
        acc.qty += r.qtyTotal;
        acc.cost += r.totalCost;
        acc.service += r.serviceCharge;
        acc.vat += r.vatValue;
        acc.grand += r.grandTotal;
        return acc;
      },
      { sessions: 0, orders: 0, qty: 0, cost: 0, service: 0, vat: 0, grand: 0 },
    );
    return acc;
  }, [sorted]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handlePrint = () => window.print();

  const SortIcon = ({ k }: { k: string }) => {
    if (sortKey !== k) return <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>⇅</span>;
    return <span style={{ color: "#0ea5e9", fontSize: "0.75rem" }}>{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  return (
    <div className="page" style={{ padding: "1rem", maxWidth: 1600, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>تقرير جلسات الطاولات</h2>
      <div style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1rem" }}>
        يعرض الجلسات المنتهية والمسجلة حتى آخر عملية مغلقة للطاولة.
      </div>

      {/* filters */}
      <div
        className="card"
        style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: "0.9rem" }}>من</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: "0.9rem" }}>إلى</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: "0.9rem" }}>طاولة</label>
          <input
            type="text"
            placeholder="بحث..."
            value={searchTable}
            onChange={(e) => setSearchTable(e.target.value)}
            style={{ minWidth: 140 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: "0.9rem" }}>كابتن</label>
          <input
            type="text"
            placeholder="بحث..."
            value={searchCaptain}
            onChange={(e) => setSearchCaptain(e.target.value)}
            style={{ minWidth: 140 }}
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
          تحديث
        </button>
        <button type="button" className="btn btn-ghost" onClick={handlePrint}>
          🖨️ طباعة
        </button>
      </div>

      {err && <div style={{ color: "var(--danger)", marginBottom: "1rem" }}>{err}</div>}

      {/* totals */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {[
          { label: "الجلسات", value: totals.sessions },
          { label: "الطلبات", value: totals.orders },
          { label: "العناصر", value: totals.qty },
          { label: "السلة", value: `${totals.cost.toFixed(2)}` },
          { label: "الخدمة", value: `${totals.service.toFixed(2)}` },
          { label: "VAT", value: `${totals.vat.toFixed(2)}` },
          { label: "الإجمالي", value: `${totals.grand.toFixed(2)}` },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "0.8rem",
              background: "var(--surface2)",
            }}
          >
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* table */}
      {loading ? (
        <div style={{ color: "var(--muted)" }}>جاري التحميل…</div>
      ) : sorted.length === 0 ? (
        <div style={{ color: "var(--muted)" }}>لا توجد جلسات مطابقة للفلتر.</div>
      ) : (
        <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--muted)", background: "var(--surface2)" }}>
                {[
                  { key: "table", label: "الطاولة" },
                  { key: "guest", label: "ضيف" },
                  { key: "captain", label: "الكابتن" },
                  { key: "startTime", label: "بدأت" },
                  { key: "guests", label: "الضيوف" },
                  { key: "orders", label: "الطلبات" },
                  { key: "qty", label: "العناصر" },
                  { key: "pending", label: "انتظار" },
                  { key: "preparing", label: "تحضير" },
                  { key: "ready", label: "جاهز" },
                  { key: "served", label: "واصل" },
                  { key: "cancelled", label: "ملغى" },
                  { key: "kpi", label: "KPI" },
                  { key: "cost", label: "السلة" },
                  { key: "service", label: "الخدمة" },
                  { key: "vat", label: "VAT" },
                  { key: "grand", label: "الإجمالي" },
                ].map((col) => (
                  <th
                    key={col.key}
                    style={{
                      padding: "0.6rem",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    onClick={() => handleSort(col.key)}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {col.label} <SortIcon k={col.key} />
                    </span>
                  </th>
                ))}
                <th style={{ padding: "0.6rem", borderBottom: "1px solid var(--border)" }}>تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const sid = String(r.session.id || "");
                const isOpen = expandedId === sid;
                return (
                  <>
                    <tr key={sid} style={{ borderTop: "1px solid var(--border)", background: isOpen ? "#f0f9ff" : undefined }}>
                      <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                        <div style={{ fontWeight: 700 }}>{r.session.tableDisplayName || "—"}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sid.slice(0, 8)}</div>
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center" }}>
                        {r.session.guestSession ? (
                          <span style={{ fontSize: "0.72rem", background: "rgba(16,185,129,0.15)", color: "#047857", border: "1px solid rgba(16,185,129,0.4)", borderRadius: 6, padding: "2px 8px" }}>ضيف</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                        {repairArabicDisplayText(r.session.captainName || r.session.captainLogin || "") || "—"}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        {formatDateShort(r.session.startTime)}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center" }}>
                        {r.session.guestCount ?? "—"}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center" }}>
                        {r.orders.length}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center" }}>{r.qtyTotal}</td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center", color: "#d97706" }}>
                        {r.pendingCount || "—"}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center", color: "#2563eb" }}>
                        {r.preparingCount || "—"}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center", color: "#16a34a" }}>
                        {r.readyCount || "—"}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center", color: "#0891b2" }}>
                        {r.servedCount || "—"}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center", color: "#dc2626" }}>
                        {r.cancelledCount || "—"}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center", whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                        {sessionAvgKpi(r.orders)}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                        {r.totalCost.toFixed(2)}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                        {r.serviceCharge.toFixed(2)}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                        {r.vatValue.toFixed(2)}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>
                        {r.grandTotal.toFixed(2)}
                      </td>
                      <td style={{ padding: "0.55rem", verticalAlign: "top", textAlign: "center" }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => setExpandedId(isOpen ? null : sid)}
                        >
                          {isOpen ? "إغلاق" : "عرض"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={17} style={{ padding: "0.75rem 1rem", background: "#f8fbff" }}>
                          <div style={{ marginBottom: 8, fontWeight: 800, fontSize: "0.9rem" }}>
                            طلبات الجلسة ({r.orders.length})
                          </div>
                          {r.orders.length === 0 ? (
                            <div style={{ color: "#64748b" }}>لا توجد طلبات.</div>
                          ) : (
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                                gap: 8,
                              }}
                            >
                              {r.orders.map((o) => {
                                const oid = String(o.id || "").slice(0, 8);
                                const st = orderStatusAr(o.status || "");
                                const qty = orderQty(o);
                                const tot = orderTotal(o);
                                return (
                                  <div
                                    key={oid}
                                    style={{
                                      border: "1px solid #dbeafe",
                                      borderRadius: 10,
                                      padding: "8px 10px",
                                      background: "#fff",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        fontWeight: 700,
                                        fontSize: "0.82rem",
                                      }}
                                    >
                                      <span>
                                        طلب {oid} · {st}
                                      </span>
                                      <span style={{ color: "#64748b" }}>{qty} عنصر</span>
                                    </div>
                                    <div style={{ fontSize: "0.78rem", color: "#475569", marginTop: 2 }}>
                                      {String(o.createdAt || "").replace("T", " ").slice(0, 16)}
                                      {o.prepStartTime ? (
                                        <span style={{ marginRight: 8, color: orderPrepColor(o), fontWeight: 700 }}>
                                          · {orderPrepLabel(o)}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div style={{ fontSize: "0.85rem", marginTop: 3, fontWeight: 700 }}>
                                      {tot.toFixed(2)} ج.م
                                    </div>
                                    <ul
                                      style={{
                                        margin: "6px 0 0",
                                        padding: "0 14px 0 0",
                                        listStyle: "disc",
                                        fontSize: "0.78rem",
                                        color: "#334155",
                                        lineHeight: 1.6,
                                      }}
                                    >
                                      {(o.items || [])
                                        .filter((it) => Number(it?.quantity ?? 0) > 0)
                                        .map((it, idx) => (
                                          <li key={idx}>
                                            {Number(it.quantity)} × {it.name || "—"}
                                            {Number(it.unitPrice) > 0
                                              ? ` — ${Math.round(Number(it.unitPrice))} ج.م`
                                              : ""}
                                          </li>
                                        ))}
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
