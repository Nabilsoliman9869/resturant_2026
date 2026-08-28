import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { playKitchenWarnBeep } from "../lib/kdsBeep";
import { kitchenLineKindLabel, parseKitchenTicketItem } from "../lib/kitchenTicketDisplay";
import "../styles/operationalRoles.css";

type OrderItem = {
  lineId?: string;
  name?: string;
  quantity?: number;
  productGuide?: string;
  ProductGuide?: string;
  prepared?: boolean;
  preparedQty?: number;
  sent?: boolean;
  handoffAt?: string | null;
  lineStatus?: string;
  lineStartedAt?: string | null;
  cancelled?: boolean;
  notes?: string;
  kitchenNotes?: string;
  modifiers?: Array<{ groupName?: string; itemName?: string; source?: string }>;
  seatNo?: number | null;
};
type OrderRow = {
  id: string;
  tableId: string;
  tableGuid?: string;
  tableLabel?: string;
  sessionId?: string;
  status: string;
  items: OrderItem[];
  prepStartTime?: string;
  prepTargetMinutes?: number;
  generalOrder?: boolean;
  /** يُملأ من فاتورة المطعم — رقم يظهر للمطبخ بدل مقطع UUID */
  billNumber?: number;
  ticketNo?: number;
  createdAt?: string;
  completedAt?: string;
  kpiLeadMinutes?: number;
  /** الكابتن / المرسل للمطبخ */
  captainName?: string;
  captainLogin?: string;
  captainUserId?: string;
  waiterId?: string;
};

type KdsSettings = { prepTargetMinutes: number; warnBeforeEndMinutes: number };
type KitchenSpecialistChefRow = {
  id: string;
  label: string;
  jobTitle: string;
  active: boolean;
  stationCode?: string;
  userId?: string;
  userLogin?: string;
  productGuids: string[];
};
type KitchenSpecialistStationRow = { id: string; label: string; jobTitle?: string; active?: boolean; stationCode?: string };
type KitchenOpsSnapshot = {
  kitchenExecutionMode?: string;
  kitchenSpecialistStationsJson?: string;
  kitchenSpecialistChefsJson?: string;
  deliverFromKitchenBy?: string;
};
type SummaryRow = { name: string; totalQty: number; preparedQty: number; remainingQty: number };
type ManagerOrderInsight = {
  targetMinutes: number;
  clientRemainingSec: number | null;
  clientDeadlineTs: number | null;
  clientLabel: string;
  clientOverdue: boolean;
  clientAtRisk: boolean;
  executionStarted: boolean;
  pendingLineCount: number;
  pendingQty: number;
  ageMinutes: number;
  priorityScore: number;
  priorityLabel: string;
};

const SUMMARY_EPSILON = 0.0001;

function orderHasKitchenWork(order: OrderRow): boolean {
  const items = Array.isArray(order.items) ? order.items : [];
  for (const it of items) {
    if (it?.cancelled) continue;
    const status = String(it?.lineStatus || "").trim().toLowerCase();
    if (status === "pending" || status === "preparing") return true;
    const qty = Math.max(0, Number(it?.quantity || 0));
    const preparedQty = Math.max(0, Number(it?.preparedQty || 0));
    const sent = Boolean(it?.sent);
    const handed = Boolean(it?.handoffAt);
    if (!sent && !handed && preparedQty + SUMMARY_EPSILON < qty) return true;
  }
  return false;
}
type TableInsight = {
  tableId: string;
  orders: OrderRow[];
  completionPct: number;
  priorityScore: number;
  riskLabel: string;
  completionEtaLabel: string;
  completionRemainingSec: number | null;
  openQty: number;
  activeExecutions: number;
};

function orderLabel(o: OrderRow) {
  const parts = (o.items || []).map((i) => `${i.name || "صنف"} ×${i.quantity || 1}`);
  return parts.length ? parts.join(" · ") : "بدون بنود";
}

function lineRemainingForSummary(i: OrderItem): number {
  const qty = Math.max(0, Number(i.quantity || 0));
  if (!qty) return 0;
  if (i.sent || i.handoffAt || String(i.lineStatus || "").toLowerCase() === "ready" || i.prepared) return 0;
  const preparedQty = Math.max(0, Math.min(qty, Number(i.preparedQty || 0)));
  return Math.max(0, qty - preparedQty);
}

function linePreparedForSummary(i: OrderItem): number {
  const qty = Math.max(0, Number(i.quantity || 0));
  if (!qty) return 0;
  if (i.sent || i.handoffAt || String(i.lineStatus || "").toLowerCase() === "ready" || i.prepared) return qty;
  return Math.max(0, Math.min(qty, Number(i.preparedQty || 0)));
}

function normalizeSummaryItemName(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "صنف";
  // في الملخص: بدون كرسي/طاولة، تجميع بالاسم فقط
  s = s.replace(/\([^)]*كرسي[^)]*\)/gi, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || "صنف";
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function summaryTileStyle(name: string, qty: number) {
  const hue = hashHue(name);
  const bg = `hsl(${hue} 75% 92%)`;
  const border = qty >= 6 ? "#dc2626" : `hsl(${hue} 35% 62%)`;
  return { bg, border, high: qty >= 6 };
}

/** طلبات تظهر في KDS: لا نخفي الطلب لأن createdAt ناقص، أو بسبب اختلاف يوم التقويم بين الأجهزة — نافذة 72 ساعة */
function isKitchenShiftWindow(iso?: string): boolean {
  if (!iso) return true;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return true;
  const age = Date.now() - d.getTime();
  if (age < -600_000) return false;
  return age < 72 * 3600 * 1000;
}

function statusWeight(s: string) {
  const x = (s || "").toLowerCase();
  if (x === "ready") return 1;
  if (x === "preparing") return 0.55;
  if (x === "pending") return 0.2;
  return 0;
}

function kdsOrderDisplayTitle(o: OrderRow): string {
  if (typeof o.billNumber === "number" && Number.isFinite(o.billNumber)) {
    return `فاتورة #${o.billNumber}`;
  }
  if (typeof o.ticketNo === "number" && Number.isFinite(o.ticketNo)) {
    return `تذكرة #${o.ticketNo}`;
  }
  const hex = (o.id || "").replace(/-/g, "");
  if (hex.length >= 6) return `طلب ${hex.slice(-6).toUpperCase()}`;
  return `طلب ${(o.id || "").slice(0, 8)}`;
}

function kitchenTableDisplay(o: OrderRow): string {
  return String(o.tableLabel || o.tableId || "—");
}

function orderStatusLabelAr(status: string): string {
  const s = String(status || "").trim().toLowerCase();
  if (s === "pending") return "انتظار بدء التنفيذ";
  if (s === "preparing") return "قيد التنفيذ";
  if (s === "ready") return "جاهز للتسليم";
  if (s === "served") return "تم التسليم";
  if (s === "paid") return "مدفوع";
  if (s === "cancelled") return "ملغي";
  return s || "—";
}

