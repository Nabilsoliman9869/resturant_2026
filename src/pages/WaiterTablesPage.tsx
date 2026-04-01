import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import "../styles/operationalRoles.css";

type RestTable = { id: string; name: string; seats?: number; status?: string; number?: number };

export default function WaiterTablesPage() {
  const base = getApiBase();
  const navigate = useNavigate();
  const [tables, setTables] = useState<RestTable[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${base}/api/restaurant/tables`);
        const j = await r.json();
        setTables(Array.isArray(j.tables) ? j.tables : []);
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
            const num = t.number != null ? `#${t.number}` : t.name;
            return (
              <button
                key={t.id}
                type="button"
                className="role-op__pick-card"
                onClick={() => navigate(`/app/waiter/order-taker?tableId=${encodeURIComponent(t.id)}`)}
              >
                <div className="role-op__pick-num">{num}</div>
                <div className="role-op__pick-sub">🪑 مقاعد {t.seats ?? "—"}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
