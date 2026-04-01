import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { getApiBase } from "../lib/apiBase";

type TableStatus = "free" | "occupied" | "reserved" | "dirty";

type DiningTable = {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  zone: string;
};

const STORAGE_KEY = "mat3am_tables_v1";

function loadTables(): DiningTable[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DiningTable[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t === "object")
      .map((t) => ({
        id: String((t as DiningTable).id ?? ""),
        name: String((t as DiningTable).name ?? ""),
        seats: Number((t as DiningTable).seats ?? 0) || 0,
        status: ((t as DiningTable).status ?? "free") as TableStatus,
        zone: String((t as DiningTable).zone ?? "القاعة"),
      }))
      .filter((t) => t.id && t.name);
  } catch {
    return [];
  }
}

function saveTables(tables: DiningTable[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tables));
}

function nextId() {
  return "T_" + Math.random().toString(16).slice(2, 10);
}

function mapApiRowToDining(row: Record<string, unknown>): DiningTable {
  const features = (row.features as Record<string, unknown>) || {};
  const zone = String(features.zone ?? "القاعة");
  const st = String(row.status ?? "available").toLowerCase();
  let status: TableStatus = "free";
  if (st.includes("occupy")) status = "occupied";
  else if (st.includes("reserv")) status = "reserved";
  else if (st === "dirty") status = "dirty";
  else status = "free";

  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "طاولة"),
    seats: Number(row.seats) || 4,
    status,
    zone,
  };
}

function diningToApiPayload(t: DiningTable, index: number): Record<string, unknown> {
  const apiStatus =
    t.status === "free"
      ? "available"
      : t.status === "occupied"
        ? "occupied"
        : t.status === "reserved"
          ? "reserved"
          : "dirty";
  const numMatch = t.name.match(/\d+/);
  const number = numMatch ? parseInt(numMatch[0], 10) : index + 1;
  return {
    id: t.id,
    name: t.name,
    seats: t.seats,
    number,
    status: apiStatus,
    features: {
      canAddChildSeat: true,
      nearBalcony: false,
      nearBathroom: false,
      smokingArea: false,
      vipSection: /vip/i.test(t.zone),
      zone: t.zone,
    },
  };
}

function badgeColor(status: TableStatus) {
  switch (status) {
    case "free":
      return "var(--ok)";
    case "occupied":
      return "var(--accent)";
    case "reserved":
      return "var(--warn)";
    case "dirty":
      return "var(--danger)";
  }
}

function statusLabel(status: TableStatus) {
  switch (status) {
    case "free":
      return "فارغة";
    case "occupied":
      return "مشغولة";
    case "reserved":
      return "محجوزة";
    case "dirty":
      return "بحاجة تنظيف";
  }
}

