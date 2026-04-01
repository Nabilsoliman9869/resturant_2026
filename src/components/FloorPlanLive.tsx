import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { normalizeFloorPlanDocument } from "../lib/floorPlanDocument";
import { type FloorPlan, type FloorTable, type TableLiveMap, type TableLiveStatus } from "../lib/floorPlanModel";
import { FloorPlanSvgView } from "./FloorPlanSvgView";

type TableRec = {
  id: string;
  name?: string;
  number?: number;
  status?: string;
  position?: { x?: number; y?: number };
  seats?: number;
};

type SessionRec = { id: string; tableId?: string; status?: string };
type OrderRec = { id: string; tableId?: string; status?: string };

function tableLabel(t: TableRec) {
  return (t.name || "").trim() || `طاولة ${t.number ?? t.id.slice(0, 6)}`;
}

function orderStatusWeight(s: string) {
  const x = (s || "").toLowerCase();
  if (x === "ready") return 1;
  if (x === "preparing") return 0.55;
  if (x === "pending") return 0.2;
  return 0;
}

function resolveApiTableId(ft: FloorTable): string {
  return String(ft.linkedTableId ?? ft.id);
}

function buildTableLiveMap(
  plan: FloorPlan,
  sessions: SessionRec[],
  orders: OrderRec[],
  apiTables: TableRec[],
  liveKeyPrefix?: string,
): TableLiveMap {
  const live: TableLiveMap = {};
  const keyPre = liveKeyPrefix ? `${liveKeyPrefix}::` : "";
  for (const ft of plan.tables) {
    const tid = resolveApiTableId(ft);
    const openOrders = orders.filter(
      (o) =>
        String(o.tableId) === tid &&
        !["ready", "served", "paid"].includes((o.status || "").toLowerCase()),
    );
    const hasSession = sessions.some(
      (s) => (s.status || "").toLowerCase() === "active" && String(s.tableId) === tid,
    );
    const apiT = apiTables.find((t) => String(t.id) === tid);

    let status: TableLiveStatus = "free";
    if (openOrders.length) {
      status = "occupied";
    } else if (hasSession) {
      status = "occupied";
    }
    if (apiT) {
      const st = (apiT.status || "").toLowerCase();
      if (st === "reserved") status = "reserved";
      if (st === "dirty") status = "dirty";
      if (st === "occupied") status = "occupied";
    }

    let progress: number | undefined;
    if (openOrders.length) {
      const sum = openOrders.reduce((a, o) => a + orderStatusWeight(o.status || ""), 0);
      progress = Math.min(100, Math.round((sum / openOrders.length) * 100));
    }

    live[`${keyPre}${ft.id}`] = { status, progress };
  }
  return live;
}

function mergeLiveMaps(maps: TableLiveMap[]): TableLiveMap {
  return Object.assign({}, ...maps);
}

/** عرض قديم عند عدم وجود floor_plan.json */
function LegacyTablesLayout({
  tables,
  busyIds,
}: {
  tables: TableRec[];
  busyIds: Set<string>;
}) {
  const layout = useMemo(() => {
    if (!tables.length) {
      return { items: [] as Array<TableRec & { lx: number; ly: number; lw: number; lh: number }>, W: 520, H: 360 };
    }
    let maxX = 120;
    let maxY = 120;
    const withPos = tables.map((t, i) => {
      const x = Number(t.position?.x);
      const y = Number(t.position?.y);
      const has = Number.isFinite(x) && Number.isFinite(y);
      const px = has ? x : 40 + (i % 5) * 110;
      const py = has ? y : 40 + Math.floor(i / 5) * 95;
      maxX = Math.max(maxX, px + 100);
      maxY = Math.max(maxY, py + 72);
      return { ...t, lx: px, ly: py, lw: 96, lh: 64 };
    });
    return { items: withPos, W: maxX + 40, H: maxY + 40 };
  }, [tables]);

  return (
    <div
      style={{
        position: "relative",
        width: layout.W,
        height: layout.H,
        margin: "0 auto",
        minWidth: "min(100%, 520px)",
      }}
    >
      {layout.items.map((t) => {
        const occ = busyIds.has(String(t.id));
        const st = (t.status || "available").toLowerCase();
        let bg = "#22c55e";
        let border = "#15803d";
        if (occ) {
          bg = "#f97316";
          border = "#c2410c";
        } else if (st === "dirty" || st === "occupied") {
          bg = "#94a3b8";
          border = "#64748b";
        }
        return (
          <div
            key={t.id}
            title={tableLabel(t)}
            style={{
              position: "absolute",
              left: t.lx,
              top: t.ly,
              width: t.lw,
              height: t.lh,
              borderRadius: 10,
              background: bg,
              border: `2px solid ${border}`,
              color: "#fff",
              fontSize: "0.72rem",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: 4,
              boxShadow: occ ? "0 0 0 2px rgba(251,191,36,0.5)" : undefined,
            }}
          >
            {tableLabel(t)}
          </div>
        );
      })}
    </div>
  );
}

