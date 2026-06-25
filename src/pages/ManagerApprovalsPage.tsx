import { useCallback, useEffect, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { sessionDisplayName } from "../auth/displayUser";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";

type DecisionOption = {
  id: string;
  label?: string;
  description?: string;
  recommended?: boolean;
  tableStatusOnComplete?: string;
  financialDisposition?: string;
  financialDispositionLabel?: string;
  policyHint?: string;
};

type DecisionFlag = {
  id: string;
  label?: string;
  description?: string;
  default?: boolean;
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
  handoverSummary?: { currentCaptainTables?: number; candidateCount?: number; effectiveRole?: string };
  targetOptions?: Array<{ userId: string; name?: string; login?: string; role?: string }>;
  openOrdersSummary?: {
    orderCount?: number;
    itemCount?: number;
    pendingCount?: number;
    preparingCount?: number;
    readyCount?: number;
    totalValue?: number;
  };
  decisionOptions?: DecisionOption[];
  decisionFlags?: DecisionFlag[];
  managerNote?: string;
  managerReview?: { name?: string; at?: string; decision?: string };
  executionResult?: {
    tableStatusOnComplete?: string;
    decisionLabel?: string;
    financialDispositionLabel?: string;
    policyHint?: string;
    targetUserName?: string;
    transferredCount?: number;
    requesterTerminalAction?: string;
  };
};

type ReviewDraft = {
  decisionId: string;
  managerNote: string;
  targetUserId: string;
  flags: Record<string, boolean>;
};

const STATUS_LABELS: Record<string, string> = {
  pending_manager: "بانتظار المدير",
  approved: "تم الاعتماد",
  rejected: "مرفوض",
};

function initialDraft(req: ApprovalRequest): ReviewDraft {
  const recommended = (req.decisionOptions || []).find((x) => x.recommended) || (req.decisionOptions || [])[0] || null;
  const flags: Record<string, boolean> = {};
  for (const flag of req.decisionFlags || []) {
    const id = String(flag.id || "").trim();
    if (!id) continue;
    flags[id] = Boolean(flag.default);
  }
  return {
    decisionId: String(recommended?.id || ""),
    managerNote: String(req.managerNote || ""),
    targetUserId: String((req.targetOptions || [])[0]?.userId || ""),
    flags,
  };
}

export default function ManagerApprovalsPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [filter, setFilter] = useState<"pending_manager" | "all">("pending_manager");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const q = filter === "pending_manager" ? "?status=pending_manager" : "";
      const r = await fetch(`${base}/api/restaurant/manager-approvals${q}`, { cache: "no-store" });
      const j = tryParseJson<{ requests?: ApprovalRequest[] }>(await r.text()) ?? {};
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
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [load]);

  function getDraft(req: ApprovalRequest): ReviewDraft {
    const existing = drafts[req.id];
    if (existing) return existing;
    return initialDraft(req);
  }

  function patchDraft(req: ApprovalRequest, patch: Partial<ReviewDraft>) {
    const current = getDraft(req);
    setDrafts((prev) => ({
      ...prev,
      [req.id]: {
        decisionId: patch.decisionId ?? current.decisionId,
        managerNote: patch.managerNote ?? current.managerNote,
        targetUserId: patch.targetUserId ?? current.targetUserId,
        flags: patch.flags ?? current.flags,
      },
    }));
  }

  function toggleFlag(req: ApprovalRequest, flagId: string) {
    const current = getDraft(req);
    patchDraft(req, {
      flags: { ...current.flags, [flagId]: !current.flags[flagId] },
    });
  }

  async function review(req: ApprovalRequest, action: "approve" | "reject") {
    setMsg("");
    try {
      const draft = getDraft(req);
      const reqType = String(req.type || "").trim();
      const isGuestSessionRequest = reqType === "guest_session_request";
      if (action === "approve" && !draft.decisionId) {
        setMsg("اختر قراراً رئيسياً أولاً.");
        return;
      }
      if (action === "approve" && (req.targetOptions || []).length > 0 && !draft.targetUserId) {
        setMsg("اختر البديل الذي سيستلم الطاولات.");
        return;
      }
      if (action === "reject" && isGuestSessionRequest && !String(draft.managerNote || "").trim()) {
        setMsg("سبب رفض جلسة الضيف إلزامي.");
        return;
      }
      const r = await fetch(`${base}/api/restaurant/manager-approvals/${encodeURIComponent(req.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          decisionId: action === "approve" ? draft.decisionId : undefined,
          targetUserId: action === "approve" ? draft.targetUserId || undefined : undefined,
          managerNote: draft.managerNote || undefined,
          flags: Object.entries(draft.flags).map(([id, enabled]) => ({ id, enabled })),
          reviewedBy: {
            userId: user?.id != null ? String(user.id) : "",
            name: sessionDisplayName(user) || "مدير",
            role: user?.role || "manager",
          },
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ detail?: string }>(t) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t);
      await load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div className="role-op">
      <OperationalRoleHeader roleTitle="موافقات المدير" hideBack />
      <div className="role-op__main">
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          هذه الصفحة تحسم الطلبات الحساسة القادمة من الصالة. اختر قراراً رئيسياً، ثم فعّل الخيارات الإضافية، وبعدها نفّذ أو ارفض.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className={filter === "pending_manager" ? "btn btn-primary" : "btn btn-ghost"}
            onClick={() => setFilter("pending_manager")}
          >
            المعلّقة
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
          <p style={{ color: "var(--muted)" }}>لا توجد طلبات {filter === "pending_manager" ? "معلّقة" : ""}.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {rows.map((req) => {
              const draft = getDraft(req);
              const summary = req.openOrdersSummary || {};
              const handoverSummary = req.handoverSummary || {};
              const resolved = String(req.status || "").toLowerCase() !== "pending_manager";
              return (
                <div key={req.id} className="card" style={{ padding: "0.9rem 1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <strong>{req.tableLabel || req.tableId || "طاولة"}</strong>
                      <span style={{ marginInlineStart: 8, fontSize: "0.85rem", color: "var(--muted)" }}>
                        {STATUS_LABELS[String(req.status || "").toLowerCase()] || req.status}
                      </span>
                    </div>
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      {req.requestedBy?.name || "مستخدم"} · {req.requestedAt?.slice(0, 16) || ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <span className="badge">{`طلبات: ${Number(summary.orderCount || 0)}`}</span>
                    <span className="badge" style={{ background: "#eff6ff", color: "#1d4ed8" }}>{`Pending: ${Number(summary.pendingCount || 0)}`}</span>
                    <span className="badge" style={{ background: "#fff7ed", color: "#9a3412" }}>{`Preparing: ${Number(summary.preparingCount || 0)}`}</span>
                    <span className="badge" style={{ background: "#ecfdf5", color: "#166534" }}>{`Ready: ${Number(summary.readyCount || 0)}`}</span>
                    <span className="badge" style={{ background: "#f8fafc", color: "#334155" }}>{`قيمة تقريبية: ${Number(summary.totalValue || 0).toFixed(2)}`}</span>
                    {Number(handoverSummary.currentCaptainTables || 0) > 0 ? (
                      <span className="badge" style={{ background: "#eef2ff", color: "#4338ca" }}>{`طاولات الكابتن الحالية: ${Number(handoverSummary.currentCaptainTables || 0)}`}</span>
                    ) : null}
                    {Number(handoverSummary.candidateCount || 0) > 0 ? (
                      <span className="badge" style={{ background: "#f0fdf4", color: "#166534" }}>{`بدائل متاحة: ${Number(handoverSummary.candidateCount || 0)}`}</span>
                    ) : null}
                  </div>

                  {req.reason ? (
                    <div style={{ marginTop: 10, fontSize: "0.88rem" }}>
                      سبب الطالب: <strong>{req.reason}</strong>
                    </div>
                  ) : null}
                    {String(req.type || "").trim() === "guest_session_request" ? (
                      <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#92400e", fontWeight: 800 }}>
                        حالة الجلسة: ضيف مؤقت — ممنوع الإرسال/الحساب حتى يحسم المدير
                      </div>
                    ) : null}

                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    <label style={{ fontSize: "0.84rem", fontWeight: 700 }}>
                      القرار الرئيسي
                      <select
                        value={draft.decisionId}
                        disabled={resolved}
                        onChange={(e) => patchDraft(req, { decisionId: e.target.value })}
                        style={{ width: "100%", marginTop: 4 }}
                      >
                        <option value="">اختر القرار</option>
                        {(req.decisionOptions || []).map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                            {opt.recommended ? " (مقترح)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    {(req.decisionOptions || []).length > 0 ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        {(req.decisionOptions || []).map((opt) => (
                          <div
                            key={opt.id}
                            style={{
                              border: draft.decisionId === opt.id ? "1px solid rgba(59,130,246,0.45)" : "1px solid var(--border)",
                              borderRadius: 10,
                              padding: "0.6rem 0.7rem",
                              background: draft.decisionId === opt.id ? "rgba(59,130,246,0.08)" : "transparent",
                            }}
                          >
                            <div style={{ fontWeight: 800 }}>{opt.label}</div>
                            {opt.description ? <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 4 }}>{opt.description}</div> : null}
                            {opt.financialDispositionLabel ? (
                              <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#9a3412" }}>
                                الأثر المالي: <strong>{opt.financialDispositionLabel}</strong>
                              </div>
                            ) : null}
                            {opt.policyHint ? <div style={{ color: "var(--muted)", fontSize: "0.79rem", marginTop: 4 }}>{opt.policyHint}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {(req.decisionFlags || []).length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: "0.84rem", fontWeight: 700 }}>خيارات إضافية</div>
                        {(req.decisionFlags || []).map((flag) => (
                          <label key={flag.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: resolved ? "default" : "pointer" }}>
                            <input
                              type="checkbox"
                              checked={Boolean(draft.flags[String(flag.id || "")])}
                              disabled={resolved}
                              onChange={() => toggleFlag(req, String(flag.id || ""))}
                              style={{ marginTop: 3 }}
                            />
                            <span>
                              <strong>{flag.label}</strong>
                              {flag.description ? <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 2 }}>{flag.description}</div> : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : null}

                    {(req.targetOptions || []).length > 0 ? (
                      <label style={{ fontSize: "0.84rem", fontWeight: 700 }}>
                        البديل الذي سيستلم
                        <select
                          value={draft.targetUserId}
                          disabled={resolved}
                          onChange={(e) => patchDraft(req, { targetUserId: e.target.value })}
                          style={{ width: "100%", marginTop: 4 }}
                        >
                          <option value="">اختر البديل</option>
                          {(req.targetOptions || []).map((opt) => (
                            <option key={opt.userId} value={opt.userId}>
                              {opt.name || opt.login || opt.userId}
                              {opt.role ? ` - ${opt.role}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    <label style={{ fontSize: "0.84rem", fontWeight: 700 }}>
                      ملاحظة المدير
                      <textarea
                        value={draft.managerNote}
                        disabled={resolved}
                        onChange={(e) => patchDraft(req, { managerNote: e.target.value })}
                        rows={3}
                        style={{ width: "100%", marginTop: 4, resize: "vertical" }}
                        placeholder={
                          String(req.type || "").trim() === "guest_session_request"
                            ? "سبب القرار (إلزامي عند الرفض)"
                            : "اكتب سبب القرار أو التعليمات التنفيذية"
                        }
                      />
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    {!resolved ? (
                      <>
                        <button type="button" className="btn btn-primary" onClick={() => void review(req, "approve")}>
                          تنفيذ القرار
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => void review(req, "reject")}>
                          {String(req.type || "").trim() === "guest_session_request" ? "رفض (سبب إلزامي)" : "رفض وإبقاء الجلسة"}
                        </button>
                      </>
                    ) : null}
                    {resolved && req.managerReview ? (
                      <div style={{ color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.5 }}>
                        <div>
                          {req.managerReview.name || "مدير"} · {req.managerReview.at?.slice(0, 16) || ""}
                          {req.executionResult?.tableStatusOnComplete ? ` · حالة الطاولة: ${req.executionResult.tableStatusOnComplete}` : ""}
                        </div>
                        {req.executionResult?.decisionLabel ? <div>القرار المنفذ: {req.executionResult.decisionLabel}</div> : null}
                        {req.executionResult?.targetUserName ? <div>البديل المختار: {req.executionResult.targetUserName}</div> : null}
                        {req.executionResult?.transferredCount ? <div>عدد الطاولات المحوّلة: {req.executionResult.transferredCount}</div> : null}
                        {req.executionResult?.financialDispositionLabel ? <div>الأثر المالي: {req.executionResult.financialDispositionLabel}</div> : null}
                        {req.executionResult?.requesterTerminalAction === "lock_prompt" ? <div>يوجد تنبيه لمقدم الطلب بإنهاء الجلسة على الجهاز المشترك.</div> : null}
                        {req.executionResult?.policyHint ? <div>{req.executionResult.policyHint}</div> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