export default function TablesLayoutPage() {
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncMsg, setSyncMsg] = useState("");
  const [zone, setZone] = useState("الكل");
  const [q, setQ] = useState("");
  const syncTimer = useRef<number | null>(null);
  const didInit = useRef(false);

  async function syncAllToServer(list: DiningTable[]) {
    const base = getApiBase();
    setSyncMsg("مزامنة مع الخادم…");
    try {
      for (let i = 0; i < list.length; i++) {
        const r = await fetch(`${base}/api/restaurant/tables`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(diningToApiPayload(list[i], i)),
        });
        if (!r.ok) throw new Error(await r.text());
      }
      setSyncMsg("تمت المزامنة مع خادم الطاولات.");
    } catch (e) {
      setSyncMsg(`تعذر المزامنة: ${String(e)}`);
    }
  }

  function scheduleSync(list: DiningTable[]) {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      syncTimer.current = null;
      void syncAllToServer(list);
    }, 500);
  }

  function persist(next: DiningTable[]) {
    setTables(next);
    saveTables(next);
    if (didInit.current) scheduleSync(next);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${getApiBase()}/api/restaurant/tables`);
        const j = await r.json();
        const rows = Array.isArray(j.tables) ? j.tables : [];
        if (!cancelled && rows.length > 0) {
          const mapped = rows.map((x: Record<string, unknown>) => mapApiRowToDining(x));
          setTables(mapped);
          saveTables(mapped);
          didInit.current = true;
          setLoading(false);
          return;
        }
      } catch {
        /* fallback */
      }
      if (cancelled) return;
      const stored = loadTables();
      if (stored.length) {
        setTables(stored);
        didInit.current = true;
        setLoading(false);
        scheduleSync(stored);
        return;
      }
      const seed: DiningTable[] = Array.from({ length: 12 }).map((_, i) => ({
        id: nextId(),
        name: `طاولة ${i + 1}`,
        seats: i < 6 ? 4 : 6,
        status: "free",
        zone: i < 6 ? "القاعة" : "VIP",
      }));
      saveTables(seed);
      setTables(seed);
      didInit.current = true;
      setLoading(false);
      scheduleSync(seed);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const zones = useMemo(() => {
    const z = new Set<string>(tables.map((t) => t.zone).filter(Boolean));
    return ["الكل", ...Array.from(z)];
  }, [tables]);

  const filtered = useMemo(() => {
    const qq = q.trim();
    return tables.filter((t) => {
      if (zone !== "الكل" && t.zone !== zone) return false;
      if (!qq) return true;
      return t.name.includes(qq) || t.zone.includes(qq);
    });
  }, [tables, zone, q]);

  function addTable() {
    const n = tables.length + 1;
    persist([
      ...tables,
      { id: nextId(), name: `طاولة ${n}`, seats: 4, status: "free", zone: "القاعة" },
    ]);
  }

  function updateTable(id: string, patch: Partial<DiningTable>) {
    persist(tables.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function removeTable(id: string) {
    try {
      await fetch(`${getApiBase()}/api/restaurant/tables/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* قد لا تكون في ملف الخادم بعد */
    }
    persist(tables.filter((t) => t.id !== id));
  }

  function cycleStatus(s: TableStatus): TableStatus {
    if (s === "free") return "occupied";
    if (s === "occupied") return "dirty";
    if (s === "dirty") return "reserved";
    return "free";
  }

  return (
    <div>
      <div
        className="card"
        style={{
          marginBottom: "1rem",
          border: "1px solid rgba(249, 115, 22, 0.45)",
          background: "rgba(249, 115, 22, 0.08)",
        }}
      >
        <p style={{ margin: 0, lineHeight: 1.55 }}>
          <strong>قائمة بيانات الطاولات</strong> من <code>/api/restaurant/tables</code> (ومحلياً).{" "}
          <strong>مخطط الصالة المرئي</strong> (مضلع المساحة و SVG) في{" "}
          <NavLink to="../settings/venue" style={{ fontWeight: 700, textDecoration: "underline" }}>
            إعدادات النظام ← المكان والطابق والمساحات
          </NavLink>
          .
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.85rem" }}>
          قائمة الطاولات وحالاتها
        </h1>
        <div style={{ color: "var(--muted)" }}>
          نفس بيانات الطاولات المستخدمة في الاستقبال وجارسون الطلبات (<code>/api/restaurant/tables</code>) مع نسخة احتياطية في
          المتصفح.
        </div>
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>جاري تحميل الطاولات…</p>}
      {syncMsg && <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{syncMsg}</p>}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn btn-primary" onClick={addTable} disabled={loading}>
            إضافة طاولة
          </button>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ color: "var(--muted)" }}>المنطقة</span>
            <select value={zone} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث باسم الطاولة أو المنطقة..."
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "0.9rem",
        }}
      >
        {filtered.map((t) => (
          <div
            key={t.id}
            className="card"
            style={{
              padding: "1rem",
              cursor: "pointer",
              position: "relative",
              overflow: "hidden",
            }}
            onClick={() => updateTable(t.id, { status: cycleStatus(t.status) })}
            title="اضغط لتغيير الحالة"
          >
            <div
              style={{
                position: "absolute",
                inset: "auto -50px -50px auto",
                width: 160,
                height: 160,
                background: `radial-gradient(circle at 40% 40%, ${badgeColor(
                  t.status
                )}55, transparent 60%)`,
                filter: "blur(0px)",
              }}
              aria-hidden="true"
            />

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
              <input
                value={t.name}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateTable(t.id, { name: e.target.value })}
                style={{ fontWeight: 800, width: "100%" }}
              />
              <span
                style={{
                  whiteSpace: "nowrap",
                  fontSize: "0.8rem",
                  padding: "0.25rem 0.5rem",
                  borderRadius: 999,
                  background: `${badgeColor(t.status)}22`,
                  border: `1px solid ${badgeColor(t.status)}55`,
                  color: "var(--text)",
                }}
              >
                {statusLabel(t.status)}
              </span>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }}>مقاعد</span>
                <input
                  type="number"
                  min={1}
                  value={t.seats}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateTable(t.id, { seats: Number(e.target.value) || 0 })}
                  style={{ width: 90 }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: 1 }}>
                <span style={{ color: "var(--muted)" }}>منطقة</span>
                <input
                  value={t.zone}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateTable(t.id, { zone: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  updateTable(t.id, { status: "free" });
                }}
              >
                تفريغ
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeTable(t.id);
                }}
                style={{ borderColor: "rgba(251,113,133,0.35)", color: "var(--danger)" }}
              >
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
