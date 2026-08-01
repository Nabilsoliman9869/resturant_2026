import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { buildMat3amActor } from "../lib/mat3amActor";
import type { RoleId } from "../auth/roles";

export type ManagerCardApprover = {
  id: string;
  name: string;
  login?: string;
  role: RoleId | string;
};

type DecisionOption = {
  id: string;
  label?: string;
  recommended?: boolean;
};

type ApprovalRequest = {
  id: string;
  type?: string;
  status?: string;
  requestedAt?: string;
  tableId?: string;
  tableLabel?: string;
  reason?: string;
  requestedBy?: { name?: string; role?: string };
  decisionOptions?: DecisionOption[];
  targetOptions?: Array<{ userId: string }>;
};

type Props = {
  approver: ManagerCardApprover;
  captainLabel: string;
  onClose: () => void;
};

const TYPE_LABELS: Record<string, string> = {
  guest_session_request: "فتح جلسة ضيف / مالك / VIP",
  cancel_session_request: "إلغاء جلسة",
  reset_table_request: "تصفير طاولة",
  captain_handover_request: "تسليم طاولات كابتن",
  shift_close_request: "إقفال وردية",
};

/** قرارات يمكن اعتمادها جماعياً بدون إدخال إضافي */
function isSafeBulkApprove(req: ApprovalRequest): { ok: true; decisionId: string } | { ok: false } {
  if (String(req.status || "") !== "pending_manager") return { ok: false };
  const options = req.decisionOptions || [];
  const recommended = options.find((x) => x.recommended) || options[0];
  if (!recommended?.id) return { ok: false };
  const id = String(recommended.id).trim();
  if (!id || id.startsWith("reject")) return { ok: false };
  if (id.includes("with_limit") || id.includes("limit")) return { ok: false };
  if ((req.targetOptions || []).length > 1) return { ok: false };
  return { ok: true, decisionId: id };
}

function typeLabel(type?: string) {
  const key = String(type || "").trim();
  return TYPE_LABELS[key] || key || "طلب موافقة";
}

