import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { buildMat3amActor } from "../lib/mat3amActor";
import { tryParseJson } from "../lib/tryParseJson";
import { briefNetworkHint, safeFetch } from "../lib/safeFetch";
import { buildSegmentedTablesFromFloorPlan, type SegmentedTableRow } from "../lib/restaurantTableView";
import "../styles/operationalRoles.css";

type RestTable = SegmentedTableRow;
type TableSession = {
  id?: string;
  tableId?: string;
  startTime?: string;
  status?: string;
  billingRequestedAt?: string;
  captainUserId?: string;
  captainLogin?: string;
  captainName?: string;
  captainClaimedAt?: string;
};
type StaffUser = { id: string; login: string; name: string; role: string; isActive?: boolean };
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
  const location = useLocation();
  const { user } = useAuth();
  const [tables, setTables] = useState<RestTable[]>([]);
  const [sessionByTable, setSessionByTable] = useState<Map<string, string>>(() => new Map());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [billReqIds, setBillReqIds] = useState<Set<string>>(() => new Set());
  const [msg, setMsg] = useState("");
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [report, setReport] = useState<TableReport | null>(null);
  const [reportPos, setReportPos] = useState({ x: 0, y: 0 });
  const [exclusiveOn, setExclusiveOn] = useState(false);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [reassignSid, setReassignSid] = useState<string | null>(null);
  const [reassignPickId, setReassignPickId] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [reassignBusy, setReassignBusy] = useState(false);

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

  const loadTables = useCallback(async () => {
    try {
      const [fp, rt, rs, ro, wf] = await Promise.all([
        safeFetch(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
        safeFetch(`${base}/api/restaurant/tables`),
        safeFetch(`${base}/api/restaurant/table-sessions?status=active`),
        safeFetch(`${base}/api/restaurant/orders`),
        safeFetch(`${base}/api/restaurant/workflow-settings`),
      ]);
      const fpj = (tryParseJson(await fp.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const jt = (tryParseJson(await rt.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const js = (tryParseJson(await rs.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const oj = (tryParseJson(await ro.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const wfj = (tryParseJson(await wf.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const httpLabel = (r: Response, nameAr: string) =>
        `${nameAr} (${r.status === 0 ? "لا اتصال — شغّل API 2288" : `HTTP ${r.status}`})`;
      const bad: string[] = [];
      if (!fp.ok) bad.push(httpLabel(fp, "خريطة الصالة"));
      if (!rt.ok) bad.push(httpLabel(rt, "الطاولات"));
      if (!rs.ok) bad.push(httpLabel(rs, "الجلسات"));
      if (!ro.ok) bad.push(httpLabel(ro, "الطلبات"));
      if (!wf.ok) bad.push(httpLabel(wf, "إعداد المسند"));
      if (bad.length) {
        setMsg(
          `تعذّر تحميل البيانات: ${bad.join(" · ")}. إن ظهر «لا اتصال» فشغّل run_api.bat ثم افتح http://127.0.0.1:2288/api/ping`,
        );
        setTables([]);
        setSessionByTable(new Map());
        setSessions([]);
        setOrders([]);
        return;
      }
      setMsg("");
      const ex = String((wfj as { orderTakerExclusiveTable?: string })?.orderTakerExclusiveTable || "").toLowerCase();
      setExclusiveOn(ex === "on" || ex === "1" || ex === "true" || ex === "yes");

      const apiTables: RestTable[] = Array.isArray(jt["tables"]) ? (jt["tables"] as RestTable[]) : [];
      const planRaw = fpj["plan"];
      const statusById = new Map<string, string>();
      for (const t of apiTables as any[]) statusById.set(String(t?.id || ""), normalizeTableStatus(String(t?.status || "")));
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
      const sessions = (Array.isArray(js["sessions"]) ? js["sessions"] : []).filter((s: unknown) =>
        isTodayIso(String((s as TableSession)?.startTime || "")),
      ) as TableSession[];
      setSessions(sessions);
      for (const s of sessions) {
        const tid = s?.tableId != null ? String(s.tableId) : "";
        const sid = s?.id != null ? String(s.id) : "";
        if (tid && sid) m.set(tid, sid);
      }
      setSessionByTable(m);

      const busy = new Set<string>();
      const billreq = new Set<string>();
      for (const s of sessions) {
        const tid = String(s?.tableId || "");
        const st = String(s?.status || "").toLowerCase();
        if (tid && st === "active") busy.add(tid);
        if (tid && s?.billingRequestedAt) billreq.add(tid);
      }
      const orders = (Array.isArray(oj["orders"]) ? oj["orders"] : []).filter((o: unknown) =>
        isTodayIso(String((o as OrderRow)?.createdAt || "")),
      ) as OrderRow[];
      setOrders(orders);
      for (const o of orders) {
        const tid = String(o?.tableId || "");
        const st = String(o?.status || "").toLowerCase();
        if (tid && ["pending", "preparing"].includes(st)) busy.add(tid);
      }
      setBusyIds(busy);
      setBillReqIds(billreq);
    } catch (e) {
      setMsg(briefNetworkHint(e));
    }
  }, [base]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      await loadTables();
    };
    void tick();
    const id = window.setInterval(() => void tick(), 7000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [loadTables]);

  useEffect(() => {
    const r = user?.role;
    if (r !== "manager" && r !== "developer") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await safeFetch(`${base}/api/auth/users`);
        const j = tryParseJson<{ users?: StaffUser[] }>(await res.text()) ?? {};
        if (cancelled || !res.ok) return;
        const u = Array.isArray(j.users) ? j.users : [];
        setStaffUsers(
          u.filter((x) => ["waiter", "host"].includes(String(x.role || "").toLowerCase()) && x.isActive !== false),
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, user?.role]);

  async function claimCaptain(sessionId: string) {
    setMsg("");
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    setClaimBusy(true);
    try {
      const r = await safeFetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(sessionId)}/claim-order-taker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mat3amActor: actor }),
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      setMsg("تم تسكينك كابتن على هذه الجلسة.");
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setClaimBusy(false);
    }
  }

  async function submitReassignCaptain() {
    if (!reassignSid || !reassignPickId) return;
    setMsg("");
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    const pick = staffUsers.find((u) => String(u.id) === String(reassignPickId));
    if (!pick) {
      setMsg("اختر المستخدم الهدف.");
      return;
    }
    setReassignBusy(true);
    try {
      const r = await safeFetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(reassignSid)}/reassign-order-taker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mat3amActor: actor,
          targetUserId: pick.id,
          targetLogin: pick.login,
          targetName: pick.name || pick.login,
        }),
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      setMsg("تم تحويل الكابتن.");
      setReassignSid(null);
      setReassignPickId("");
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setReassignBusy(false);
    }
  }

  async function changeTableStatus(tableId: string, status: "dirty" | "cleaning" | "ready") {
    try {
      const r = await safeFetch(`${base}/api/restaurant/tables/${encodeURIComponent(tableId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t.slice(0, 280) || `HTTP ${r.status}`);
        return;
      }
      const updated = tables.map((tRow: RestTable) =>
        String(tRow.id) === String(tableId) ? { ...tRow, status } : tRow,
      );
      setTables(updated);
    } catch (e) {
      setMsg(briefNetworkHint(e));
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

  const orderTakerBase = location.pathname.startsWith("/app/manager")
    ? "/app/manager"
    : location.pathname.startsWith("/app/developer")
      ? "/app/developer"
      : "/app/waiter";

  const headerTitle =
    user?.role === "manager"
      ? "شريحات الطاولات — المدير"
      : user?.role === "developer"
        ? "شريحات الطاولات — مطوّر"
        : "جارسون الطلبات";

  return (
    <div className="role-op waiter-pos" onClick={() => setReport(null)}>
      <OperationalRoleHeader roleTitle={headerTitle} hideBack />

      <div className="role-op__main">
        <div className="waiter-tables-toolbar">
          <h2 className="role-op__section-title">اختر الطاولة</h2>
          <button type="button" className="btn btn-ghost" onClick={() => void loadTables()} style={{ fontWeight: 800 }}>
            تحديث القائمة
          </button>
        </div>
        {msg && <p className="waiter-pos__msg">{msg}</p>}

        <div className="waiter-tables-grid">
          {tables.map((t) => {
            if (t.isSeparator) {
              return (
                <div key={t.id} className="waiter-tables-floor-band" role="group" aria-label={t.name}>
                  {t.name}
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
            const sidStr = sessionByTable.get(String(t.id)) || "";
            const sessRow = sessions.find(
              (s) => String(s?.tableId || "") === String(t.id) && String(s?.status || "").toLowerCase() === "active",
            );
            const captainLabel = sessRow
              ? String(sessRow.captainName || sessRow.captainLogin || "").trim() || ""
              : "";
            const capId = sessRow ? String(sessRow.captainUserId || "").trim() : "";
            const isVipTable = Boolean(t.features?.vipSection);
            const cardTone = notReady ? "blocked" : isBusy ? "busy" : "ready";
            return (
              <div key={t.id} className="waiter-tables-card-wrap">
              <button
                type="button"
                className={`waiter-tables-card waiter-tables-card--${cardTone}${billReq ? " waiter-tables-card--bill" : ""}`}
                onClick={() => {
                  if (notReady) {
                    setMsg("الطاولة غير جاهزة. أكمل دورة التنظيف أولًا.");
                    return;
                  }
                  if (
                    exclusiveOn &&
                    capId &&
                    user?.id &&
                    String(capId) !== String(user.id) &&
                    user.role !== "manager" &&
                    user.role !== "developer"
                  ) {
                    const nm = captainLabel || "كابتن آخر";
                    setMsg(`الطاولة مسندة إلى ${nm}. يتدخل المدير لتحويل الكابتن أو سجّل تسكينك إن كنت المسؤول.`);
                    return;
                  }
                  const q =
                    `tableId=${encodeURIComponent(t.id)}` +
                    (sidStr ? `&sessionId=${encodeURIComponent(sidStr)}` : "");
                  navigate(`${orderTakerBase}/order-taker?${q}`);
                }}
                onContextMenu={(ev) => showTableReport(t, ev)}
              >
                {noOrderOverdue ? <span className="waiter-tables-card-flag" title="تأخر طلب على الطاولة">⏱</span> : null}
                <div className="waiter-tables-card-num">
                  <span>{num}</span>
                  {isVipTable ? (
                    <span className="waiter-tables-vip-pill" title="فوترة VIP من إعدادات التشغيل عند فتح الجلسة">
                      VIP
                    </span>
                  ) : null}
                </div>
                <div className="waiter-tables-card-meta">المقاعد: {t.seats ?? "—"}</div>
                {captainLabel ? (
                  <div className="waiter-tables-card-captain">كابتن: {captainLabel}</div>
                ) : sidStr ? (
                  <div className="waiter-tables-card-captain waiter-tables-card-captain--muted">لم يُسكَّن كابتن بعد</div>
                ) : null}
                <div
                  className={`waiter-tables-card-status ${notReady ? "waiter-tables-card-status--hold" : isBusy ? "waiter-tables-card-status--busy" : "waiter-tables-card-status--ok"}`}
                >
                  {notReady ? (tStatus === "dirty" ? "متسخة" : "قيد التنظيف") : isBusy ? "مشغولة" : "جاهزة"}
                  {billReq ? " · طلب حساب" : ""}
                </div>
                {cleanupOverdue ? (
                  <div className="waiter-tables-card-alert waiter-tables-card-alert--danger">تنبيه: تأخر تنظيف أكثر من 10 دقائق</div>
                ) : null}
                {noOrderOverdue ? (
                  <div className="waiter-tables-card-alert waiter-tables-card-alert--delay">
                    تنبيه: تأخر أخذ الطلب {noOrderMinutes} د
                  </div>
                ) : null}
                <div className="waiter-tables-inline-actions">
                  {tStatus === "dirty" && (
                    <button
                      type="button"
                      className="waiter-tables-pill-btn waiter-tables-pill-btn--warm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void changeTableStatus(String(t.id), "cleaning");
                      }}
                    >
                      بدء تنظيف
                    </button>
                  )}
                  {tStatus === "cleaning" && (
                    <button
                      type="button"
                      className="waiter-tables-pill-btn waiter-tables-pill-btn--ok"
                      onClick={(e) => {
                        e.stopPropagation();
                        void changeTableStatus(String(t.id), "ready");
                      }}
                    >
                      تم التنظيف
                    </button>
                  )}
                </div>
              </button>
              {sidStr ? (
                <div className="waiter-tables-wrap-btns" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    disabled={claimBusy || notReady}
                    onClick={() => void claimCaptain(sidStr)}
                  >
                    {capId && user?.id && String(capId) === String(user.id) ? "أنت الكابتن ✓" : "تسكين كابتن"}
                  </button>
                  {(user?.role === "manager" || user?.role === "developer") && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      disabled={notReady}
                      onClick={() => {
                        setReassignSid(sidStr);
                        setReassignPickId("");
                      }}
                    >
                      تحويل كابتن
                    </button>
                  )}
                </div>
              ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {reassignSid ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            zIndex: 1100,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => !reassignBusy && setReassignSid(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: "100%", padding: "1rem 1.1rem", direction: "rtl" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, marginBottom: 8 }}>تحويل الكابتن (مدير)</div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>اختر جرسون الطلبات / الاستقبال</label>
            <select className="waiter-pos__select" style={{ width: "100%", marginBottom: 12 }} value={reassignPickId} onChange={(e) => setReassignPickId(e.target.value)}>
              <option value="">— اختر —</option>
              {staffUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.login} ({u.login})
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" disabled={reassignBusy} onClick={() => setReassignSid(null)}>
                إلغاء
              </button>
              <button type="button" className="btn btn-primary" disabled={reassignBusy || !reassignPickId} onClick={() => void submitReassignCaptain()}>
                {reassignBusy ? "…" : "تأكيد"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
