import { useEffect, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { buildSegmentedTablesFromFloorPlan, type SegmentedTableRow } from "../lib/restaurantTableView";
import "../styles/operationalRoles.css";

type RestTable = SegmentedTableRow;

export default function ServerTablesPage() {
  const base = getApiBase();
  const [tables, setTables] = useState<RestTable[]>([]);
  const [msg, setMsg] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [billReqIds, setBillReqIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void (async () => {
      try {
        const [fp, rt, rs, ro] = await Promise.all([
          fetch(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
          fetch(`${base}/api/restaurant/tables`),
          fetch(`${base}/api/restaurant/table-sessions?status=active`),
          fetch(`${base}/api/restaurant/orders`),
        ]);
        const fpj = await fp.json().catch(() => ({}));
        const tj = await rt.json();
        const sj = await rs.json().catch(() => ({}));
        const oj = await ro.json().catch(() => ({}));
        const apiTables: RestTable[] = Array.isArray(tj.tables) ? tj.tables : [];
        const planRaw = fpj?.plan;
        setTables(buildSegmentedTablesFromFloorPlan(planRaw, apiTables));

        const sessions = Array.isArray(sj.sessions) ? sj.sessions : [];
        const busy = new Set<string>();
        const bill = new Set<string>();
        for (const s of sessions) {
          const tid = String(s?.tableId || "");
          if (!tid) continue;
          if (String(s?.status || "").toLowerCase() === "active") busy.add(tid);
          if (s?.billingRequestedAt) bill.add(tid);
        }
        const orders = Array.isArray(oj.orders) ? oj.orders : [];
        for (const o of orders) {
          const tid = String(o?.tableId || "");
          const st = String(o?.status || "").toLowerCase();
          if (tid && ["pending", "preparing"].includes(st)) busy.add(tid);
        }
        setBusyIds(busy);
        setBillReqIds(bill);
      } catch (e) {
        setMsg(String(e));
      }
    })();
  }, [base]);

  return (
    <div className="role-op waiter-pos">
      <OperationalRoleHeader roleTitle="جارسون المناولة" hideBack />

      <div className="role-op__main">
        <h2 className="role-op__section-title">حالة الطاولات</h2>
        <p style={{ color: "var(--wp-muted)", fontSize: "0.9rem", marginTop: "-0.5rem", marginBottom: "1rem" }}>
          عرض فقط — للتوجيه أثناء التوصيل.
        </p>
        {msg && <p className="waiter-pos__msg">{msg}</p>}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: "1rem",
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
            const isBusy = busyIds.has(String(t.id));
            const billReq = billReqIds.has(String(t.id));
            return (
              <div
                key={t.id}
                className="role-op__pick-card"
                style={{
                  cursor: "default",
                  boxShadow: billReq ? "0 0 0 3px rgba(59,130,246,0.35)" : "none",
                  border: isBusy ? "2px solid #ef4444" : "2px solid #22c55e",
                }}
              >
                <div className="role-op__pick-num">{num}</div>
                <div className="role-op__pick-sub">🪑 مقاعد {t.seats ?? "—"}</div>
                <div style={{ marginTop: 8, fontSize: "0.85rem", color: isBusy ? "#b91c1c" : "#166534" }}>
                  {isBusy ? "مشغولة" : "متاحة"}
                  {billReq ? " · طلب حساب" : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
