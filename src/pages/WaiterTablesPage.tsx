import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { buildSegmentedTablesFromFloorPlan, type SegmentedTableRow } from "../lib/restaurantTableView";
import "../styles/operationalRoles.css";

type RestTable = SegmentedTableRow;
type TableSession = {
  id?: string;
  tableId?: string;
  startTime?: string;
  status?: string;
  billingRequestedAt?: string;
};
type OrderItem = { name?: string; quantity?: number; unitPrice?: number };
type OrderRow = {
  id?: string;
  tableId?: string;
  sessionId?: string;
  createdAt?: string;
  status?: string;
  items?: OrderItem[];
  kitchenTotals?: { total?: number };
};
type TableReport = {
  tableName: string;
  sessionId: string | null;
  startTime: string | null;
  orderCount: number;
  qtyTotal: number;
  qtyArrived: number;
  qtyKitchen: number;
  totalCost: number;
  pendingCost: number;
  noOrderDelayMinutes?: number;
  lines: Array<{ id: string; time: string; status: string; qty: number; total: number }>;
};

export default function WaiterTablesPage() {
  const base = getApiBase();
  const navigate = useNavigate();
  const [tables, setTables] = useState<RestTable[]>([]);
  const [sessionByTable, setSessionByTable] = useState<Map<string, string>>(() => new Map());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [billReqIds, setBillReqIds] = useState<Set<string>>(() => new Set());
  const [msg, setMsg] = useState("");
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [report, setReport] = useState<TableReport | null>(null);
  const [reportPos, setReportPos] = useState({ x: 0, y: 0 });

  function isTodayIso(iso?: string): boolean {
    if (!iso) return false;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return false;
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }

  function diffMinutesFromIso(iso?: string): number {
    if (!iso) return 0;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  }

  function normalizeTableStatus(raw: string): "ready" | "occupied" | "reserved" | "dirty" | "cleaning" {
    const s = String(raw || "").toLowerCase().trim();
    if (["available", "free", "open", "ready", "متاحة", "جاهزة"].includes(s)) return "ready";
    if (["occupied", "busy", "مشغولة"].includes(s)) return "occupied";
    if (["reserved", "محجوزة"].includes(s)) return "reserved";
    if (["dirty", "متسخة"].includes(s)) return "dirty";
    if (["cleaning", "تنظيف"].includes(s)) return "cleaning";
    return "ready";
  }

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const [fp, rt, rs, ro] = await Promise.all([
          fetch(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
          fetch(`${base}/api/restaurant/tables`),
          fetch(`${base}/api/restaurant/table-sessions?status=active`),
          fetch(`${base}/api/restaurant/orders`),
        ]);
        const fpj = await fp.json().catch(() => ({}));
        const jt = await rt.json();
        const js = await rs.json();
        const oj = await ro.json().catch(() => ({}));

        const apiTables: RestTable[] = Array.isArray(jt.tables) ? jt.tables : [];
        const planRaw = fpj?.plan;
        const statusById = new Map<string, string>();
        for (const t of apiTables as any[]) statusById.set(String(t?.id || ""), normalizeTableStatus(String(t?.status || "")));
        if (stop) return;
        setTables(
          buildSegmentedTablesFromFloorPlan(planRaw, apiTables).map((t: any) => ({
            ...t,
            status: statusById.get(String(t?.id || "")) || normalizeTableStatus(String(t?.status || "")),
            noOrderOverdue: Boolean((apiTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.noOrderOverdue),
            noOrderMinutes: Number((apiTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.noOrderMinutes || 0),
            cleanupOverdue: Boolean((apiTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.cleanupOverdue),
          })),
        );
        const m = new Map<string, string>();
        const sessions = (Array.isArray(js.sessions) ? js.sessions : []).filter((s: any) => isTodayIso(String(s?.startTime || "")));
        setSessions(sessions);
        for (const s of sessions) {
          const tid = s?.tableId != null ? String(s.tableId) : "";
          const sid = s?.id != null ? String(s.id) : "";
          if (tid && sid) m.set(tid, sid);
        }
        setSessionByTable(m);

        // انشغال/طلب حساب
        const busy = new Set<string>();
        const billreq = new Set<string>();
        for (const s of sessions) {
          const tid = String(s?.tableId || "");
          const st = String(s?.status || "").toLowerCase();
          if (tid && st === "active") busy.add(tid);
          if (tid && s?.billingRequestedAt) billreq.add(tid);
        }
        const orders = (Array.isArray(oj.orders) ? oj.orders : []).filter((o: any) => isTodayIso(String(o?.createdAt || "")));
        setOrders(orders);
        for (const o of orders) {
          const tid = String(o?.tableId || "");
          const st = String(o?.status || "").toLowerCase();
          if (tid && ["pending", "preparing"].includes(st)) busy.add(tid);
        }
        setBusyIds(busy);
        setBillReqIds(billreq);
      } catch (e) {
        if (!stop) setMsg(String(e));
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 7000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [base]);

  async function changeTableStatus(tableId: string, status: "dirty" | "cleaning" | "ready") {
    try {
      await fetch(`${base}/api/restaurant/tables/${encodeURIComponent(tableId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const updated = tables.map((t: any) => (String(t.id) === String(tableId) ? { ...t, status } : t));
      setTables(updated);
    } catch (e) {
      setMsg(String(e));
    }
  }

  const orderQty = (o: OrderRow) =>
    (Array.isArray(o.items) ? o.items : []).reduce((a, it) => a + Math.max(0, Number(it?.quantity ?? 0)), 0);
  const orderTotal = (o: OrderRow) => {
    const fromKitchen = Number(o?.kitchenTotals?.total ?? 0);
    if (fromKitchen > 0) return fromKitchen;
    return (Array.isArray(o.items) ? o.items : []).reduce(
      (a, it) => a + Math.max(0, Number(it?.quantity ?? 0)) * Math.max(0, Number(it?.unitPrice ?? 0)),
      0,
    );
  };
  const isArrived = (status: string) => ["ready", "served", "completed", "delivered"].includes(status);
  const isKitchen = (status: string) => ["pending", "preparing"].includes(status);
  const showTableReport = (t: RestTable, ev: ReactMouseEvent<HTMLButtonElement>) => {
    ev.preventDefault();
    const tid = String(t.id);
    const session = sessions.find((s) => String(s?.tableId || "") === tid && String(s?.status || "").toLowerCase() === "active") || null;
    const sid = session?.id ? String(session.id) : null;
    const related = orders
      .filter((o) => String(o?.tableId || "") === tid || (sid ? String(o?.sessionId || "") === sid : false))
      .filter((o) => isTodayIso(String(o?.createdAt || "")))
      .sort((a, b) => String(a?.createdAt || "").localeCompare(String(b?.createdAt || "")));
    const lines = related.map((o) => {
      const st = String(o?.status || "").toLowerCase();
      const qty = orderQty(o);
      return {
        id: String(o?.id || "").slice(0, 8),
        time: String(o?.createdAt || "").replace("T", " ").slice(0, 16),
        status: st || "pending",
        qty,
        total: orderTotal(o),
      };
    });
    const qtyTotal = lines.reduce((a, l) => a + l.qty, 0);
    const qtyArrived = lines.filter((l) => isArrived(l.status)).reduce((a, l) => a + l.qty, 0);
    const qtyKitchen = lines.filter((l) => isKitchen(l.status)).reduce((a, l) => a + l.qty, 0);
    const totalCost = lines.reduce((a, l) => a + l.total, 0);
    const pendingCost = lines.filter((l) => isKitchen(l.status)).reduce((a, l) => a + l.total, 0);
    const persistedDelay = Number((session as any)?.firstOrderDelayMinutes || 0);
    const noOrderDelayMinutes = lines.length === 0 ? diffMinutesFromIso(session?.startTime || undefined) : persistedDelay;
    setReport({
      tableName: t.name,
      sessionId: sid,
      startTime: session?.startTime || null,
      orderCount: lines.length,
      qtyTotal,
      qtyArrived,
      qtyKitchen,
      totalCost,
      pendingCost,
      noOrderDelayMinutes,
      lines,
    });
    setReportPos({ x: ev.clientX, y: ev.clientY });
  };

  return (
    <div className="role-op waiter-pos" onClick={() => setReport(null)}>
      <OperationalRoleHeader roleTitle="جارسون الطلبات" hideBack />

      <div className="role-op__main" style={{ maxWidth: 720 }}>
        <h2 className="role-op__section-title">اختر الطاولة</h2>
        {msg && <p className="waiter-pos__msg">{msg}</p>}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "1rem",
            marginTop: "1rem",
          }}
        >
          {tables.map((t) => {
            if (t.isSeparator) {
              return (
                <div key={t.id} style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>{t.name}</div>
                  <hr style={{ border: 0, borderTop: "1px dashed var(--border, #cbd5e1)" }} />
                </div>
              );
            }
            const num = t.number != null ? `#${t.number}` : t.name;
            const tStatus = normalizeTableStatus(String((t as any).status || ""));
            const notReady = tStatus === "dirty" || tStatus === "cleaning";
            const cleanupOverdue = Boolean((t as any).cleanupOverdue);
            const noOrderOverdue = Boolean((t as any).noOrderOverdue);
            const noOrderMinutes = Number((t as any).noOrderMinutes || 0);
            const isBusy = busyIds.has(String(t.id));
            const billReq = billReqIds.has(String(t.id));
            return (
              <button
                key={t.id}
                type="button"
                className="role-op__pick-card"
                style={{
                  border: notReady ? "2px solid #f59e0b" : isBusy ? "2px solid #ef4444" : "2px solid #22c55e",
                  boxShadow: billReq ? "0 0 0 3px rgba(59,130,246,0.35)" : undefined,
                }}
                onClick={() => {
                  if (notReady) {
                    setMsg("الطاولة غير جاهزة. أكمل دورة التنظيف أولًا.");
                    return;
                  }
                  const sid = sessionByTable.get(String(t.id));
                  const q =
                    `tableId=${encodeURIComponent(t.id)}` +
                    (sid ? `&sessionId=${encodeURIComponent(sid)}` : "");
                  navigate(`/app/waiter/order-taker?${q}`);
                }}
                onContextMenu={(ev) => showTableReport(t, ev)}
              >
                <div className="role-op__pick-num">{num}</div>
                {noOrderOverdue ? (
                  <div style={{ position: "absolute", top: 8, left: 8, width: 24, height: 24, borderRadius: 999, background: "#7c3aed", color: "#fff", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 900 }}>
                    ⏱
                  </div>
                ) : null}
                <div className="role-op__pick-sub">🪑 مقاعد {t.seats ?? "—"}</div>
                <div style={{ marginTop: 8, fontSize: "0.82rem", color: isBusy ? "#b91c1c" : "#166534" }}>
                  {notReady ? (tStatus === "dirty" ? "متسخة" : "قيد التنظيف") : isBusy ? "مشغولة" : "جاهزة"}
                  {billReq ? " · طلب حساب" : ""}
                </div>
                {cleanupOverdue ? (
                  <div style={{ marginTop: 6, fontSize: "0.78rem", color: "#b91c1c", fontWeight: 800 }}>
                    تنبيه: تأخر تنظيف أكثر من 10 دقائق
                  </div>
                ) : null}
                {noOrderOverdue ? (
                  <div style={{ marginTop: 4, fontSize: "0.78rem", color: "#7c3aed", fontWeight: 800 }}>
                    تنبيه: تأخر أخذ الطلب {noOrderMinutes} د
                  </div>
                ) : null}
                <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center" }}>
                  {tStatus === "dirty" && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void changeTableStatus(String(t.id), "cleaning");
                      }}
                      style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999, background: "#fef3c7", color: "#92400e", cursor: "pointer" }}
                    >
                      بدء تنظيف
                    </span>
                  )}
                  {tStatus === "cleaning" && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void changeTableStatus(String(t.id), "ready");
                      }}
                      style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999, background: "#dcfce7", color: "#166534", cursor: "pointer" }}
                    >
                      تم التنظيف
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {report ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: Math.min(reportPos.y + 8, window.innerHeight - 360),
            left: Math.min(reportPos.x + 8, window.innerWidth - 440),
            width: 420,
            maxWidth: "95vw",
            maxHeight: "72vh",
            overflow: "auto",
            zIndex: 1000,
            background: "#ffffff",
            border: "2px solid #0ea5e9",
            borderRadius: 14,
            boxShadow: "0 16px 40px rgba(2,6,23,0.25)",
            padding: "0.8rem 0.9rem",
            direction: "rtl",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 900 }}>تقرير الطاولة {report.tableName}</div>
            <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ padding: "2px 10px" }} onClick={() => setReport(null)}>
              ×
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: "0.86rem", color: "#0f172a", display: "grid", gap: 4 }}>
            <div>وقت التسكين: {report.startTime ? new Date(report.startTime).toLocaleString("ar-EG") : "غير متاح"}</div>
            <div>عدد الطلبات: {report.orderCount}</div>
            <div>إجمالي العناصر: {report.qtyTotal}</div>
            <div>وصل منها: {report.qtyArrived}</div>
            <div>باقي بالمطبخ: {report.qtyKitchen}</div>
            <div>التكلفة الحالية: {report.totalCost.toFixed(2)} ج.م</div>
            <div>قيمة المتبقي حتى الوصول: {report.pendingCost.toFixed(2)} ج.م</div>
            {Number(report.noOrderDelayMinutes || 0) >= 10 ? (
              <div style={{ color: "#7c3aed", fontWeight: 800 }}>
                تنبيه: تأخر أخذ الطلب بعد التسكين ({report.noOrderDelayMinutes} دقيقة)
              </div>
            ) : null}
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid #cbd5e1", paddingTop: 8, display: "grid", gap: 6 }}>
            {report.lines.length === 0 ? (
              <div style={{ color: "#64748b" }}>لا توجد طلبات على هذه الطاولة.</div>
            ) : (
              report.lines.map((l) => (
                <div key={l.id + l.time} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "6px 8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
                    <span>طلب {l.id || "—"}</span>
                    <span>{l.status}</span>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#475569", marginTop: 2 }}>{l.time || "—"}</div>
                  <div style={{ fontSize: "0.86rem", marginTop: 3 }}>العناصر: {l.qty} · القيمة: {l.total.toFixed(2)} ج.م</div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