export function ManagerCardApprovalOverlay({ approver, captainLabel, onClose }: Props) {
  const base = getApiBase();
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/manager-approvals?status=pending_manager`, { cache: "no-store" });
      const j = tryParseJson<{ requests?: ApprovalRequest[]; detail?: string }>(await r.text()) ?? {};
      if (!r.ok) throw new Error(j.detail || "تعذر جلب الموافقات");
      setRows(Array.isArray(j.requests) ? j.requests : []);
      setMsg("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const safeBulk = useMemo(
    () => rows.filter((req) => isSafeBulkApprove(req).ok),
    [rows],
  );

  async function patchRequest(req: ApprovalRequest, action: "approve" | "reject", decisionId?: string) {
    setActingId(req.id);
    setMsg("");
    try {
      if (action === "approve" && !decisionId) {
        setMsg("لا يوجد قرار افتراضي لهذا الطلب — افتح صفحة الموافقات للتفاصيل.");
        return;
      }
      if (action === "reject" && String(req.type || "") === "guest_session_request") {
        const note = window.prompt("سبب الرفض (إلزامي لجلسة الضيف):", "") || "";
        if (!note.trim()) {
          setMsg("سبب الرفض إلزامي.");
          return;
        }
        const r = await fetch(`${base}/api/restaurant/manager-approvals/${encodeURIComponent(req.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reject",
            managerNote: note.trim(),
            reviewedBy: {
              userId: approver.id,
              name: approver.name,
              role: approver.role,
            },
            mat3amActor: buildMat3amActor({
              id: approver.id,
              name: approver.name,
              login: approver.login,
              role: approver.role as RoleId,
            }),
          }),
        });
        const t = await r.text();
        const j = tryParseJson<{ detail?: string }>(t) ?? {};
        if (!r.ok) throw new Error(j.detail || t || "فشل الرفض");
        await load();
        return;
      }

      const r = await fetch(`${base}/api/restaurant/manager-approvals/${encodeURIComponent(req.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          decisionId: action === "approve" ? decisionId : undefined,
          targetUserId:
            action === "approve" && (req.targetOptions || []).length === 1
              ? req.targetOptions![0].userId
              : undefined,
          reviewedBy: {
            userId: approver.id,
            name: approver.name,
            role: approver.role,
          },
          mat3amActor: buildMat3amActor({
            id: approver.id,
            name: approver.name,
            login: approver.login,
            role: approver.role as RoleId,
          }),
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ detail?: string }>(t) ?? {};
      if (!r.ok) throw new Error(j.detail || t || "فشل التنفيذ");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActingId(null);
    }
  }

  async function approveOne(req: ApprovalRequest) {
    const safe = isSafeBulkApprove(req);
    if (!safe.ok) {
      setMsg("هذا الطلب يحتاج تفاصيل من صفحة «موافقات المدير» (حد أقصى / اختيار بديل / …).");
      return;
    }
    await patchRequest(req, "approve", safe.decisionId);
  }

  async function approveAllSafe() {
    if (!safeBulk.length) {
      setMsg("لا توجد طلبات آمنة للاعتماد الجماعي حالياً.");
      return;
    }
    if (!window.confirm(`اعتماد ${safeBulk.length} طلب(ات) آمنة دفعة واحدة؟`)) return;
    setBusy(true);
    setMsg("");
    let okCount = 0;
    let failCount = 0;
    for (const req of safeBulk) {
      const safe = isSafeBulkApprove(req);
      if (!safe.ok) continue;
      try {
        const r = await fetch(`${base}/api/restaurant/manager-approvals/${encodeURIComponent(req.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            decisionId: safe.decisionId,
            targetUserId: (req.targetOptions || []).length === 1 ? req.targetOptions![0].userId : undefined,
            reviewedBy: {
              userId: approver.id,
              name: approver.name,
              role: approver.role,
            },
            mat3amActor: buildMat3amActor({
              id: approver.id,
              name: approver.name,
              login: approver.login,
              role: approver.role as RoleId,
            }),
          }),
        });
        if (r.ok) okCount += 1;
        else failCount += 1;
      } catch {
        failCount += 1;
      }
    }
    await load();
    setBusy(false);
    setMsg(`تم اعتماد ${okCount} طلب${failCount ? ` · فشل ${failCount}` : ""}.`);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mgr-card-approval-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 21000,
        background: "rgba(15,23,42,0.82)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        direction: "rtl",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "min(88vh, 720px)",
          overflow: "auto",
          background: "linear-gradient(165deg, #1e293b 0%, #0f172a 100%)",
          border: "1px solid rgba(148,163,184,0.35)",
          borderRadius: 16,
          padding: "1.15rem 1.25rem",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          color: "#e2e8f0",
        }}
      >
        <p style={{ margin: "0 0 0.25rem", fontSize: "0.75rem", color: "#94a3b8", fontWeight: 700 }}>
          اعتماد بالكارد — جلسة الكابتن تبقى نشطة
        </p>
        <h2 id="mgr-card-approval-title" style={{ margin: "0 0 0.35rem", fontSize: "1.2rem", fontWeight: 900 }}>
          موافقات المدير — {approver.name}
        </h2>
        <p style={{ margin: "0 0 0.9rem", fontSize: "0.82rem", color: "#cbd5e1" }}>
          الكابتن الحالي على الجهاز: <strong>{captainLabel}</strong> — بعد الإغلاق يعود لنفس الجلسة دون تبديل.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button" className="btn btn-primary" disabled={busy || !safeBulk.length} onClick={() => void approveAllSafe()}>
            اعتماد الكل الآمن ({safeBulk.length})
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void load()}>
            تحديث
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            إغلاق — رجوع للكابتن
          </button>
        </div>

        {msg ? <p style={{ color: "#fca5a5", fontSize: "0.85rem", marginTop: 0 }}>{msg}</p> : null}
        {busy && rows.length === 0 ? <p style={{ color: "#94a3b8" }}>جارٍ التحميل…</p> : null}
        {!busy && rows.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>لا توجد طلبات معلّقة. يمكن إغلاق اللوحة.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {rows.map((req) => {
              const safe = isSafeBulkApprove(req);
              const table = req.tableLabel || req.tableId || "—";
              const by = req.requestedBy?.name || "—";
              return (
                <li
                  key={req.id}
                  style={{
                    border: "1px solid rgba(148,163,184,0.25)",
                    borderRadius: 12,
                    padding: "0.75rem 0.85rem",
                    background: "rgba(15,23,42,0.55)",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>{typeLabel(req.type)}</div>
                  <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: 8 }}>
                    طاولة {table} · طلب من {by}
                    {req.reason ? ` · ${req.reason}` : ""}
                    {req.requestedAt ? ` · ${req.requestedAt}` : ""}
                    {!safe.ok ? " · يحتاج مراجعة تفصيلية" : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || actingId === req.id || !safe.ok}
                      onClick={() => void approveOne(req)}
                      title={safe.ok ? "اعتماد بالقرار الافتراضي" : "غير متاح من اللوحة السريعة"}
                    >
                      اعتماد
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || actingId === req.id}
                      onClick={() => void patchRequest(req, "reject")}
                      style={{ borderColor: "rgba(248,113,113,0.45)", color: "#fca5a5" }}
                    >
                      رفض
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p style={{ margin: "12px 0 0", fontSize: "0.72rem", color: "#64748b" }}>
          الطلبات التي تحتاج حداً أقصى أو اختيار بديل تُعتمد من صفحة «موافقات المدير». كروت الكباتن أثناء هذه اللوحة لا تبدّل الجلسة.
        </p>
      </div>
    </div>
  );
}
