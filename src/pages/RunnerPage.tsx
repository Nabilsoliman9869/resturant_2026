import { useCallback, useEffect, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import "../styles/operationalRoles.css";

type OrderRow = {
  id: string;
  tableId: string;
  status: string;
  items: Array<{ name?: string; quantity?: number }>;
};

export default function RunnerPage() {
  const base = getApiBase();
  const [readyOrders, setReadyOrders] = useState<OrderRow[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/orders?status=ready`);
      const j = await r.json();
      setReadyOrders(Array.isArray(j.orders) ? j.orders : []);
    } catch (e) {
      setMsg(`تعذر تحميل طلبات التسليم: ${String(e)}`);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deliver(orderId: string) {
    try {
      const r = await fetch(`${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "served" }),
      });
      if (!r.ok) throw new Error(await r.text());
      await load();
      setMsg("تم تسليم الطلب للطاولة.");
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div className="role-op waiter-pos">
      <OperationalRoleHeader
        roleTitle="جارسون المناولة"
        hideBack
        rightSlot={<span style={{ fontSize: "0.85rem", color: "var(--wp-muted)" }}>توصيل للطاولة</span>}
      />

      <div className="role-op__main">
        <h2 className="role-op__section-title">طلبات جاهزة للتسليم</h2>
        <p style={{ color: "var(--wp-muted)", fontSize: "0.9rem", marginTop: "-0.5rem", marginBottom: "1rem" }}>
          طلبات حالتها «جاهز» من المطبخ — اضغط بعد التوصيل الفعلي للطاولة.
        </p>

        {readyOrders.length === 0 ? (
          <div style={{ color: "var(--wp-muted)", padding: "2rem", textAlign: "center", background: "var(--wp-card)", borderRadius: 16 }}>
            لا توجد طلبات جاهزة الآن.
          </div>
        ) : (
          readyOrders.map((o) => (
            <div key={o.id} className="role-op__order-card role-op__order-card--ready">
              <div>
                <strong>طلب</strong> {o.id.slice(0, 8)} · <strong>طاولة</strong> {o.tableId || "—"}
                <div className="role-op__order-meta">
                  {(o.items || []).map((i) => `${i.name || "صنف"} ×${i.quantity || 1}`).join(" · ") || "بدون بنود"}
                </div>
              </div>
              <div className="role-op__order-actions">
                <button type="button" className="waiter-pos__btn waiter-pos__btn--primary" onClick={() => void deliver(o.id)}>
                  تم التسليم للطاولة
                </button>
              </div>
            </div>
          ))
        )}

        {msg && <p className="waiter-pos__msg">{msg}</p>}
        <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ marginTop: 12 }} onClick={() => void load()}>
          تحديث
        </button>
      </div>
    </div>
  );
}
