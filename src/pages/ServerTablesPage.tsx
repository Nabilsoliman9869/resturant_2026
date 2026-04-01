import { useEffect, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import "../styles/operationalRoles.css";

type RestTable = { id: string; name: string; seats?: number; status?: string; number?: number };

export default function ServerTablesPage() {
  const base = getApiBase();
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

  function labelStatus(s?: string) {
    const x = (s || "").toLowerCase();
    if (x.includes("occupy")) return "مشغولة";
    if (x.includes("reserv")) return "محجوزة";
    return "متاحة";
  }

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
            const num = t.number != null ? `#${t.number}` : t.name;
            return (
              <div
                key={t.id}
                className="role-op__pick-card"
                style={{ cursor: "default", boxShadow: "none" }}
              >
                <div className="role-op__pick-num">{num}</div>
                <div className="role-op__pick-sub">🪑 مقاعد {t.seats ?? "—"}</div>
                <div style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--wp-muted)" }}>{labelStatus(t.status)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
