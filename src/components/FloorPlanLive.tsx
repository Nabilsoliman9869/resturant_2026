import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
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
  noOrderOverdue?: boolean;
  noOrderMinutes?: number;
};

type SessionRec = { id: string; tableId?: string; status?: string; startTime?: string };
type OrderRec = {
  id: string;
  tableId?: string;
  status?: string;
  items?: Array<{ name?: string; quantity?: number; lineStatus?: string; prepared?: boolean; sent?: boolean }>;
};
type PlanStatus = "api" | "missing" | "invalid" | "unavailable";

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
  const now = Date.now();
  const activeSessionsByTable = new Map<string, SessionRec[]>();
  for (const s of sessions) {
    if ((s?.status || "").toLowerCase() !== "active") continue;
    const tid = String(s?.tableId || "");
    if (!tid) continue;
    const arr = activeSessionsByTable.get(tid) || [];
    arr.push(s);
    activeSessionsByTable.set(tid, arr);
  }

  const live: TableLiveMap = {};
  const keyPre = liveKeyPrefix ? `${liveKeyPrefix}::` : "";
  for (const ft of plan.tables) {
    const tid = resolveApiTableId(ft);
    const openOrders = orders.filter(
      (o) =>
        String(o.tableId) === tid &&
        !["ready", "served", "paid"].includes((o.status || "").toLowerCase()),
    );
    const sessForTable = activeSessionsByTable.get(tid) || [];
    const hasSession = sessForTable.length > 0;
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
    let orderPreview: string | undefined;
    let orderCountOut = openOrders.length;
    if (!openOrders.length && hasSession) {
      const mins = sessForTable
        .map((s) => {
          const ts = Date.parse(String(s?.startTime || ""));
          if (!Number.isFinite(ts)) return 0;
          return Math.max(0, Math.floor((now - ts) / 60000));
        })
        .sort((a, b) => b - a)[0] || 0;
      if (mins >= 10) {
        status = "billing";
        orderCountOut = 1;
        orderPreview = `تأخر أخذ الطلب ${mins} د`;
      }
    }
    if (apiT?.noOrderOverdue) {
      status = "billing";
      orderCountOut = 1;
      orderPreview = `تأخر أخذ الطلب ${Number(apiT.noOrderMinutes || 0)} د`;
    }
    if (openOrders.length) {
      const allLines = openOrders.flatMap((o) => (Array.isArray(o.items) ? o.items : []));
      if (allLines.length > 0) {
        const sent = allLines.filter((it) => it?.sent || String(it?.lineStatus || "").toLowerCase() === "sent").length;
        const prepared = allLines.filter((it) => it?.prepared || String(it?.lineStatus || "").toLowerCase() === "ready").length;
        progress = Math.min(100, Math.round(((sent + prepared * 0.75) / allLines.length) * 100));
      } else {
        const sum = openOrders.reduce((a, o) => a + orderStatusWeight(o.status || ""), 0);
        progress = Math.min(100, Math.round((sum / openOrders.length) * 100));
      }
      const flat = openOrders
        .flatMap((o) => (Array.isArray(o.items) ? o.items : []))
        .map((it) => `${it?.name || "صنف"}${it?.quantity ? `×${it.quantity}` : ""}`)
        .filter(Boolean);
      orderPreview = flat.slice(0, 2).join(" · ");
    }

    live[`${keyPre}${ft.id}`] = { status, progress, orderCount: orderCountOut, orderPreview };
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
  const [planStatus, setPlanStatus] = useState<PlanStatus>("missing");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setMsg("");
    try {
      const safeJson = async (res: Response) => {
        try {
          const txt = await res.text();
          if (!txt) return {} as any;
          return JSON.parse(txt);
        } catch {
          return {} as any;
        }
      };
      const fetchSafe = async (url: string) => {
        try {
          const response = await fetch(url);
          const body = await safeJson(response);
          return { ok: response.ok, status: response.status, body };
        } catch (error) {
          return { ok: false, status: 0, body: null as any, error: String(error) };
        }
      };
      const [fpRes, tRes, sRes, oRes] = await Promise.all([
        fetchSafe(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
        fetchSafe(`${base}/api/restaurant/tables`),
        fetchSafe(`${base}/api/restaurant/table-sessions`),
        fetchSafe(`${base}/api/restaurant/orders`),
      ]);

      const rawPlan = fpRes.ok ? fpRes.body?.plan : null;
      const norm = rawPlan != null ? normalizeFloorPlanDocument(rawPlan) : null;
      const flist = norm?.floors ?? [];
      if (fpRes.ok) {
        setFloors(flist);
        setActiveFloorId((cur) => {
          if (!flist.length) return null;
          if (cur && flist.some((f) => f.id === cur)) return cur;
          return norm?.activeFloorId ?? flist[0].id;
        });
        if (rawPlan == null) {
          setPlanStatus("missing");
        } else if (!norm) {
          setPlanStatus("invalid");
          setMsg("تم العثور على floor_plan.json لكن بنيته غير صالحة للعرض.");
        } else {
          setPlanStatus("api");
        }
      } else {
        setPlanStatus("unavailable");
        setMsg(fpRes.error || `تعذر الوصول إلى API الخاص بالمخطط (HTTP ${fpRes.status || 0}). تأكد من تشغيل الخادم الخلفي على 127.0.0.1:2288.`);
      }

      const tl = Array.isArray(tRes.body?.tables) ? tRes.body.tables : [];
      setTables(tl);
      const sessions: SessionRec[] = Array.isArray(sRes.body?.sessions) ? sRes.body.sessions : [];
      const orders: OrderRec[] = Array.isArray(oRes.body?.orders) ? oRes.body.orders : [];

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
    const id = window.setInterval(() => void load(), 7000);
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
          <NavLink to="/app/developer/settings/floor-editor" className="btn btn-ghost" style={{ fontSize: "0.82rem" }}>
            فتح محرّر المخطط
          </NavLink>
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.82rem" }} onClick={() => void load()}>
            تحديث
          </button>
        </div>
      </div>
      {planStatus === "unavailable" && (
        <p style={{ color: "var(--danger)", fontSize: "0.88rem", marginTop: "0.35rem" }}>تعذر تحميل المخطط.</p>
      )}
      {planStatus === "invalid" && (
        <p style={{ color: "var(--danger)", fontSize: "0.88rem", marginTop: "0.35rem" }}>مخطط غير صالح.</p>
      )}
      {msg && <p style={{ color: "var(--danger)", fontSize: "0.88rem" }}>{msg}</p>}
      {plan && plan.tables.length === 0 && tables.length > 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: "0.35rem" }}>
          المخطط بلا طاولات — عرض مؤقت من كتالوج SQL (TBL005). أكمل المخطط من «محرّر المخطط».
        </p>
      )}

      {plan && plan.tables.length > 0 ? (
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