export default function FloorPlanLive() {
  const base = getApiBase();
  const [floors, setFloors] = useState<FloorPlan[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const [tables, setTables] = useState<TableRec[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [live, setLive] = useState<TableLiveMap>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setMsg("");
    try {
      const [fpRes, tRes, sRes, oRes] = await Promise.all([
        fetch(`${base}/api/restaurant/floor-plan`),
        fetch(`${base}/api/restaurant/tables`),
        fetch(`${base}/api/restaurant/table-sessions`),
        fetch(`${base}/api/restaurant/orders`),
      ]);
      const fpj = await fpRes.json();
      const tj = await tRes.json();
      const sj = await sRes.json();
      const oj = await oRes.json();

      const rawPlan = fpj.plan;
      const norm = rawPlan != null ? normalizeFloorPlanDocument(rawPlan) : null;
      const flist = norm?.floors ?? [];
      setFloors(flist);
      setActiveFloorId((cur) => {
        if (!flist.length) return null;
        if (cur && flist.some((f) => f.id === cur)) return cur;
        return norm?.activeFloorId ?? flist[0].id;
      });

      const tl = Array.isArray(tj.tables) ? tj.tables : [];
      setTables(tl);
      const sessions: SessionRec[] = Array.isArray(sj.sessions) ? sj.sessions : [];
      const orders: OrderRec[] = Array.isArray(oj.orders) ? oj.orders : [];

      const busy = new Set<string>();
      for (const s of sessions) {
        if ((s.status || "").toLowerCase() === "active" && s.tableId) busy.add(String(s.tableId));
      }
      for (const o of orders) {
        const st = (o.status || "").toLowerCase();
        if (["pending", "preparing"].includes(st) && o.tableId) busy.add(String(o.tableId));
      }
      setBusyIds(busy);

      if (flist.length) {
        const maps = flist.map((f) => buildTableLiveMap(f, sessions, orders, tl, f.id));
        setLive(mergeLiveMaps(maps));
      } else {
        setLive({});
      }
    } catch (e) {
      setMsg(String(e));
    }
  }, [base]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(id);
  }, [load]);

  const plan = floors.length ? floors.find((f) => f.id === activeFloorId) ?? floors[0] : null;

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.75rem" }}>
        <h3 style={{ margin: 0 }}>خريطة الصالة (حية)</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.82rem", color: "var(--muted)", flexWrap: "wrap" }}>
          {floors.length > 1 &&
            floors.map((f) => (
              <button
                key={f.id}
                type="button"
                className={f.id === activeFloorId ? "btn btn-primary" : "btn btn-ghost"}
                style={{ fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}
                onClick={() => setActiveFloorId(f.id)}
              >
                {f.name}
              </button>
            ))}
          <span>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#22c55e", marginLeft: 6 }} />
            متاحة
          </span>
          <span>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#f59e0b", marginLeft: 6 }} />
            مشغولة
          </span>
          <span>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "#3b82f6", marginLeft: 6 }} />
            محجوزة
          </span>
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.82rem" }} onClick={() => void load()}>
            تحديث
          </button>
        </div>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: "0.35rem", marginBottom: "0.75rem" }}>
        {plan ? (
          <>
            مصدر الشكل: <code>floor_plan.json</code> عبر <code>GET /api/restaurant/floor-plan</code> — مضلع الصالة + طاولات بـ SVG.
            الاستيراد/التصدير: <code>PUT /api/restaurant/floor-plan</code> (نفس بنية الملف). اربط الطاولة بـ <code>linkedTableId</code> ليطابق
            معرّف <code>tables.json</code> إن اختلف <code>id</code> عن المعرف في الطلبات.
          </>
        ) : (
          <>
            لا يوجد <code>config/restaurant/floor_plan.json</code> — يُعرض التخطيط القديم من <code>tables.json</code> و<code>position</code>.
          </>
        )}
      </p>
      {msg && <p style={{ color: "var(--danger)", fontSize: "0.88rem" }}>{msg}</p>}

      {plan ? (
        <FloorPlanSvgView plan={plan} live={live} />
      ) : (
        <div
          style={{
            position: "relative",
            width: "100%",
            minHeight: 320,
            maxHeight: 480,
            overflow: "auto",
            background: "linear-gradient(145deg, rgba(15,23,42,0.06), rgba(34,211,238,0.05))",
            borderRadius: 12,
            border: "1px solid var(--border)",
            padding: 8,
          }}
        >
          <LegacyTablesLayout tables={tables} busyIds={busyIds} />
        </div>
      )}
    </div>
  );
}
