import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { buildSegmentedTablesFromFloorPlan, type SegmentedTableRow } from "../lib/restaurantTableView";
import "../styles/operationalRoles.css";

type RestTable = SegmentedTableRow;

export default function WaiterTablesPage() {
  const base = getApiBase();
  const navigate = useNavigate();
  const [tables, setTables] = useState<RestTable[]>([]);
  const [sessionByTable, setSessionByTable] = useState<Map<string, string>>(() => new Map());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [billReqIds, setBillReqIds] = useState<Set<string>>(() => new Set());
  const [msg, setMsg] = useState("");

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
        const jt = await rt.json();
        const js = await rs.json();
        const oj = await ro.json().catch(() => ({}));

        const apiTables: RestTable[] = Array.isArray(jt.tables) ? jt.tables : [];
        const planRaw = fpj?.plan;
        setTables(buildSegmentedTablesFromFloorPlan(planRaw, apiTables));
        const m = new Map<string, string>();
        const sessions = Array.isArray(js.sessions) ? js.sessions : [];
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
        const orders = Array.isArray(oj.orders) ? oj.orders : [];
        for (const o of orders) {
          const tid = String(o?.tableId || "");
          const st = String(o?.status || "").toLowerCase();
          if (tid && ["pending", "preparing"].includes(st)) busy.add(tid);
        }
        setBusyIds(busy);
        setBillReqIds(billreq);
      } catch (e) {
        setMsg(String(e));
      }
    })();
  }, [base]);

  return (
    <div className="role-op waiter-pos">
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
            const isBusy = busyIds.has(String(t.id));
            const billReq = billReqIds.has(String(t.id));
            return (
              <button
                key={t.id}
                type="button"
                className="role-op__pick-card"
                style={{
                  border: isBusy ? "2px solid #ef4444" : "2px solid #22c55e",
                  boxShadow: billReq ? "0 0 0 3px rgba(59,130,246,0.35)" : undefined,
                }}
                onClick={() => {
                  const sid = sessionByTable.get(String(t.id));
                  const q =
                    `tableId=${encodeURIComponent(t.id)}` +
                    (sid ? `&sessionId=${encodeURIComponent(sid)}` : "");
                  navigate(`/app/waiter/order-taker?${q}`);
                }}
              >
                <div className="role-op__pick-num">{num}</div>
                <div className="role-op__pick-sub">🪑 مقاعد {t.seats ?? "—"}</div>
                <div style={{ marginTop: 8, fontSize: "0.82rem", color: isBusy ? "#b91c1c" : "#166534" }}>
                  {isBusy ? "مشغولة" : "متاحة"}
                  {billReq ? " · طلب حساب" : ""}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
