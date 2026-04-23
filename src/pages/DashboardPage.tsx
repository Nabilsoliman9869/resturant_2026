import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import FloorPlanLive from "../components/FloorPlanLive";
import { CashierTableStripBoard } from "../components/CashierTableStripBoard";
import { getApiBase } from "../lib/apiBase";

type Stats = {
  activeSessions: number;
  openKitchenOrders: number;
  awaitingCashierInvoices: number;
  tablesInCatalog: number;
};

export default function DashboardPage() {
  const { user } = useAuth();
  const role = user?.role;
  const shouldShowLiveFloor = role === "cashier" || role === "waiter" || role === "server" || role === "host" || role === "manager" || role === "developer";

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const r = await fetch(`${getApiBase()}/api/restaurant/dashboard-stats`);
        const t = await r.text();
        if (!r.ok) throw new Error(t);
        const j = JSON.parse(t) as Stats;
        if (!cancel) {
          setStats(j);
          setStatsErr(null);
        }
      } catch (e) {
        if (!cancel) {
          setStats(null);
          setStatsErr(String(e));
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.85rem" }}>
        لوحة الأداء
      </h1>

      <div className="grid-2" style={{ marginBottom: "1rem" }}>
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3 style={{ marginTop: 0 }}>ملخص التشغيل (من الخادم)</h3>
          {statsErr ? (
            <p style={{ color: "var(--danger)" }}>{statsErr}</p>
          ) : stats ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "0.75rem",
              }}
            >
              <StatTile label="جلسات نشطة" value={stats.activeSessions} />
              <StatTile label="طلبات مطبخ مفتوحة" value={stats.openKitchenOrders} />
              <StatTile label="فواتير بانتظار التسديد" value={stats.awaitingCashierInvoices} />
              <StatTile label="طاولات في الكتالوج (TBL005)" value={stats.tablesInCatalog} />
            </div>
          ) : (
            <p style={{ color: "var(--muted)" }}>جاري التحميل…</p>
          )}
        </div>
      </div>

      {shouldShowLiveFloor && (
        <>
          {role === "cashier" && <CashierTableStripBoard />}
          <FloorPlanLive />
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "0.75rem 1rem",
        background: "rgba(0,0,0,0.2)",
      }}
    >
      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, fontFamily: "var(--display)" }}>{value}</div>
    </div>
  );
}
