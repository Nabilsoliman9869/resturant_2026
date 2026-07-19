import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { normalizeTableDisplayLabel } from "../lib/restaurantTableView";
import { tryParseJson } from "../lib/tryParseJson";
import { buildMat3amActor } from "../lib/mat3amActor";

type RestTable = { id: string; name: string; number?: number; seats?: number };
type TableSession = {
  id: string;
  tableId?: string;
  status?: string;
  guestCount?: number;
  startTime?: string;
  tableDisplayName?: string;
  linkedOrderCount?: number;
  billingRequestedAt?: string;
};

function displayNameForSession(s: TableSession, tables: RestTable[]): string {
  const fromServer = (s.tableDisplayName || "").trim();
  if (fromServer && fromServer !== "—") return fromServer;
  const tid = String(s.tableId || "").trim();
  if (!tid) return "بدون طاولة";
  const hit = tables.find((t) => String(t.id) === tid);
  if (hit) return normalizeTableDisplayLabel(hit.name, hit.number, hit.id);
  const compact = tid.replace(/-/g, "");
  const short = compact.length >= 6 ? compact.slice(-6).toUpperCase() : tid.slice(0, 8);
  return `طاولة ·${short}`;
}

export default function CashierTableSessionsPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const actor = user?.login || user?.role || "";
  const [tables, setTables] = useState<RestTable[]>([]);
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [msg, setMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const duplicateTableCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      const tid = String(s.tableId || "").trim();
      if (!tid) continue;
      m.set(tid, (m.get(tid) || 0) + 1);
    }
    let n = 0;
    m.forEach((c) => {
      if (c > 1) n += c;
    });
    return n;
  }, [sessions]);

  const groups = useMemo(() => {
    const m = new Map<string, TableSession[]>();
    for (const s of sessions) {
      const tid = String(s.tableId || "").trim() || "_empty";
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid)!.push(s);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => String(b.startTime || "").localeCompare(String(a.startTime || "")));
    }
    return [...m.entries()].sort((a, b) =>
      String(b[1][0]?.startTime || "").localeCompare(String(a[1][0]?.startTime || ""))
    );
  }, [sessions]);

  const load = useCallback(async () => {
    setMsg("");
    setLoading(true);
    try {
      const [ts, ss] = await Promise.all([
        fetch(`${base}/api/restaurant/tables`),
        fetch(`${base}/api/restaurant/table-sessions?status=active`),
      ]);
      const tj = tryParseJson<{ tables?: RestTable[] }>(await ts.text()) ?? {};
      const sj = tryParseJson<{ sessions?: TableSession[] }>(await ss.text()) ?? {};
      setTables(Array.isArray(tj.tables) ? tj.tables : []);
      setSessions(Array.isArray(sj.sessions) ? sj.sessions : []);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transferSession(sessionId: string, newTableId: string) {
    if (!newTableId) return;
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: newTableId, actor }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      await load();
    } catch (e) {
      setMsg(`فشل تغيير الطاولة: ${String(e)}`);
    }
  }

  async function completeSession(sessionId: string) {
    if (
      !window.confirm(
        "إغلاق إسكان الطاولة؟\n\nهذا لا يسدّد الفاتورة. إن وُجد طلب حساب، سدّد أولاً من «فواتير المطعم».\n\nسجلات الطلبات تبقى في النظام (أرشيف) ولا تُحذف."
      )
    )
      return;
    setMsg("");
    try {
      const actor = buildMat3amActor(user);
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(sessionId)}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mat3amActor: actor }),
      });
      const t = await r.text();
      if (!r.ok) {
        const j = tryParseJson<{ detail?: string }>(t) ?? {};
        const d = typeof j.detail === "string" ? j.detail : t;
        throw new Error(d);
      }
      setSuccessMsg("تم إغلاق الإسكان (الجلسة لم تعد نشطة).");
      await load();
    } catch (e) {
      setMsg(`فشل إغلاق الإسكان: ${String(e)}`);
    }
  }

  async function cleanupDuplicateEmpties() {
    if (
      !window.confirm(
        "إنهاء الجلسات المكررة الفارغة؟\n\nيُبقى جلسة واحدة لكل طاولة (أولوية: بها طلبات، أو طُلِب لها حساب، أو الأحدث). تُغلق فقط الجلسات ذات 0 طلبات وبدون طلب حساب."
      )
    )
      return;
    setCleanupBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions/cleanup-duplicate-empties`, { method: "POST" });
      const txt = await r.text();
      const j = tryParseJson<{ count?: number; detail?: string }>(txt) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : txt.slice(0, 200));
      const n = typeof j.count === "number" ? j.count : 0;
      setSuccessMsg(n > 0 ? `تم إنهاء ${n} جلسة فارغة مكررة.` : "لا توجد جلسات فارغة مؤهّلة للإغلاق التلقائي.");
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setCleanupBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>جلسات الطاولات النشطة</h1>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem", alignItems: "center" }}>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void load()}>
          {loading ? "جاري التحديث…" : "تحديث"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={cleanupBusy || duplicateTableCount < 2}
          title={duplicateTableCount < 2 ? "لا يوجد تكرار لنفس الطاولة" : undefined}
          onClick={() => void cleanupDuplicateEmpties()}
        >
          {cleanupBusy ? "…" : "تنظيف التكرار الفارغ"}
        </button>
      </div>

      {duplicateTableCount > 1 && (
        <div
          className="card"
          style={{
            marginBottom: "1rem",
            borderColor: "rgba(249, 115, 22, 0.45)",
            background: "rgba(249, 115, 22, 0.07)",
            fontSize: "0.9rem",
            lineHeight: 1.5,
          }}
        >
          <strong>تكرار جلسات لنفس الطاولة ({duplicateTableCount} صفوف).</strong> الإسكان الجديد لن يُنشئ جلسة ثانية لنفس
          المعرف. للبيانات الحالية: «تنظيف التكرار الفارغ» يغلق النسخ الفارغة (0 طلب، بدون طلب حساب)، أو أنهِ يدوياً من
          البطاقة أدناه.
        </div>
      )}

      {successMsg && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "rgba(34, 197, 94, 0.45)", background: "rgba(34, 197, 94, 0.06)" }}>
          {successMsg}
        </div>
      )}
      {msg && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--danger, #c2410c)" }}>
          {msg}
        </div>
      )}

      {sessions.length === 0 && !loading ? (
        <div className="card">
          <p style={{ margin: 0, color: "var(--muted)" }}>لا توجد جلسات نشطة حالياً.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {groups.map(([tableKey, list]) => {
            const tid = tableKey === "_empty" ? "" : tableKey;
            const title = displayNameForSession(list[0], tables);
            const dup = list.length > 1;
            return (
              <section
                key={tableKey}
                className="card"
                style={{
                  overflow: "hidden",
                  borderColor: dup ? "rgba(249, 115, 22, 0.35)" : undefined,
                }}
              >
                <header
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    paddingBottom: "0.65rem",
                    marginBottom: "0.5rem",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.15rem", fontFamily: "var(--display)" }}>{title}</h2>
                    {tid ? (
                      <details style={{ marginTop: 6, fontSize: "0.75rem", color: "var(--muted)" }}>
                        <summary style={{ cursor: "pointer" }}>معرّف الطاولة (تقني)</summary>
                        <code style={{ display: "block", marginTop: 4, wordBreak: "break-all" }}>{tid}</code>
                      </details>
                    ) : null}
                  </div>
                  {dup ? (
                    <span
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "rgba(249, 115, 22, 0.15)",
                        color: "#c2410c",
                      }}
                    >
                      {list.length} جلسات — راجع الفارغة
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>جلسة واحدة</span>
                  )}
                </header>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr style={{ textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "0.45rem 0.35rem" }}>بدأت</th>
                        <th style={{ padding: "0.45rem 0.35rem" }}>ضيوف</th>
                        <th style={{ padding: "0.45rem 0.35rem" }}>طلبات</th>
                        <th style={{ padding: "0.45rem 0.35rem" }}>الحساب</th>
                        <th style={{ padding: "0.45rem 0.35rem" }}>جلسة</th>
                        <th style={{ padding: "0.45rem 0.35rem" }}>تغيير الطاولة</th>
                        <th style={{ padding: "0.45rem 0.35rem" }}>إنهاء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((s) => (
                        <SessionRow
                          key={s.id}
                          session={s}
                          tables={tables}
                          onTransfer={(newTid) => void transferSession(s.id, newTid)}
                          onComplete={() => void completeSession(s.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  tables,
  onTransfer,
  onComplete,
}: {
  session: TableSession;
  tables: RestTable[];
  onTransfer: (tableId: string) => void;
  onComplete: () => void;
}) {
  const [targetTable, setTargetTable] = useState("");
  const current = String(session.tableId || "");
  const orderCount =
    typeof session.linkedOrderCount === "number" && Number.isFinite(session.linkedOrderCount)
      ? session.linkedOrderCount
      : 0;
  const sessionShort = session.id.length > 10 ? `${session.id.slice(0, 8)}…` : session.id;
  const billing = Boolean(session.billingRequestedAt);
  const startLabel = session.startTime ? session.startTime.replace("T", " ").slice(0, 19) : "—";

  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "0.5rem 0.35rem", whiteSpace: "nowrap", fontSize: "0.82rem" }}>{startLabel}</td>
      <td style={{ padding: "0.5rem 0.35rem", textAlign: "center" }}>{session.guestCount ?? "—"}</td>
      <td style={{ padding: "0.5rem 0.35rem", textAlign: "center", fontWeight: 700 }}>{orderCount}</td>
      <td style={{ padding: "0.5rem 0.35rem", fontSize: "0.82rem" }}>
        {billing ? (
          <span style={{ color: "#b45309", fontWeight: 600 }}>مطلوب</span>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        )}
      </td>
      <td style={{ padding: "0.5rem 0.35rem", fontFamily: "monospace", fontSize: "0.7rem", wordBreak: "break-all" }} title={session.id}>
        {sessionShort}
      </td>
      <td style={{ padding: "0.5rem 0.35rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <select
            value={targetTable}
            onChange={(e) => setTargetTable(e.target.value)}
            aria-label="طاولة الوجهة"
            style={{ maxWidth: 160, fontSize: "0.8rem" }}
          >
            <option value="">اختر…</option>
            {tables
              .filter((t) => String(t.id) !== current)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {normalizeTableDisplayLabel(t.name, t.number, t.id)}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "0.78rem", padding: "4px 8px" }}
            disabled={!targetTable}
            onClick={() => {
              onTransfer(targetTable);
              setTargetTable("");
            }}
          >
            تغيير
          </button>
        </div>
      </td>
      <td style={{ padding: "0.5rem 0.35rem" }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: "0.78rem", padding: "4px 8px" }}
          title="يغلق سجل الجلسة فقط — التسديد من فواتير المطعم"
          onClick={onComplete}
        >
          إغلاق إسكان
        </button>
      </td>
    </tr>
  );
}