function replaceOrderById(prev: OrderRow[], nextOrder: OrderRow): OrderRow[] {
  const idx = prev.findIndex((o) => o.id === nextOrder.id);
  if (idx === -1) return [nextOrder, ...prev];
  const copy = [...prev];
  copy[idx] = nextOrder;
  return copy;
}

function sortOrdersByCreatedAtAsc(rows: OrderRow[]): OrderRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function tableCompletion(orders: OrderRow[]) {
  if (!orders.length) return 0;
  let lines = 0;
  let done = 0;
  for (const o of orders) {
    for (const it of o.items || []) {
      if (it.cancelled) continue;
      lines += 1;
      if (it.sent || it.prepared) done += 1;
    }
  }
  if (lines > 0) {
    return Math.min(100, Math.round((done / lines) * 100));
  }
  const sum = orders.reduce((a, o) => a + statusWeight(o.status), 0);
  return Math.min(100, Math.round((sum / orders.length) * 100));
}

function formatRemainingClock(totalSec: number | null) {
  if (totalSec == null || !Number.isFinite(totalSec)) return "—";
  const sec = Math.max(0, Math.ceil(totalSec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function formatDelayClock(totalSec: number | null) {
  if (totalSec == null || !Number.isFinite(totalSec)) return "—";
  const sec = Math.max(0, Math.ceil(Math.abs(totalSec)));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function computeManagerOrderInsight(order: OrderRow, settings: KdsSettings, nowTs: number): ManagerOrderInsight {
  const targetMinutes = Number(order.prepTargetMinutes) > 0 ? Number(order.prepTargetMinutes) : settings.prepTargetMinutes;
  const warnMinutes = Math.max(1, Number(settings.warnBeforeEndMinutes) || 5);
  const createdTs = order.createdAt ? new Date(order.createdAt).getTime() : NaN;
  const prepStartTs = order.prepStartTime ? new Date(order.prepStartTime).getTime() : NaN;
  // عداد ETA يبدأ فقط من أول "بدء تنفيذ" فعلي.
  const baselineTs = Number.isFinite(prepStartTs) ? prepStartTs : NaN;
  const clientDeadlineTs = Number.isFinite(baselineTs) ? baselineTs + targetMinutes * 60 * 1000 : null;
  const clientRemainingSec = clientDeadlineTs == null ? null : Math.ceil((clientDeadlineTs - nowTs) / 1000);
  const clientOverdue = clientRemainingSec != null && clientRemainingSec <= 0;
  const clientAtRisk = clientRemainingSec != null && clientRemainingSec > 0 && clientRemainingSec <= warnMinutes * 60;
  const ageMinutes = Number.isFinite(createdTs) ? Math.max(0, (nowTs - createdTs) / 60000) : 0;
  let pendingLineCount = 0;
  let pendingQty = 0;
  let partialProgress = false;
  for (const it of order.items || []) {
    const remaining = lineRemainingForSummary(it);
    const preparedQty = linePreparedForSummary(it);
    if (remaining > 0) {
      pendingLineCount += 1;
      pendingQty += remaining;
    }
    if (preparedQty > 0 && remaining > 0) partialProgress = true;
  }
  const executionStarted =
    (order.status || "").toLowerCase() === "preparing" || Boolean(order.prepStartTime) || partialProgress || pendingQty === 0;
  let priorityScore = 0;
  if (clientOverdue) priorityScore += 2400 + Math.min(900, Math.abs(clientRemainingSec || 0) / 10);
  else if (clientAtRisk) priorityScore += 1500 + Math.max(0, ((warnMinutes * 60) - (clientRemainingSec || 0)) / 6);
  else if (clientRemainingSec != null) priorityScore += Math.max(0, 900 - clientRemainingSec / 5);
  priorityScore += Math.min(280, pendingQty * 18);
  priorityScore += Math.min(240, pendingLineCount * 28);
  priorityScore += Math.min(220, ageMinutes * 2.4);
  if (executionStarted) priorityScore += 110;
  if (targetMinutes <= 12) priorityScore += 70;
  else if (targetMinutes <= 20) priorityScore += 35;
  const priorityLabel = clientOverdue ? "متأخر" : clientAtRisk ? "معرّض" : executionStarted ? "قيد التنفيذ" : "انتظار";
  const clientLabel =
    clientRemainingSec == null
      ? "لم يبدأ التنفيذ بعد"
      : clientOverdue
        ? `تأخير ${formatDelayClock(clientRemainingSec)}`
        : `ETA ${formatRemainingClock(clientRemainingSec)}`;
  return {
    targetMinutes,
    clientRemainingSec,
    clientDeadlineTs,
    clientLabel,
    clientOverdue,
    clientAtRisk,
    executionStarted,
    pendingLineCount,
    pendingQty,
    ageMinutes,
    priorityScore,
    priorityLabel,
  };
}

function riskTone(kind: "overdue" | "at_risk" | "active" | "normal") {
  if (kind === "overdue") return { fg: "#991b1b", bg: "#fee2e2", border: "#ef4444" };
  if (kind === "at_risk") return { fg: "#92400e", bg: "#fef3c7", border: "#f59e0b" };
  if (kind === "active") return { fg: "#1d4ed8", bg: "#dbeafe", border: "#3b82f6" };
  return { fg: "#166534", bg: "#dcfce7", border: "#22c55e" };
}

function usePrepCountdown(prepStartIso: string | undefined, targetMinutes: number, warnMinutes: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => {
    if (!prepStartIso) {
      return { remainingSec: null as number | null, urgent: false, overdue: false, label: "—" };
    }
    const start = new Date(prepStartIso).getTime();
    if (!Number.isFinite(start)) {
      return { remainingSec: null, urgent: false, overdue: false, label: "—" };
    }
    const end = start + targetMinutes * 60 * 1000;
    const now = Date.now();
    const rem = Math.ceil((end - now) / 1000);
    const warnSec = Math.max(30, warnMinutes * 60);
    const urgent = rem > 0 && rem <= warnSec;
    const overdue = rem <= 0;
    if (overdue) {
      const late = Math.max(0, -rem);
      const mm = Math.floor(late / 60);
      const ss = late % 60;
      return {
        remainingSec: rem,
        urgent: false,
        overdue: true,
        label: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`,
      };
    }
    const mm = Math.floor(rem / 60);
    const ss = rem % 60;
    return { remainingSec: rem, urgent, overdue: false, label: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` };
  }, [prepStartIso, targetMinutes, warnMinutes, tick]);
}

function KdsOrderCard({
  order,
  settings,
  base,
  alertType,
  alertTitlePrefix,
  mode,
  insight,
}: {
  order: OrderRow;
  settings: KdsSettings;
  base: string;
  alertType: string;
  alertTitlePrefix: string;
  mode: KitchenPageMode;
  insight: ManagerOrderInsight;
}) {
  const target = Number(order.prepTargetMinutes) > 0 ? Number(order.prepTargetMinutes) : settings.prepTargetMinutes;
  const warn = settings.warnBeforeEndMinutes;
  const preparing = (order.status || "").toLowerCase() === "preparing";
  // إذا كان prepStartTime موجوداً نستخدمه دائماً للعد التنازلي، حتى لو لم يتغير status بعد
  const { urgent, overdue } = usePrepCountdown(order.prepStartTime ? order.prepStartTime : undefined, target, warn);
  const cashierNotifiedRef = useRef(false);
  const managerTone = insight.clientOverdue ? riskTone("overdue") : insight.clientAtRisk ? riskTone("at_risk") : insight.executionStarted ? riskTone("active") : riskTone("normal");

  useEffect(() => {
    if (!preparing) {
      cashierNotifiedRef.current = false;
      return;
    }
    if (!urgent && !overdue) return;
    if (cashierNotifiedRef.current) return;
    cashierNotifiedRef.current = true;
    const labelT = kdsOrderDisplayTitle(order);
    void fetch(`${base}/api/restaurant/cashier/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: alertType,
        sourceKey: `${alertType}:${order.id}`,
        title: `${alertTitlePrefix} · ${labelT}`,
        body: orderLabel(order).slice(0, 400),
        tableId: order.tableGuid || order.tableId,
        sessionId: order.sessionId || undefined,
        orderId: order.id,
      }),
    });
  }, [preparing, urgent, overdue, base, order.id, order.tableId, order.tableGuid, order.sessionId, order.generalOrder, order.billNumber, order.ticketNo, alertType, alertTitlePrefix]);

  useEffect(() => {
    if (!urgent && !overdue) return;
    playKitchenWarnBeep();
    const id = window.setInterval(() => playKitchenWarnBeep(), 45000);
    return () => window.clearInterval(id);
  }, [urgent, overdue]);

  const leadLabel = (() => {
    if (typeof order.kpiLeadMinutes === "number" && Number.isFinite(order.kpiLeadMinutes)) {
      return `${order.kpiLeadMinutes.toFixed(1)} د`;
    }
    if (order.createdAt) {
      const a = new Date(order.createdAt).getTime();
      const b = Date.now();
      if (Number.isFinite(a) && b >= a) return `${((b - a) / 60000).toFixed(1)} د`;
    }
    return "—";
  })();

  return (
    <div className={`kds-card ${urgent || overdue || insight.clientOverdue ? "kds-card--urgent" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="kds-card__table-hero"
            title={`معرّف النظام: ${order.id}`}
            style={{ fontWeight: 900, fontSize: "1.35rem", letterSpacing: "0.01em", lineHeight: 1.2 }}
          >
            {kitchenTableDisplay(order)}
            <span style={{ fontWeight: 700, fontSize: "0.95rem", marginInlineStart: 8, opacity: 0.85 }}>
              {kdsOrderDisplayTitle(order)}
            </span>
            {order.generalOrder ? (
              <span style={{ marginRight: 8, fontSize: "0.75rem", color: "var(--wp-accent, #38bdf8)" }}>· عام</span>
            ) : null}
          </div>
          {!(
            (typeof order.billNumber === "number" && Number.isFinite(order.billNumber)) ||
            (typeof order.ticketNo === "number" && Number.isFinite(order.ticketNo))
          ) ? (
            <div style={{ color: "var(--wp-muted)", fontSize: "0.72rem", marginTop: 2 }} title={order.id}>
              مرجع قديم: {order.id.slice(0, 8)}…
            </div>
          ) : null}
          <div style={{ color: "var(--wp-muted)", fontSize: "0.8rem", marginTop: 4 }}>
            {orderStatusLabelAr(order.status)}
            {order.createdAt ? (
              <span style={{ marginInlineStart: 8, color: "#0369a1", fontWeight: 800 }} title="وقت إرسال الطلب للمطبخ">
                · إرسال {(() => {
                  try {
                    return new Date(order.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true });
                  } catch {
                    return "";
                  }
                })()}
              </span>
            ) : null}
            {leadLabel !== "—" ? (
              <span style={{ marginInlineStart: 8, fontWeight: 700 }}>· منذ {leadLabel}</span>
            ) : null}
          </div>
          {String(order.captainName || order.captainLogin || "").trim() ? (
            <div
              style={{
                marginTop: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: 999,
                background: "rgba(14,165,233,0.12)",
                border: "1px solid rgba(14,165,233,0.35)",
                color: "#0c4a6e",
                fontSize: "0.82rem",
                fontWeight: 800,
              }}
              title="الكابتن المرسل للطلب"
            >
              كابتن: {String(order.captainName || order.captainLogin || "").trim()}
            </div>
          ) : null}
          {mode === "kitchen" ? (
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: managerTone.bg,
                  color: managerTone.fg,
                  border: `1px solid ${managerTone.border}`,
                  fontSize: "0.78rem",
                  fontWeight: 800,
                }}
              >
                {insight.priorityLabel}
              </span>
              <span style={{ fontSize: "0.82rem", color: "var(--wp-text)" }}>{insight.clientLabel}</span>
              <span style={{ fontSize: "0.8rem", color: "var(--wp-muted)" }}>
                متبقي {Number(insight.pendingQty).toFixed(Number.isInteger(insight.pendingQty) ? 0 : 2)}
              </span>
            </div>
          ) : null}
          <div style={{ marginTop: 10, display: "grid", gap: 8 }} className="kds-card__items">
            {(order.items || []).map((it, idx) => {
              const prepared = Boolean(it.prepared);
              const qty = Math.max(0, Number(it.quantity || 1));
              const preparedQty = Math.max(0, Math.min(qty, Number(it.preparedQty || (prepared ? qty : 0))));
              const lineStatus = String(it.lineStatus || "").trim().toLowerCase();
              const delivered = Boolean(it.sent || lineStatus === "sent");
              const handedToRunner = Boolean(it.handoffAt);
              const lineStarted = Boolean(lineStatus === "preparing");
              const lineDone = Boolean((prepared || lineStatus === "ready") && !handedToRunner && !delivered);
              const lineSent = Boolean(handedToRunner && !delivered);
              const lineStateLabel = delivered
                ? "تم التسليم"
                : lineSent
                  ? "مرسل"
                  : lineDone
                    ? "جاهز"
                    : lineStarted
                      ? "تنفيذ"
                      : "انتظار";
              const badgeBg = delivered
                ? "#64748b"
                : lineSent
                  ? "#b45309"
                  : lineDone
                    ? "#065f46"
                    : lineStarted
                      ? "#1e3a8a"
                      : "#334155";
              return (
                <div
                  key={String(it.lineId || `${order.id}-${idx}`)}
                  className={`kds-item-frame kds-card__item-row${delivered ? " is-done" : ""}`}
                >
                  <div className="kds-item-frame__qty" title="الكمية">
                    {qty > 1 && preparedQty > 0 && preparedQty < qty ? `${preparedQty}/${qty}` : qty}
                  </div>
                  <div className="kds-item-frame__body">
                    {(() => {
                      const parsed = parseKitchenTicketItem({
                        name: it.name,
                        notes: it.notes,
                        kitchenNotes: it.kitchenNotes,
                        modifiers: it.modifiers,
                      });
                      const seatTxt =
                        parsed.seatHint ||
                        (it.seatNo != null && Number(it.seatNo) >= 1 ? `كرسي ${it.seatNo}` : null);
                      return (
                        <>
                          {seatTxt ? (
                            <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#0369a1" }}>{seatTxt}</div>
                          ) : null}
                          <ul className="kds-item-frame__lines">
                            {parsed.lines.map((ln, li) => (
                              <li key={`${it.lineId || idx}-ln-${li}`} className={`kds-item-line is-${ln.kind}`}>
                                <span className="kds-item-line__kind">{kitchenLineKindLabel(ln.kind)}</span>
                                <span className="kds-item-line__text">
                                  {ln.kind !== "main" && ln.label ? (
                                    <span className="kds-item-line__label">{ln.label}:</span>
                                  ) : null}
                                  {ln.value}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      );
                    })()}
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 72,
                      padding: "8px 10px",
                      borderRadius: 10,
                      fontWeight: 900,
                      fontSize: "0.82rem",
                      background: badgeBg,
                      color: "#fff",
                    }}
                  >
                    {lineStateLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: "0.82rem", color: "var(--wp-muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span>مستهدف الطاولة: {target} د</span>
        <span>تنبيه قبل النهاية: {warn} د</span>
        {mode === "kitchen" ? <span>عمر الطلب: {insight.ageMinutes.toFixed(1)} د</span> : null}
      </div>
      <div style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--wp-muted)" }}>
        KPI · من الاستقبال حتى آخر تنفيذ: <strong>{leadLabel}</strong>
      </div>
    </div>
  );
}

export type KitchenPageMode = "kitchen" | "speed" | "specialist";

export default function KitchenPage({ mode = "kitchen" }: { mode?: KitchenPageMode }) {
  const { user } = useAuth();
  const base = getApiBase();
  const kdsQ = mode === "speed" ? "kdsStation=speed" : "kdsStation=kitchen";
  const alertType = mode === "speed" ? "speed_order_urgent" : "kitchen_urgent";
  const alertTitlePrefix = mode === "speed" ? "استعجال طلبات سريعة" : mode === "specialist" ? "استعجال شيف مختص" : "استعجال مطبخ";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [settings, setSettings] = useState<KdsSettings>({ prepTargetMinutes: 20, warnBeforeEndMinutes: 5 });
  const [ops, setOps] = useState<KitchenOpsSnapshot>({ kitchenExecutionMode: "current", kitchenSpecialistChefsJson: "[]" });
  const [msg, setMsg] = useState("");
  const [filterTable, setFilterTable] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [showSpecialistDetails, setShowSpecialistDetails] = useState(false);
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadAll = useCallback(async () => {
    setMsg("");
    try {
      const [or, ks, op] = await Promise.all([
        fetch(`${base}/api/restaurant/orders?${kdsQ}`),
        fetch(`${base}/api/restaurant/kds-settings`),
        fetch(`${base}/api/restaurant/ops-settings`).catch(() => new Response("{}")),
      ]);
      const oj = tryParseJson<{ orders?: OrderRow[] }>(await or.text()) ?? {};
      const kj = tryParseJson<{ prepTargetMinutes?: number; warnBeforeEndMinutes?: number }>(await ks.text()) ?? {};
      const opj = tryParseJson<KitchenOpsSnapshot>(await op.text()) ?? {};
      setOrders(Array.isArray(oj.orders) ? oj.orders : []);
      setSettings({
        prepTargetMinutes: Number(kj.prepTargetMinutes) || 20,
        warnBeforeEndMinutes: Number(kj.warnBeforeEndMinutes) || 5,
      });
      setOps({
        kitchenExecutionMode: String(opj.kitchenExecutionMode || "current"),
        kitchenSpecialistStationsJson: String(opj.kitchenSpecialistStationsJson || "[]"),
        kitchenSpecialistChefsJson: String(opj.kitchenSpecialistChefsJson || "[]"),
        deliverFromKitchenBy: String(opj.deliverFromKitchenBy || "server").trim().toLowerCase(),
      });
    } catch (e) {
      const raw = String(e || "").toLowerCase();
      setMsg(raw.includes("failed to fetch") ? "تعذر الاتصال بالخادم" : `تعذر التحميل: ${String(e)}`);
    }
  }, [base, kdsQ]);

  useEffect(() => {
    void loadAll();
    const id = window.setInterval(() => void loadAll(), 15000);
    return () => window.clearInterval(id);
  }, [loadAll]);

  async function adjustPreparedQty(orderId: string, lineId: string, delta: number) {
    const key = `${orderId}:${lineId}:prepared-delta`;
    setMsg("");
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      const r = await fetch(`${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(lineId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preparedDelta: delta }),
      });
      const txt = await r.text();
      if (!r.ok) throw new Error(txt);
      const j = tryParseJson<{ order?: OrderRow }>(txt) ?? {};
      if (j.order && typeof j.order.id === "string") {
        setOrders((prev) => replaceOrderById(prev, j.order as OrderRow));
        if (delta > 0) {
          const line = (j.order.items || []).find((it) => String(it.lineId || "") === String(lineId));
          const qty = Math.max(0, Number(line?.quantity || 0));
          const preparedQty = Math.max(0, Number(line?.preparedQty || 0));
          const done = Boolean(line?.prepared) || (qty > 0 && preparedQty >= qty);
          const alreadyHandedOff = Boolean(line?.handoffAt || line?.sent || String(line?.lineStatus || "").toLowerCase() === "sent");
          if (done && !alreadyHandedOff) {
            await sendLine(orderId, lineId);
          }
        }
      } else {
        await loadAll();
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function sendLine(orderId: string, lineId: string) {
    const key = `${orderId}:${lineId}`;
    setMsg("");
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      const r = await fetch(`${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(lineId)}/send`, {
        method: "POST",
      });
      const txt = await r.text();
      if (!r.ok) throw new Error(txt);
      const j = tryParseJson<{ order?: OrderRow }>(txt) ?? {};
      if (j.order && typeof j.order.id === "string") {
        setOrders((prev) => replaceOrderById(prev, j.order as OrderRow));
      } else {
        await loadAll();
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const pending = useMemo(
    () =>
      orders.filter(
        (o) =>
          isKitchenShiftWindow(o.createdAt) &&
          !["served", "paid", "cancelled"].includes((o.status || "").toLowerCase()) &&
          orderHasKitchenWork(o),
      ),
    [orders],
  );

  const specialistChefs = useMemo(() => {
    const raw = String(ops.kitchenSpecialistChefsJson || "[]").trim();
    if (!raw) return [] as KitchenSpecialistChefRow[];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [] as KitchenSpecialistChefRow[];
      return arr
        .filter((x) => x && typeof x === "object")
        .map((x) => {
          const row = x as Partial<KitchenSpecialistChefRow>;
          return {
            id: String(row.id || ""),
            label: String(row.label || ""),
            jobTitle: String(row.jobTitle || ""),
            active: row.active !== false,
            stationCode: String(row.stationCode || "").trim().toLowerCase(),
            userId: String(row.userId || "").trim().toUpperCase(),
            userLogin: String(row.userLogin || "").trim().toLowerCase(),
            productGuids: Array.isArray(row.productGuids) ? row.productGuids.map((g) => String(g || "").trim().toUpperCase()) : [],
          };
        })
        .filter((x) => x.id || x.label);
    } catch {
      return [] as KitchenSpecialistChefRow[];
    }
  }, [ops.kitchenSpecialistChefsJson]);

  const specialistStations = useMemo(() => {
    const raw = String(ops.kitchenSpecialistStationsJson || "[]").trim();
    if (!raw) return [] as KitchenSpecialistStationRow[];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [] as KitchenSpecialistStationRow[];
      return arr
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          id: String((x as KitchenSpecialistStationRow).id || ""),
          label: String((x as KitchenSpecialistStationRow).label || ""),
          jobTitle: String((x as KitchenSpecialistStationRow).jobTitle || ""),
          active: (x as KitchenSpecialistStationRow).active !== false,
          stationCode: String((x as KitchenSpecialistStationRow).stationCode || "").trim().toLowerCase(),
        }))
        .filter((x) => x.stationCode);
    } catch {
      return [] as KitchenSpecialistStationRow[];
    }
  }, [ops.kitchenSpecialistStationsJson]);

  const specialistStationByCode = useMemo(() => {
    const m = new Map<string, KitchenSpecialistStationRow>();
    for (const row of specialistStations) {
      const code = String(row.stationCode || "").trim().toLowerCase();
      if (!code) continue;
      m.set(code, row);
    }
    return m;
  }, [specialistStations]);

  const activeSpecialistChef = useMemo(() => {
    if (mode !== "specialist") return null;
    const stationCode = String(user?.specialistStationCode || "").trim().toLowerCase();
    if (stationCode) {
      const byStation = specialistChefs.find((row) => {
        if (!row.active) return false;
        return String(row.stationCode || "").trim().toLowerCase() === stationCode;
      });
      if (byStation) return byStation;
    }
    const uid = String(user?.id || "").trim().toUpperCase();
    const ulogin = String(user?.login || "").trim().toLowerCase();
    return (
      specialistChefs.find((row) => {
        if (!row.active) return false;
        const rid = String(row.userId || "").trim().toUpperCase();
        const rlogin = String(row.userLogin || "").trim().toLowerCase();
        return (uid && rid === uid) || (ulogin && rlogin === ulogin);
      }) || null
    );
  }, [mode, specialistChefs, user?.id, user?.login, user?.specialistStationCode]);

  const activeSpecialistStation = useMemo(() => {
    const stationCode = String(user?.specialistStationCode || "").trim().toLowerCase();
    if (!stationCode) return null;
    return specialistStationByCode.get(stationCode) || null;
  }, [specialistStationByCode, user?.specialistStationCode]);

  const scopedPending = useMemo(() => {
    if (mode !== "specialist") return pending;
    const allowed = new Set((activeSpecialistChef?.productGuids || []).map((g) => String(g || "").trim().toUpperCase()).filter(Boolean));
    if (!allowed.size) return [] as OrderRow[];
    return pending
      .map((o) => {
        const items = (o.items || []).filter((it) => {
          const gid = String((it.productGuide || it.ProductGuide || "")).trim().toUpperCase();
          return gid && allowed.has(gid);
        });
        return items.length ? { ...o, items } : null;
      })
      .filter((x): x is OrderRow => Boolean(x));
  }, [mode, pending, activeSpecialistChef]);

  const nowTs = useMemo(() => Date.now(), [clockTick]);

  const orderInsightById = useMemo(() => {
    const m = new Map<string, ManagerOrderInsight>();
    for (const o of scopedPending) {
      m.set(o.id, computeManagerOrderInsight(o, settings, nowTs));
    }
    return m;
  }, [scopedPending, settings, nowTs]);

  const filteredPending = useMemo(() => {
    const rows = [...scopedPending];
    rows.sort((a, b) => {
      const ia = orderInsightById.get(a.id);
      const ib = orderInsightById.get(b.id);
      const scoreDelta = (ib?.priorityScore || 0) - (ia?.priorityScore || 0);
      if (scoreDelta !== 0) return scoreDelta;
      const remA = ia?.clientRemainingSec ?? Number.POSITIVE_INFINITY;
      const remB = ib?.clientRemainingSec ?? Number.POSITIVE_INFINITY;
      if (remA !== remB) return remA - remB;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY;
      return ca - cb;
    });
    return rows;
  }, [scopedPending, orderInsightById]);

  const tableInsights = useMemo(() => {
    const m = new Map<string, OrderRow[]>();
    for (const o of filteredPending) {
      const tid = kitchenTableDisplay(o);
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid)!.push(o);
    }
    const rows: TableInsight[] = [];
    for (const [tableId, ordersForTable] of m.entries()) {
      const completionPct = tableCompletion(ordersForTable);
      let priorityScore = 0;
      let openQty = 0;
      let activeExecutions = 0;
      let hasOverdue = false;
      let hasAtRisk = false;
      let worstDelaySec: number | null = null;
      let completionRemainingSec: number | null = null;
      for (const order of ordersForTable) {
        const insight = orderInsightById.get(order.id);
        if (!insight) continue;
        priorityScore = Math.max(priorityScore, insight.priorityScore);
        openQty += insight.pendingQty;
        if (insight.executionStarted) activeExecutions += 1;
        if (insight.clientOverdue) {
          hasOverdue = true;
          if (insight.clientRemainingSec != null) {
            worstDelaySec = worstDelaySec == null ? insight.clientRemainingSec : Math.min(worstDelaySec, insight.clientRemainingSec);
          }
        } else if (insight.clientAtRisk) {
          hasAtRisk = true;
        }
        if (insight.clientRemainingSec != null) {
          completionRemainingSec = completionRemainingSec == null ? insight.clientRemainingSec : Math.max(completionRemainingSec, insight.clientRemainingSec);
        }
      }
      const riskLabel = hasOverdue ? "متأخرة" : hasAtRisk ? "معرّضة" : activeExecutions > 0 ? "قيد التنفيذ" : "آمنة";
      const completionEtaLabel = hasOverdue
        ? `تأخير ${formatDelayClock(worstDelaySec)}`
        : completionRemainingSec == null
          ? "ETA —"
          : `ETA ${formatRemainingClock(completionRemainingSec)}`;
      rows.push({
        tableId,
        orders: ordersForTable,
        completionPct,
        priorityScore,
        riskLabel,
        completionEtaLabel,
        completionRemainingSec,
        openQty,
        activeExecutions,
      });
    }
    rows.sort((a, b) => {
      const scoreDelta = b.priorityScore - a.priorityScore;
      if (scoreDelta !== 0) return scoreDelta;
      const remA = a.completionRemainingSec ?? Number.POSITIVE_INFINITY;
      const remB = b.completionRemainingSec ?? Number.POSITIVE_INFINITY;
      if (remA !== remB) return remA - remB;
      return a.tableId.localeCompare(b.tableId, "ar");
    });
    return rows;
  }, [filteredPending, orderInsightById]);

  const byTable = tableInsights;

  const visible = useMemo(() => {
    if (!filterTable) return filteredPending;
    return filteredPending.filter((o) => kitchenTableDisplay(o) === filterTable);
  }, [filteredPending, filterTable]);

  const managerStats = useMemo(() => {
    let overdueTables = 0;
    let atRiskTables = 0;
    let activeTables = 0;
    let openQty = 0;
    for (const row of tableInsights) {
      openQty += row.openQty;
      if (row.riskLabel === "متأخرة") overdueTables += 1;
      else if (row.riskLabel === "معرّضة") atRiskTables += 1;
      if (row.activeExecutions > 0) activeTables += 1;
    }
    const pressure = overdueTables >= 2 || openQty >= 18 ? "عال" : atRiskTables >= 2 || openQty >= 10 ? "متوسط" : "مستقر";
    return {
      openTables: tableInsights.length,
      overdueTables,
      atRiskTables,
      activeTables,
      openQty,
      pressure,
    };
  }, [tableInsights]);

  function findSummaryTarget(summaryName: string) {
    const ageOrdered = sortOrdersByCreatedAtAsc(filteredPending);
    for (const o of ageOrdered) {
      for (let idx = 0; idx < (o.items || []).length; idx++) {
        const it = o.items[idx];
        const nm = normalizeSummaryItemName(String(it?.name || "صنف"));
        if (nm !== summaryName) continue;
        if (lineRemainingForSummary(it || {}) <= 0) continue;
        const lid = String(it?.lineId || `${o.id}-${idx}`);
        return { orderId: o.id, lineId: lid };
      }
    }
    return null;
  }

  function findSummaryPreparedTarget(summaryName: string) {
    for (const o of [...filteredPending].reverse()) {
      const items = [...(o.items || [])];
      for (let idx = items.length - 1; idx >= 0; idx--) {
        const it = items[idx];
        const nm = normalizeSummaryItemName(String(it?.name || "صنف"));
        if (nm !== summaryName) continue;
        if (linePreparedForSummary(it || {}) <= 0) continue;
        if (it?.sent || it?.handoffAt) continue;
        const lid = String(it?.lineId || `${o.id}-${idx}`);
        return { orderId: o.id, lineId: lid };
      }
    }
    return null;
  }

  const readyToSendCount = useMemo(() => {
    let count = 0;
    for (const o of filteredPending) {
      for (const it of o.items || []) {
        const status = String(it.lineStatus || "").trim().toLowerCase();
        if (it.sent || it.handoffAt) continue;
        if (status === "ready" || it.prepared) count += 1;
      }
    }
    return count;
  }, [filteredPending]);

  async function sendAllReady() {
    const targets: Array<{ orderId: string; lineId: string; createdAtTs: number; linePos: number }> = [];
    const ageOrdered = sortOrdersByCreatedAtAsc(filteredPending);
    for (const o of ageOrdered) {
      for (let idx = 0; idx < (o.items || []).length; idx++) {
        const it = o.items[idx];
        const status = String(it.lineStatus || "").trim().toLowerCase();
        if (it.sent || it.handoffAt) continue;
        if (!(status === "ready" || it.prepared)) continue;
        const ts = o.createdAt ? new Date(o.createdAt).getTime() : Number.POSITIVE_INFINITY;
        targets.push({ orderId: o.id, lineId: String(it.lineId || `${o.id}-${idx}`), createdAtTs: ts, linePos: idx });
      }
    }
    targets.sort((a, b) => {
      if (a.createdAtTs !== b.createdAtTs) return a.createdAtTs - b.createdAtTs;
      if (a.orderId !== b.orderId) return a.orderId.localeCompare(b.orderId);
      return a.linePos - b.linePos;
    });
    if (!targets.length) {
      setMsg("لا توجد بنود جاهزة للإرسال الآن.");
      return;
    }
    setMsg("");
    for (const t of targets) {
      // إرسال متسلسل حتى تبقى حالة الطلبات متسقة في الذاكرة والواجهة.
      // eslint-disable-next-line no-await-in-loop
      await sendLine(t.orderId, t.lineId);
    }
  }

  async function finishTableOrders(tableKey: string, orderIds: string[]) {
    const key = `finish-table:${tableKey}`;
    if (!tableKey && !orderIds.length) return;
    if (!window.confirm(`إنهاء كل أصناف الطاولة ${tableKey}؟\nحسب السياسة: إما طابور الاستلام أو مباشرة للطاولة.`)) return;
    setMsg("");
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      const r = await fetch(`${base}/api/restaurant/orders/finish-table`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: tableKey, orderIds }),
      });
      const txt = await r.text();
      if (!r.ok) throw new Error(txt);
      const j = tryParseJson<{
        linesFinished?: number;
        ordersUpdated?: number;
        deliveryPath?: string;
      }>(txt) ?? {};
      const pathLabel = String(j.deliveryPath || "") === "direct_to_table" ? "مباشرة للطاولة" : "طابور الاستلام";
      setMsg(`تم إنهاء ${j.linesFinished ?? 0} بنداً (${j.ordersUpdated ?? 0} طلب) — المسار: ${pathLabel}.`);
      await loadAll();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const deliverPathHint =
    String(ops.deliverFromKitchenBy || "server").trim().toLowerCase() === "none"
      ? "بعد إنهاء المطبخ تذهب الأصناف مباشرة للطاولة (لا أحد يستلم)."
      : String(ops.deliverFromKitchenBy || "").trim().toLowerCase() === "kitchen_window"
        ? "مسار نافذة الشيف — بدون طابور مناولة."
        : "بعد إنهاء المطبخ تذهب الأصناف لطابور من يستلم من المطبخ.";

  const summaryRows = useMemo(() => {
    const m = new Map<string, SummaryRow>();
    for (const o of filteredPending) {
      for (const it of o.items || []) {
        const nm = normalizeSummaryItemName(String(it.name || "صنف"));
        const totalQty = Math.max(0, Number(it.quantity || 0));
        const preparedQty = linePreparedForSummary(it);
        const remainingQty = lineRemainingForSummary(it);
        if (!m.has(nm)) {
          m.set(nm, { name: nm, totalQty: 0, preparedQty: 0, remainingQty: 0 });
        }
        const row = m.get(nm)!;
        row.totalQty += totalQty;
        row.preparedQty += preparedQty;
        row.remainingQty += remainingQty;
      }
    }
    return Array.from(m.values())
      .filter((x) => x.totalQty > 0 && x.remainingQty > SUMMARY_EPSILON)
      .sort((a, b) => b.remainingQty - a.remainingQty);
  }, [filteredPending]);

  return (
    <div className="role-op waiter-pos">
      <OperationalRoleHeader
        roleTitle={mode === "speed" ? "الطلبات السريعة — KDS" : mode === "specialist" ? "الشيف المختص — KDS" : "المطبخ — KDS"}
        hideBack
        rightSlot={
          <span style={{ fontSize: "0.85rem", color: "var(--wp-muted)" }}>
            {mode === "kitchen" ? `ضغط ${managerStats.pressure}` : `تنبيه قبل ${settings.warnBeforeEndMinutes} د`}
          </span>
        }
      />

      <div className="role-op__main">
        <h2 className="role-op__section-title" style={{ marginBottom: "0.35rem" }}>
          {mode === "speed" ? "تجهيز (شيشة / مشروبات / غير طبخ)" : mode === "specialist" ? "شاشة الشيف المختص" : "شاشة التحضير"}
        </h2>
        {mode === "kitchen" ? (
          <div
            style={{
              marginBottom: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
            }}
          >
            {[
              { label: "الطاولات المفتوحة", value: managerStats.openTables, tone: riskTone("active") },
              { label: "متأخرة", value: managerStats.overdueTables, tone: riskTone("overdue") },
              { label: "معرّضة", value: managerStats.atRiskTables, tone: riskTone("at_risk") },
              { label: "قيد التنفيذ", value: managerStats.activeTables, tone: riskTone("normal") },
              { label: "بنود مفتوحة", value: Number(managerStats.openQty).toFixed(Number.isInteger(managerStats.openQty) ? 0 : 2), tone: riskTone("active") },
              { label: "ضغط التشغيل", value: managerStats.pressure, tone: managerStats.pressure === "عال" ? riskTone("overdue") : managerStats.pressure === "متوسط" ? riskTone("at_risk") : riskTone("normal") },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  borderRadius: 14,
                  padding: "0.8rem 0.9rem",
                  background: card.tone.bg,
                  border: `1px solid ${card.tone.border}`,
                  color: card.tone.fg,
                }}
              >
                <div style={{ fontSize: "0.8rem", fontWeight: 700, opacity: 0.9 }}>{card.label}</div>
                <div style={{ marginTop: 4, fontSize: "1.2rem", fontWeight: 900 }}>{card.value}</div>
              </div>
            ))}
          </div>
        ) : null}
        {mode === "specialist" ? (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.8rem 0.9rem",
              borderRadius: 12,
              border: "1px solid rgba(56,189,248,0.35)",
              background: "rgba(15,23,42,0.35)",
              color: "#e2e8f0",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              {activeSpecialistChef ? `الملف التشغيلي: ${activeSpecialistChef.label || activeSpecialistChef.stationCode || "شيف مختص"}` : "لا يوجد ملف تشغيلي"}
            </div>
            <div style={{ fontSize: "0.86rem", color: "#cbd5e1" }}>
              {String(ops.kitchenExecutionMode || "").trim().toLowerCase() !== "specialist_chefs"
                ? "الوضع غير مفعّل"
                : activeSpecialistChef
                  ? `المحطة: ${activeSpecialistStation?.label || activeSpecialistChef.label || activeSpecialistChef.stationCode || String(user?.specialistStationCode || "").trim().toLowerCase() || "غير محددة"} · عدد الأصناف: ${activeSpecialistChef.productGuids.length}`
                  : String(user?.specialistStationCode || "").trim()
                    ? "المحطة غير مرتبطة"
                    : "لا توجد محطة للمستخدم"}
            </div>
          </div>
        ) : String(ops.kitchenExecutionMode || "").trim().toLowerCase() === "specialist_chefs" ? (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.8rem 0.9rem",
              borderRadius: 12,
              border: "1px solid rgba(14,165,233,0.35)",
              background: "rgba(14,165,233,0.08)",
              color: "#e2e8f0",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 4 }}>وضع الشيف المختص مفعل</div>
            <div style={{ fontSize: "0.86rem", color: "#cbd5e1" }}>
              عدد المحطات النشطة: <strong>{specialistChefs.filter((x) => x.active).length}</strong>
            </div>
          </div>
        ) : null}

        {mode !== "specialist" ? (
          <div
            style={{
              marginBottom: 12,
              padding: "0.85rem 0.95rem",
              borderRadius: 14,
              background: "rgba(14,165,233,0.08)",
              border: "1px solid rgba(14,165,233,0.22)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: "0.9rem", color: "#0f172a", fontWeight: 700 }}>ترحيل الجاهز من الأقدم إلى الأحدث</div>
              <div style={{ fontSize: "0.78rem", color: "#475569", marginTop: 4 }}>{deliverPathHint}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {filterTable ? (
                <button
                  type="button"
                  className="waiter-pos__btn waiter-pos__btn--ghost"
                  disabled={busyKeys.has(`finish-table:${filterTable}`) || visible.length === 0}
                  onClick={() => void finishTableOrders(filterTable, visible.map((o) => o.id))}
                >
                  {busyKeys.has(`finish-table:${filterTable}`) ? "..." : `إنهاء طاولة ${filterTable}`}
                </button>
              ) : null}
              <button
                type="button"
                className="waiter-pos__btn waiter-pos__btn--primary"
                disabled={readyToSendCount <= 0}
                onClick={() => void sendAllReady()}
              >
                {readyToSendCount > 0 ? `ترحيل الجاهز (${readyToSendCount})` : "ترحيل الجاهز"}
              </button>
            </div>
          </div>
        ) : null}

        {mode === "specialist" ? (
          <div
            style={{
              marginBottom: 12,
              padding: "0.85rem 0.95rem",
              borderRadius: 14,
              background: "rgba(14,165,233,0.08)",
              border: "1px solid rgba(14,165,233,0.22)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: "0.95rem", color: "#0f172a", fontWeight: 700 }}>المسبحة التشغيلية</div>
            <button
              type="button"
              className="waiter-pos__btn waiter-pos__btn--primary"
              disabled={readyToSendCount <= 0}
              onClick={() => void sendAllReady()}
            >
              {readyToSendCount > 0 ? `إرسال كل الجاهز (${readyToSendCount})` : "إرسال كل الجاهز"}
            </button>
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: mode === "specialist" ? "repeat(auto-fill, minmax(220px, 1fr))" : "repeat(auto-fill, minmax(140px, 1fr))",
            gap: mode === "specialist" ? 10 : 6,
            marginBottom: 12,
          }}
        >
          {summaryRows.length === 0 ? (
            <div style={{ color: "var(--wp-muted)", fontSize: "0.9rem" }}>لا يوجد ملخص تجميعي حاليًا.</div>
          ) : (
            summaryRows.map((row) => {
              const st = summaryTileStyle(row.name, row.remainingQty);
              const target = findSummaryTarget(row.name);
              const undoTarget = findSummaryPreparedTarget(row.name);
              const summaryBusy = target ? busyKeys.has(`${target.orderId}:${target.lineId}:prepared-delta`) : false;
              const undoBusy = undoTarget ? busyKeys.has(`${undoTarget.orderId}:${undoTarget.lineId}:prepared-delta`) : false;
              const noRemaining = row.remainingQty <= SUMMARY_EPSILON;
              return (
                <div
                key={row.name}
                style={{
                  border: `2px solid ${st.border}`,
                  borderRadius: mode === "specialist" ? 14 : 4,
                  minHeight: mode === "specialist" ? 150 : 110,
                  padding: mode === "specialist" ? "12px 14px" : "8px 10px",
                  fontWeight: 700,
                  background: st.bg,
                  color: "#0f172a",
                  display: "grid",
                  gridTemplateRows: "1fr auto auto",
                  alignItems: "center",
                  position: "relative",
                }}
              >
                {st.high ? (
                  <div
                    title="ضغط عالي — يحتاج دعم/زيادة عمالة"
                    style={{ position: "absolute", top: 4, right: 6, color: "#dc2626", fontWeight: 900, fontSize: 12 }}
                  >
                    ضغط عالي
                  </div>
                ) : null}
                <div style={{ textAlign: "center", lineHeight: 1.2, fontSize: mode === "specialist" ? "1.08rem" : undefined }}>{row.name}</div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "end" }}>
                  <div>
                    <div style={{ fontSize: mode === "specialist" ? "1.6rem" : "1.1rem", fontWeight: 900, textAlign: "left" }}>
                      {Number(row.remainingQty).toFixed(Number.isInteger(row.remainingQty) ? 0 : 2)}
                    </div>
                    <div style={{ fontSize: mode === "specialist" ? "0.95rem" : "0.8rem", opacity: 0.85 }}>
                      تم {Number(row.preparedQty).toFixed(Number.isInteger(row.preparedQty) ? 0 : 2)} من{" "}
                      {Number(row.totalQty).toFixed(Number.isInteger(row.totalQty) ? 0 : 2)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="waiter-pos__btn waiter-pos__btn--ghost"
                      disabled={!undoTarget || row.preparedQty <= 0 || undoBusy}
                      style={{ whiteSpace: "nowrap", padding: mode === "specialist" ? "0.65rem 0.85rem" : "0.35rem 0.6rem", fontSize: mode === "specialist" ? "0.95rem" : undefined }}
                      onClick={() => {
                        const nextTarget = findSummaryPreparedTarget(row.name);
                        if (!nextTarget) return;
                        void adjustPreparedQty(nextTarget.orderId, nextTarget.lineId, -1);
                      }}
                    >
                      {undoBusy ? "..." : "-1 رجوع"}
                    </button>
                    <button
                      type="button"
                      className={mode === "specialist" ? "waiter-pos__btn waiter-pos__btn--primary" : "waiter-pos__btn waiter-pos__btn--ghost"}
                      disabled={!target || noRemaining || summaryBusy}
                      style={{ whiteSpace: "nowrap", padding: mode === "specialist" ? "0.65rem 1rem" : "0.35rem 0.6rem", fontSize: mode === "specialist" ? "1rem" : undefined }}
                      onClick={() => {
                        const nextTarget = findSummaryTarget(row.name);
                        if (!nextTarget) return;
                        void adjustPreparedQty(nextTarget.orderId, nextTarget.lineId, 1);
                      }}
                    >
                      {summaryBusy ? "..." : "+1 جاهز"}
                    </button>
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>

        {mode === "specialist" ? (
          <div
            style={{
              marginBottom: 12,
              padding: "0.8rem 0.9rem",
              borderRadius: 12,
              background: "rgba(148,163,184,0.12)",
              color: "#334155",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: "0.92rem" }}>التفاصيل</div>
            <button
              type="button"
              className="waiter-pos__btn waiter-pos__btn--ghost"
              onClick={() => setShowSpecialistDetails((v) => !v)}
            >
              {showSpecialistDetails ? "إخفاء التفاصيل" : "إظهار التفاصيل"}
            </button>
          </div>
        ) : null}

        <div
          className="kds-layout"
          style={mode === "specialist" && !showSpecialistDetails ? { gridTemplateColumns: "1fr" } : undefined}
        >
          <div>
            {mode === "specialist" && !showSpecialistDetails ? (
              <div style={{ color: "var(--wp-muted)", padding: "1.2rem", textAlign: "center", background: "var(--wp-card)", borderRadius: 16 }}>التفاصيل مخفية</div>
            ) : visible.length === 0 ? (
              <div style={{ color: "var(--wp-muted)", padding: "2rem", textAlign: "center", background: "var(--wp-card)", borderRadius: 16 }}>
                {mode === "specialist" && !activeSpecialistChef
                  ? String(user?.specialistStationCode || "").trim()
                    ? "المحطة غير مرتبطة"
                    : "لا توجد محطة للمستخدم"
                  : mode === "specialist" && String(ops.kitchenExecutionMode || "").trim().toLowerCase() !== "specialist_chefs"
                    ? "الوضع غير مفعّل"
                    : `لا توجد طلبات قيد الطبخ${filterTable ? ` للطاولة ${filterTable}` : ""}.`}
              </div>
            ) : (
              <div className="kds-cards">
                {visible.map((o) => (
                  <KdsOrderCard
                    key={o.id}
                    order={o}
                    settings={settings}
                    base={base}
                    alertType={alertType}
                    alertTitlePrefix={alertTitlePrefix}
                    mode={mode}
                    insight={orderInsightById.get(o.id) || computeManagerOrderInsight(o, settings, nowTs)}
                  />
                ))}
              </div>
            )}
            {msg && <p className="waiter-pos__msg">{msg}</p>}
            <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ marginTop: 12 }} onClick={() => void loadAll()}>
              تحديث الآن
            </button>
          </div>

          <aside className="kds-sidebar" style={mode === "specialist" && !showSpecialistDetails ? { display: "none" } : undefined}>
            <div className="kds-sidebar__title">طلبات حسب الطاولة</div>
            <button
              type="button"
              className={`kds-sidebar__row ${filterTable === null ? "kds-sidebar__row--active" : ""}`}
              onClick={() => setFilterTable(null)}
            >
              كل الطلبات المعروضة
              <span className="kds-sidebar__pct" style={{ float: "left" }}>
                {filteredPending.length}
              </span>
            </button>
            {byTable.map((row) => {
              const tone =
                row.riskLabel === "متأخرة"
                  ? riskTone("overdue")
                  : row.riskLabel === "معرّضة"
                    ? riskTone("at_risk")
                    : row.activeExecutions > 0
                      ? riskTone("active")
                      : riskTone("normal");
              const finishKey = `finish-table:${row.tableId}`;
              const finishBusy = busyKeys.has(finishKey);
              return (
                <div
                  key={row.tableId}
                  className={`kds-sidebar__row ${filterTable === row.tableId ? "kds-sidebar__row--active" : ""}`}
                  style={{ borderInlineStart: `4px solid ${tone.border}` }}
                >
                  <button
                    type="button"
                    onClick={() => setFilterTable(row.tableId)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "block",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    طاولة {row.tableId}
                    <div style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--wp-muted)" }}>
                      {row.orders.length} طلب · {row.riskLabel} · {row.completionEtaLabel}
                      <span className="kds-sidebar__pct" style={{ float: "left" }}>
                        {row.completionPct}%
                      </span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: "0.77rem", color: tone.fg }}>
                      بنود مفتوحة: {Number(row.openQty).toFixed(Number.isInteger(row.openQty) ? 0 : 2)}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="waiter-pos__btn waiter-pos__btn--ghost"
                    style={{ marginTop: 8, width: "100%", fontSize: "0.8rem", padding: "0.35rem 0.5rem" }}
                    disabled={finishBusy || row.openQty <= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      void finishTableOrders(
                        row.tableId,
                        row.orders.map((o) => o.id),
                      );
                    }}
                  >
                    {finishBusy ? "..." : "إنهاء الطاولة"}
                  </button>
                </div>
              );
            })}
          </aside>
        </div>
      </div>
    </div>
  );
}
