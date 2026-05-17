import { useCallback, useEffect, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { sessionDisplayName } from "../auth/displayUser";
import { dispositionLabel } from "../lib/guestReturnCatalog";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";

type ReturnRequest = {
  id: string;
  sessionId?: string;
  tableId?: string;
  tableLabel?: string;
  status?: string;
  requestedAt?: string;
  requestedBy?: { name?: string; role?: string };
  lines?: Array<{
    lineId?: string;
    name?: string;
    returnQty?: number;
    reasonLabel?: string;
    proposedDisposition?: string;
    finalDisposition?: string;
  }>;
  managerNote?: string;
};

const STATUS_AR: Record<string, string> = {
  pending_manager: "بانتظار المدير",
  approved: "معتمد",
  rejected: "مرفوض",
};

export default function GuestReturnsManagerPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const [rows, setRows] = useState<ReturnRequest[]>([]);
  const [filter, setFilter] = useState<"pending_manager" | "all">("pending_manager");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const q = filter === "pending_manager" ? "?status=pending_manager" : "";
      const r = await fetch(`${base}/api/restaurant/guest-returns${q}`, { cache: "no-store" });
      const j = tryParseJson<{ requests?: ReturnRequest[] }>(await r.text()) ?? {};
      setRows(Array.isArray(j.requests) ? j.requests : []);
    } catch (e) {
      setMsg(String(e));
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [base, filter]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(id);
  }, [load]);

  async function review(id: string, action: "approve" | "reject") {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/guest-returns/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reviewedBy: {
            userId: user?.id != null ? String(user.id) : "",
            name: sessionDisplayName(user) || "مدير",
            role: user?.role || "manager",
          },
          managerNote: action === "reject" ? "مرفوض من المدير" : "",
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ detail?: string }>(t) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t);
      void load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div className="role-op">
      <OperationalRoleHeader roleTitle="مرتجعات الضيوف" hideBack />
      <div className="role-op__main">
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          طلبات الجرسون تظهر هنا للاعتماد — سبب المرتجع وطريقة المعالجة (ويتر / مطبخ / شيفت / مخزون).
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className={filter === "pending_manager" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setFilter("pending_manager")}
          >
            بانتظار الاعتماد
          </button>
          <button
            type="button"
            className={filter === "all" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setFilter("all")}
          >
            الكل
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={busy}>
            تحديث
          </button>
        </div>
        {msg ? <p style={{ color: "var(--danger)" }}>{msg}</p> : null}
        {busy && rows.length === 0 ? <p>جارٍ التحميل…</p> : null}
        {!busy && rows.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>لا طلبات {filter === "pending_manager" ? "معلّقة" : ""}.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((req) => (
              <div key={req.id} className="card" style={{ padding: "0.85rem 1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong>{req.tableLabel || req.tableId || "طاولة"}</strong>
                    <span style={{ marginInlineStart: 8, fontSize: "0.85rem", color: "var(--muted)" }}>
                      {STATUS_AR[String(req.status || "").toLowerCase()] || req.status}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                    {req.requestedBy?.name || "جرسون"} · {req.requestedAt?.slice(0, 16) || ""}
                  </span>
                </div>
                <ul style={{ margin: "8px 0", paddingInlineStart: 18, fontSize: "0.9rem" }}>
                  {(req.lines || []).map((ln) => (
                    <li key={String(ln.lineId)}>
                      {ln.name} ×{ln.returnQty} — <em>{ln.reasonLabel}</em>
                      <br />
                      <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
                        مقترح: {dispositionLabel(String(ln.proposedDisposition || ""))}
                        {ln.finalDisposition
                          ? ` · معتمد: ${dispositionLabel(String(ln.finalDisposition))}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {String(req.status).toLowerCase() === "pending_manager" ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={() => void review(req.id, "approve")}>
                      اعتماد
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void review(req.id, "reject")}>
                      رفض
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


