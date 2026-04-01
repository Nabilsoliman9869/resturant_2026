import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { playKitchenWarnBeep } from "../lib/kdsBeep";
import "../styles/operationalRoles.css";

type OrderItem = { name?: string; quantity?: number };
type OrderRow = {
  id: string;
  tableId: string;
  status: string;
  items: OrderItem[];
  prepStartTime?: string;
  prepTargetMinutes?: number;
};

type KdsSettings = { prepTargetMinutes: number; warnBeforeEndMinutes: number };

function orderLabel(o: OrderRow) {
  const parts = (o.items || []).map((i) => `${i.name || "صنف"} ×${i.quantity || 1}`);
  return parts.length ? parts.join(" · ") : "بدون بنود";
}

function statusWeight(s: string) {
  const x = (s || "").toLowerCase();
  if (x === "ready") return 1;
  if (x === "preparing") return 0.55;
  if (x === "pending") return 0.2;
  return 0;
}

function tableCompletion(orders: OrderRow[]) {
  if (!orders.length) return 0;
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
  onStart,
  onFinish,
}: {
  order: OrderRow;
  settings: KdsSettings;
  onStart: (id: string) => void;
  onFinish: (id: string) => void;
}) {
  const target = Number(order.prepTargetMinutes) > 0 ? Number(order.prepTargetMinutes) : settings.prepTargetMinutes;
  const warn = settings.warnBeforeEndMinutes;
  const preparing = (order.status || "").toLowerCase() === "preparing";
  const { urgent, overdue, label } = usePrepCountdown(preparing ? order.prepStartTime : undefined, target, warn);

  useEffect(() => {
    if (!urgent && !overdue) return;
    playKitchenWarnBeep();
    const id = window.setInterval(() => playKitchenWarnBeep(), 45000);
    return () => window.clearInterval(id);
  }, [urgent, overdue]);

  const pending = (order.status || "").toLowerCase() === "pending";

  return (
    <div className={`kds-card ${urgent || overdue ? "kds-card--urgent" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: "1.02rem" }}>طلب {order.id.slice(0, 8)}</div>
          <div style={{ color: "var(--wp-muted)", fontSize: "0.88rem", marginTop: 4 }}>
            طاولة: <strong>{order.tableId || "—"}</strong> · الحالة: {order.status}
          </div>
          <div style={{ marginTop: 8, fontSize: "0.9rem", lineHeight: 1.45 }}>{orderLabel(order)}</div>
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
      <div className="kds-card__actions">
        {pending && (
          <button type="button" className="waiter-pos__btn waiter-pos__btn--primary" onClick={() => onStart(order.id)}>
            بدء التحضير
          </button>
        )}
        {preparing && (
          <button type="button" className="waiter-pos__btn waiter-pos__btn--primary" onClick={() => onFinish(order.id)}>
            انتهاء — جاهز للتسليم
          </button>
        )}
      </div>
    </div>
  );
}

export default function KitchenPage() {
  const base = getApiBase();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [settings, setSettings] = useState<KdsSettings>({ prepTargetMinutes: 20, warnBeforeEndMinutes: 5 });
  const [msg, setMsg] = useState("");
  const [filterTable, setFilterTable] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setMsg("");
    try {
      const [or, ks] = await Promise.all([
        fetch(`${base}/api/restaurant/orders`),
        fetch(`${base}/api/restaurant/kds-settings`),
      ]);
      const oj = await or.json();
      const kj = await ks.json();
      setOrders(Array.isArray(oj.orders) ? oj.orders : []);
      setSettings({
        prepTargetMinutes: Number(kj.prepTargetMinutes) || 20,
        warnBeforeEndMinutes: Number(kj.warnBeforeEndMinutes) || 5,
      });
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }, [base]);

  useEffect(() => {
    void loadAll();
    const id = window.setInterval(() => void loadAll(), 15000);
    return () => window.clearInterval(id);
  }, [loadAll]);

  async function setStatus(orderId: string, status: string) {
    try {
      const r = await fetch(`${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(await r.text());
      await loadAll();
    } catch (e) {
      setMsg(String(e));
    }
  }

  const pending = useMemo(
    () => orders.filter((o) => !["ready", "served", "paid"].includes((o.status || "").toLowerCase())),
    [orders],
  );

  const byTable = useMemo(() => {
    const m = new Map<string, OrderRow[]>();
    for (const o of pending) {
      const tid = String(o.tableId || "—");
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid)!.push(o);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b, "ar"));
  }, [pending]);

  const visible = useMemo(() => {
    if (!filterTable) return pending;
    return pending.filter((o) => String(o.tableId || "—") === filterTable);
  }, [pending, filterTable]);

  return (
    <div className="role-op waiter-pos">
      <OperationalRoleHeader
        roleTitle="المطبخ — KDS"
        hideBack
        rightSlot={
          <span style={{ fontSize: "0.85rem", color: "var(--wp-muted)" }}>
            كروت + عدّاد تنازلي + تنبيه قبل {settings.warnBeforeEndMinutes} د
          </span>
        }
      />

      <div className="role-op__main">
        <h2 className="role-op__section-title" style={{ marginBottom: "0.35rem" }}>
          شاشة التحضير
        </h2>
        <p style={{ color: "var(--wp-muted)", fontSize: "0.9rem", marginTop: 0, marginBottom: "1rem" }}>
          اضغط «بدء التحضير» لبدء العدّاد حتى زمن التنفيذ من الإعدادات. قبل انتهاء المدة بـ {settings.warnBeforeEndMinutes} دقائق: وميض
          وتنبيه صوتي متكرر. الشريط الجانبي يجمّع طلبات كل طاولة مع نسبة إكمال تقديرية.
        </p>

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
                    onStart={(id) => void setStatus(id, "preparing")}
                    onFinish={(id) => void setStatus(id, "ready")}
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
