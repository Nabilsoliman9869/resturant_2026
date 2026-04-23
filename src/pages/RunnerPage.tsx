import { useCallback, useEffect, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import "../styles/operationalRoles.css";

type OrderRow = {
  id: string;
  tableId: string;
  tableLabel?: string;
  status: string;
  items: Array<{ name?: string; quantity?: number }>;
};

export default function RunnerPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const [readyOrders, setReadyOrders] = useState<OrderRow[]>([]);
  const [msg, setMsg] = useState("");
  const [deliverBy, setDeliverBy] = useState<string>("server");
  const role = String(user?.role || "").toLowerCase();

  const load = useCallback(async () => {
    setMsg("");
    try {
      const q = await fetch(`${base}/api/restaurant/orders/delivery-queue?role=${encodeURIComponent(role || "server")}`);
      const j = await q.json().catch(() => ({}));
      const by = String((j as { expectedRole?: string; deliverFromKitchenBy?: string })?.expectedRole || "server").toLowerCase();
      setDeliverBy(String((j as { deliverFromKitchenBy?: string })?.deliverFromKitchenBy || by || "server").toLowerCase());
      setReadyOrders(Array.isArray((j as { orders?: unknown[] }).orders) ? ((j as { orders?: unknown[] }).orders as OrderRow[]) : []);
    } catch (e) {
      setMsg(`تعذر تحميل طلبات التسليم: ${String(e)}`);
    }
  }, [base, role]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 12000);
    return () => window.clearInterval(id);
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

        {deliverBy !== role ? (
          <div style={{ color: "var(--wp-muted)", padding: "0.8rem 1rem", background: "var(--wp-card)", borderRadius: 12, marginBottom: "1rem" }}>
            هذه الشاشة ليست دور الاستلام الحالي. الدور المحدد في المسار الآن: {deliverBy || "—"}.
          </div>
        ) : null}

        {deliverBy === role && readyOrders.length === 0 ? (
          <div style={{ color: "var(--wp-muted)", padding: "2rem", textAlign: "center", background: "var(--wp-card)", borderRadius: 16 }}>
            لا توجد طلبات جاهزة الآن.
          </div>
        ) : deliverBy === role ? (
          readyOrders.map((o, idx) => (
            <div
              key={o.id}
              className="role-op__order-card role-op__order-card--ready"
              style={idx > 0 ? { borderTop: "2px dashed rgba(148,163,184,0.55)", marginTop: "0.8rem", paddingTop: "0.8rem" } : undefined}
            >
              <div>
                <strong>طلب</strong> {o.id.slice(0, 8)} · <strong>طاولة</strong> {o.tableLabel || o.tableId || "—"}
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
        ) : null}

        {msg && <p className="waiter-pos__msg">{msg}</p>}
        <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ marginTop: 12 }} onClick={() => void load()}>
          تحديث
        </button>
      </div>
    </div>
  );
}
