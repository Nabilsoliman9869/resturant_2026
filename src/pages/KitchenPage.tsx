import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { playKitchenWarnBeep } from "../lib/kdsBeep";
import "../styles/operationalRoles.css";

type OrderItem = {
  lineId?: string;
  name?: string;
  quantity?: number;
  prepared?: boolean;
  sent?: boolean;
  handoffAt?: string | null;
  lineStatus?: string;
  cancelled?: boolean;
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
};

type KdsSettings = { prepTargetMinutes: number; warnBeforeEndMinutes: number };

function orderLabel(o: OrderRow) {
  const parts = (o.items || []).map((i) => `${i.name || "صنف"} ×${i.quantity || 1}`);
  return parts.length ? parts.join(" · ") : "بدون بنود";
}

function lineRemainingForSummary(i: OrderItem): number {
  if (i.sent || i.handoffAt || String(i.lineStatus || "").toLowerCase() === "ready" || i.prepared) return 0;
  return Number(i.quantity || 0);
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

function replaceOrderById(prev: OrderRow[], nextOrder: OrderRow): OrderRow[] {
  const idx = prev.findIndex((o) => o.id === nextOrder.id);
  if (idx === -1) return [nextOrder, ...prev];
  const copy = [...prev];
  copy[idx] = nextOrder;
  return copy;
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
  busyKeys,
  onTogglePrepared,
  onSendLine,
  onStartPreparing,
  base,
  alertType,
  alertTitlePrefix,
}: {
  order: OrderRow;
  settings: KdsSettings;
  busyKeys: Set<string>;
  onTogglePrepared: (orderId: string, lineId: string, prepared: boolean) => void;
  onSendLine: (orderId: string, lineId: string) => void;
  onStartPreparing: (orderId: string) => void;
  base: string;
  alertType: string;
  alertTitlePrefix: string;
}) {
  const target = Number(order.prepTargetMinutes) > 0 ? Number(order.prepTargetMinutes) : settings.prepTargetMinutes;
  const warn = settings.warnBeforeEndMinutes;
  const preparing = (order.status || "").toLowerCase() === "preparing";
  const pending = (order.status || "").toLowerCase() === "pending";
  const { urgent, overdue, label } = usePrepCountdown(preparing ? order.prepStartTime : undefined, target, warn);
  const cashierNotifiedRef = useRef(false);

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
    <div className={`kds-card ${urgent || overdue ? "kds-card--urgent" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: "1.02rem" }} title={`معرّف النظام: ${order.id}`}>
            {kdsOrderDisplayTitle(order)}
            {order.generalOrder ? (
              <span style={{ marginRight: 8, fontSize: "0.75rem", color: "var(--wp-accent, #38bdf8)" }}>· طلب عام</span>
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
          <div style={{ color: "var(--wp-muted)", fontSize: "0.88rem", marginTop: 4 }}>
            طاولة: <strong>{kitchenTableDisplay(order)}</strong> · الحالة: {order.status}
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="waiter-pos__btn waiter-pos__btn--primary"
              disabled={!pending || busyKeys.has(`${order.id}:status`)}
              onClick={() => onStartPreparing(order.id)}
            >
              {preparing ? "التحضير جارٍ" : pending ? "بدء التحضير" : "تم بدء التحضير"}
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: "0.9rem", lineHeight: 1.45 }}>{orderLabel(order)}</div>
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {(order.items || []).map((it, idx) => {
              const lid = String(it.lineId || `${order.id}-${idx}`);
              const prepared = Boolean(it.prepared);
              const handedOff = Boolean(it.sent || it.handoffAt || String(it.lineStatus || "").toLowerCase() === "sent" || String(it.lineStatus || "").toLowerCase() === "ready");
              const lineBusy = busyKeys.has(`${order.id}:${lid}`);
              return (
                <div
                  key={lid}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "6px 8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    opacity: handedOff ? 0.55 : 1,
                  }}
                >
                  <div>{it.name || "صنف"} ×{it.quantity || 1}</div>
                  <button
                    type="button"
                    className="waiter-pos__btn waiter-pos__btn--ghost"
                    disabled={!preparing || prepared || handedOff || lineBusy}
                    onClick={() => onTogglePrepared(order.id, lid, true)}
                  >
                    {prepared || handedOff ? "تم الانتهاء" : "تم الانتهاء"}
                  </button>
                  <button
                    type="button"
                    className="waiter-pos__btn waiter-pos__btn--ghost"
                    disabled={!prepared || handedOff || lineBusy}
                    onClick={() => onSendLine(order.id, lid)}
                  >
                    {handedOff ? "مرسل" : "إرسال"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: "0.82rem", color: "var(--wp-muted)" }}>
        زمن التنفيذ المستهدف: {target} د · تنبيه قبل النهاية بـ {warn} د
      </div>
      {preparing && (
        <div className={`kds-timer ${urgent || overdue ? "kds-timer--warn" : ""}`}>
          {overdue ? <>تأخير عن الموعد: {label}</> : <>متبقٍ للموعد: {label}</>}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--wp-muted)" }}>
        KPI · من الاستقبال حتى آخر تنفيذ: <strong>{leadLabel}</strong>
      </div>
    </div>
  );
}

export type KitchenPageMode = "kitchen" | "speed";

export default function KitchenPage({ mode = "kitchen" }: { mode?: KitchenPageMode }) {
  const base = getApiBase();
  const kdsQ = mode === "speed" ? "kdsStation=speed" : "kdsStation=kitchen";
  const alertType = mode === "speed" ? "speed_order_urgent" : "kitchen_urgent";
  const alertTitlePrefix = mode === "speed" ? "استعجال طلبات سريعة" : "استعجال مطبخ";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [settings, setSettings] = useState<KdsSettings>({ prepTargetMinutes: 20, warnBeforeEndMinutes: 5 });
  const [msg, setMsg] = useState("");
  const [filterTable, setFilterTable] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());

  const loadAll = useCallback(async () => {
    setMsg("");
    try {
      const [or, ks] = await Promise.all([
        fetch(`${base}/api/restaurant/orders?${kdsQ}`),
        fetch(`${base}/api/restaurant/kds-settings`),
      ]);
      const oj = tryParseJson<{ orders?: OrderRow[] }>(await or.text()) ?? {};
      const kj = tryParseJson<{ prepTargetMinutes?: number; warnBeforeEndMinutes?: number }>(await ks.text()) ?? {};
      setOrders(Array.isArray(oj.orders) ? oj.orders : []);
      setSettings({
        prepTargetMinutes: Number(kj.prepTargetMinutes) || 20,
        warnBeforeEndMinutes: Number(kj.warnBeforeEndMinutes) || 5,
      });
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }, [base, kdsQ]);

  useEffect(() => {
    void loadAll();
    const id = window.setInterval(() => void loadAll(), 15000);
    return () => window.clearInterval(id);
  }, [loadAll]);

  async function togglePrepared(orderId: string, lineId: string, prepared: boolean) {
    const key = `${orderId}:${lineId}`;
    setMsg("");
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      const r = await fetch(`${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(lineId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prepared }),
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

  async function startPreparing(orderId: string) {
    const key = `${orderId}:status`;
    setMsg("");
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      const r = await fetch(`${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "preparing" }),
      });
      const txt = await r.text();
      if (!r.ok) throw new Error(txt);
      const j = tryParseJson<OrderRow>(txt);
      if (j && typeof j.id === "string") {
        setOrders((prev) => replaceOrderById(prev, j));
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
        (o) => isKitchenShiftWindow(o.createdAt) && !["served", "paid", "cancelled"].includes((o.status || "").toLowerCase()),
      ),
    [orders],
  );

  const byTable = useMemo(() => {
    const m = new Map<string, OrderRow[]>();
    for (const o of pending) {
      const tid = kitchenTableDisplay(o);
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid)!.push(o);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b, "ar"));
  }, [pending]);

  const visible = useMemo(() => {
    if (!filterTable) return pending;
    return pending.filter((o) => kitchenTableDisplay(o) === filterTable);
  }, [pending, filterTable]);

  const summaryRows = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of pending) {
      for (const it of o.items || []) {
        const nm = normalizeSummaryItemName(String(it.name || "صنف"));
        const q = lineRemainingForSummary(it);
        if (q <= 0) continue;
        m.set(nm, (m.get(nm) || 0) + q);
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [pending]);

  return (
    <div className="role-op waiter-pos">
      <OperationalRoleHeader
        roleTitle={mode === "speed" ? "الطلبات السريعة — KDS" : "المطبخ — KDS"}
        hideBack
        rightSlot={
          <span style={{ fontSize: "0.85rem", color: "var(--wp-muted)" }}>
            كروت + عدّاد تنازلي + تنبيه قبل {settings.warnBeforeEndMinutes} د
          </span>
        }
      />

      <div className="role-op__main">
        <h2 className="role-op__section-title" style={{ marginBottom: "0.35rem" }}>
          {mode === "speed" ? "تجهيز (شيشة / مشروبات / غير طبخ)" : "شاشة التحضير"}
        </h2>
        <p style={{ color: "var(--wp-muted)", fontSize: "0.9rem", marginTop: 0, marginBottom: "1rem" }}>
          {mode === "speed" ? (
            <>
              تظهر هنا فقط الأصناف المربوطة بمجموعة القائمة «شيشة وطلبات سريعة» (TBL006). الباقي يبقى في شاشة المطبخ.
            </>
          ) : (
            <>
              اضغط «بدء التحضير» لبدء العدّاد حتى زمن التنفيذ من الإعدادات. قبل انتهاء المدة بـ {settings.warnBeforeEndMinutes} دقائق: وميض
              وتنبيه صوتي متكرر. الشريط الجانبي يجمّع طلبات كل طاولة مع نسبة إكمال تقديرية.
            </>
          )}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6, marginBottom: 12 }}>
          {summaryRows.length === 0 ? (
            <div style={{ color: "var(--wp-muted)", fontSize: "0.9rem" }}>لا يوجد ملخص تجميعي حاليًا.</div>
          ) : (
            summaryRows.map(([name, qty]) => {
              const st = summaryTileStyle(name, qty);
              return (
                <div
                key={name}
                style={{
                  border: `2px solid ${st.border}`,
                  borderRadius: 4,
                  minHeight: 74,
                  padding: "8px 10px",
                  fontWeight: 700,
                  background: st.bg,
                  color: "#0f172a",
                  display: "grid",
                  gridTemplateRows: "1fr auto",
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
                <div style={{ textAlign: "center", lineHeight: 1.2 }}>{name}</div>
                <div style={{ textAlign: "left", fontSize: "1.1rem", fontWeight: 900 }}>
                  {Number(qty).toFixed(Number.isInteger(qty) ? 0 : 2)}
                </div>
              </div>
              );
            })
          )}
        </div>

        <div className="kds-layout">
          <div>
            {visible.length === 0 ? (
              <div style={{ color: "var(--wp-muted)", padding: "2rem", textAlign: "center", background: "var(--wp-card)", borderRadius: 16 }}>
                لا توجد طلبات {filterTable ? `للطاولة ${filterTable}` : ""}.
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
                    busyKeys={busyKeys}
                    onTogglePrepared={(oid, lid, prepared) => void togglePrepared(oid, lid, prepared)}
                    onSendLine={(oid, lid) => void sendLine(oid, lid)}
                    onStartPreparing={(oid) => void startPreparing(oid)}
                  />
                ))}
              </div>
            )}
            {msg && <p className="waiter-pos__msg">{msg}</p>}
            <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ marginTop: 12 }} onClick={() => void loadAll()}>
              تحديث الآن
            </button>
          </div>

          <aside className="kds-sidebar">
            <div className="kds-sidebar__title">طلبات حسب الطاولة</div>
            <button
              type="button"
              className={`kds-sidebar__row ${filterTable === null ? "kds-sidebar__row--active" : ""}`}
              onClick={() => setFilterTable(null)}
            >
              كل الطلبات المعروضة
              <span className="kds-sidebar__pct" style={{ float: "left" }}>
                {pending.length}
              </span>
            </button>
            {byTable.map(([tid, list]) => {
              const pct = tableCompletion(list);
              return (
                <button
                  key={tid}
                  type="button"
                  className={`kds-sidebar__row ${filterTable === tid ? "kds-sidebar__row--active" : ""}`}
                  onClick={() => setFilterTable(tid)}
                >
                  طاولة {tid}
                  <div style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--wp-muted)" }}>
                    {list.length} طلب · إكمال تقديري{" "}
                    <span className="kds-sidebar__pct" style={{ float: "left" }}>
                      {pct}%
                    </span>
                  </div>
                </button>
              );
            })}
          </aside>
        </div>
      </div>
    </div>
  );
}
