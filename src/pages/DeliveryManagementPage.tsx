import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";

type DeliveryOrder = {
  id: string;
  ticketNo?: number;
  tableId?: string;
  status?: string;
  createdAt?: string;
  items?: Array<{ name?: string; quantity?: number; lineStatus?: string; prepared?: boolean; sent?: boolean }>;
};

function orderTitle(o: DeliveryOrder): string {
  if (typeof o.ticketNo === "number" && Number.isFinite(o.ticketNo)) return `تذكرة #${o.ticketNo}`;
  return `طلب ${String(o.id || "").slice(0, 8)}`;
}

export default function DeliveryManagementPage() {
  const base = getApiBase();
  const [rows, setRows] = useState<DeliveryOrder[]>([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/orders/delivery-queue?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const t = await r.text();
      const j = tryParseJson<{ orders?: DeliveryOrder[]; detail?: string }>(t) ?? {};
      if (!r.ok) throw new Error(j.detail || t || `HTTP ${r.status}`);
      setRows(Array.isArray(j.orders) ? j.orders : []);
    } catch (e) {
      setMsg(`تعذر تحميل طابور الدليفري: ${String(e)}`);
    }
  }, [base]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [load]);

  const view = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((o) => {
      const t = orderTitle(o).toLowerCase();
      const st = String(o.status || "").toLowerCase();
      const table = String(o.tableId || "").toLowerCase();
      return t.includes(qq) || st.includes(qq) || table.includes(qq);
    });
  }, [rows, q]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>إدارة الدليفري</h2>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        متابعة الطلبات الجاهزة للتسليم من المطبخ (delivery queue) لسهولة إدارة الشحن.
      </p>
      <div className="card" style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث: تذكرة/حالة/طاولة..." style={{ minWidth: 220 }} />
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          تحديث
        </button>
        <span style={{ color: "var(--muted)" }}>عدد الطلبات: {view.length}</span>
      </div>
      <div className="card">
        {view.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>لا توجد طلبات دليفري جاهزة للتسليم حالياً.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {view.map((o) => (
              <div key={o.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontWeight: 800 }}>{orderTitle(o)}</div>
                <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 2 }}>
                  حالة: {String(o.status || "pending")} · مرجع: {String(o.tableId || "delivery")}
                </div>
                <div style={{ marginTop: 6, fontSize: "0.9rem" }}>
                  {(o.items || []).slice(0, 4).map((it, idx) => (
                    <div key={`${o.id}-${idx}`}>
                      {String(it.name || "صنف")} ×{Number(it.quantity || 1)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {msg ? <p style={{ color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}

