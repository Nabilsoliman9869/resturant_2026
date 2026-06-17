import { useEffect, useState, useCallback } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { normalizeTableDisplayLabel } from "../lib/restaurantTableView";
import { buildSegmentedTablesFromFloorPlan, type SegmentedTableRow } from "../lib/restaurantTableView";
import { briefNetworkHint, safeFetch } from "../lib/safeFetch";
import { tryParseJson } from "../lib/tryParseJson";
import "../styles/operationalRoles.css";

type RestTable = SegmentedTableRow;

function normalizeTableStatus(raw: string): "ready" | "occupied" | "reserved" | "dirty" | "cleaning" {
  const s = String(raw || "").toLowerCase().trim();
  if (["available", "free", "open", "ready", "متاحة", "جاهزة"].includes(s)) return "ready";
  if (["occupied", "busy", "مشغولة"].includes(s)) return "occupied";
  if (["reserved", "محجوزة"].includes(s)) return "reserved";
  if (["dirty", "متسخة"].includes(s)) return "dirty";
  if (["cleaning", "تنظيف"].includes(s)) return "cleaning";
  return "ready";
}

export default function ServerTablesPage() {
  const base = getApiBase();
  const [tables, setTables] = useState<RestTable[]>([]);
  const [msg, setMsg] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [billReqIds, setBillReqIds] = useState<Set<string>>(() => new Set());
  const [canClean, setCanClean] = useState(true);

  const load = useCallback(async () => {
    try {
      const [fp, rt, rs, ro, wf] = await Promise.all([
        fetch(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
        fetch(`${base}/api/restaurant/tables`),
        fetch(`${base}/api/restaurant/table-sessions?status=active`),
        fetch(`${base}/api/restaurant/orders`),
        fetch(`${base}/api/restaurant/workflow-settings`).catch(() => new Response("{}")),
      ]);
      const fpj = await fp.json().catch(() => ({}));
      const tj = await rt.json();
      const sj = await rs.json().catch(() => ({}));
      const oj = await ro.json().catch(() => ({}));
      const wfj = await wf.json().catch(() => ({}));

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

      const execBy = String(wfj?.cleaningExecutionBy || wfj?.cleanTableBy || "").trim().toLowerCase();
      setCanClean(execBy === "server" || execBy === "");
    } catch (e) {
      setMsg(briefNetworkHint(e));
    }
  }, [base]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [load]);

  async function changeTableStatus(tableId: string, status: "dirty" | "cleaning" | "ready") {
    try {
      const r = await safeFetch(`${base}/api/restaurant/tables/${encodeURIComponent(tableId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const t = await r.text();
      if (!r.ok) {
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t.slice(0, 280) || `HTTP ${r.status}`);
        return;
      }
      setTables((prev) =>
        prev.map((tr) => (String(tr.id) === String(tableId) ? { ...tr, status } : tr)),
      );
    } catch (e) {
      setMsg(briefNetworkHint(e));
    }
  }

  function statusLabel(st: string) {
    const s = normalizeTableStatus(st);
    if (s === "dirty") return "متسخة";
    if (s === "cleaning") return "قيد التنظيف";
    if (s === "occupied") return "مشغولة";
    if (s === "reserved") return "محجوزة";
    return "جاهزة";
  }

  function statusColor(st: string) {
    const s = normalizeTableStatus(st);
    if (s === "dirty") return { border: "2px solid #9ca3af", bg: "#f3f4f6", text: "#4b5563" };
    if (s === "cleaning") return { border: "2px solid #f59e0b", bg: "#fffbeb", text: "#b45309" };
    if (s === "occupied") return { border: "2px solid #ef4444", bg: "#fef2f2", text: "#b91c1c" };
    return { border: "2px solid #22c55e", bg: "#f0fdf4", text: "#166534" };
  }

  return (
    <div className="role-op waiter-pos">
      <OperationalRoleHeader roleTitle="جارسون المناولة" hideBack />

      <div className="role-op__main">
        <h2 className="role-op__section-title">حالة الطاولات</h2>
        <p style={{ color: "var(--wp-muted)", fontSize: "0.9rem", marginTop: "-0.5rem", marginBottom: "1rem" }}>
          عرض حالة الطاولات والتنظيف (يُحدّث تلقائياً).
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
            const num = normalizeTableDisplayLabel(t.name, t.number, t.id);
            const tStatus = normalizeTableStatus(String(t.status || ""));
            const isBusy = busyIds.has(String(t.id));
            const billReq = billReqIds.has(String(t.id));
            const sc = statusColor(String(t.status || ""));
            return (
              <div
                key={t.id}
                className="role-op__pick-card"
                style={{
                  cursor: "default",
                  boxShadow: billReq ? "0 0 0 3px rgba(59,130,246,0.35)" : "none",
                  border: sc.border,
                  background: sc.bg,
                }}
              >
                <div className="role-op__pick-num" style={{ color: sc.text }}>{num}</div>
                <div className="role-op__pick-sub">🪑 مقاعد {t.seats ?? "—"}</div>
                <div style={{ marginTop: 8, fontSize: "0.85rem", color: sc.text }}>
                  {statusLabel(String(t.status || ""))}
                  {billReq ? " · طلب حساب" : ""}
                </div>
                {canClean && tStatus === "dirty" ? (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="waiter-tblcard__pill waiter-tblcard__pill--clean-go"
                      onClick={(e) => {
                        e.stopPropagation();
                        void changeTableStatus(String(t.id), "cleaning");
                      }}
                      style={{ fontSize: "0.78rem" }}
                    >
                      بدء تنظيف
                    </button>
                  </div>
                ) : null}
                {canClean && tStatus === "cleaning" ? (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="waiter-tblcard__pill waiter-tblcard__pill--clean-done"
                      onClick={(e) => {
                        e.stopPropagation();
                        void changeTableStatus(String(t.id), "ready");
                      }}
                      style={{ fontSize: "0.78rem" }}
                    >
                      إنهاء تنظيف
                    </button>
                  </div>
                ) : null}
                {isBusy && tStatus === "ready" ? (
                  <div style={{ marginTop: 6, fontSize: "0.75rem", color: "#b91c1c" }}>جلسة نشطة</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
