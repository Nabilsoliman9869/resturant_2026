import { useCallback, useEffect, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { sessionDisplayName } from "../auth/displayUser";
import {
  GUEST_RETURN_DISPOSITIONS,
  dispositionLabel,
  guestReturnApprovalModeLabel,
  guestReturnItemStageLabel,
  guestReturnKindLabel,
} from "../lib/guestReturnCatalog";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";

type ReturnLine = {
  lineId?: string;
  name?: string;
  returnQty?: number;
  seatNo?: number | null;
  reasonLabel?: string;
  reasonCategory?: string;
  lineStatus?: string;
  orderStatus?: string;
  itemStage?: string;
  itemStageLabel?: string;
  returnKind?: string;
  returnKindLabel?: string;
  approvalMode?: string;
  approvalModeLabel?: string;
  proposedDisposition?: string;
  recommendedDisposition?: string;
  finalDisposition?: string;
  policyHint?: string;
  waiterNote?: string;
  lineDecisionStatus?: string;
};

type ReturnRequest = {
  id: string;
  sessionId?: string;
  tableId?: string;
  tableLabel?: string;
  status?: string;
  requestedAt?: string;
  requestedBy?: { name?: string; role?: string };
  lines?: ReturnLine[];
  managerNote?: string;
  reviewSummary?: {
    pendingCount?: number;
    directEligibleCount?: number;
    cancelIfNotStartedCount?: number;
  };
};

type ReviewDraft = {
  managerNote: string;
  lines: Record<string, string>;
};

const STATUS_AR: Record<string, string> = {
  pending_manager: "بانتظار المدير",
  approved: "معتمد",
  rejected: "مرفوض",
  approved_auto: "اعتماد مباشر",
};

export default function GuestReturnsManagerPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const [rows, setRows] = useState<ReturnRequest[]>([]);
  const [filter, setFilter] = useState<"pending_manager" | "all">("pending_manager");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});

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

  function getDraft(req: ReturnRequest): ReviewDraft {
    const existing = reviewDrafts[req.id];
    if (existing) return existing;
    const lineMap: Record<string, string> = {};
    for (const ln of req.lines || []) {
      const lid = String(ln.lineId || "").trim();
      if (!lid) continue;
      lineMap[lid] = String(ln.finalDisposition || ln.proposedDisposition || ln.recommendedDisposition || "");
    }
    return { managerNote: String(req.managerNote || ""), lines: lineMap };
  }

  function patchDraft(req: ReturnRequest, patch: Partial<ReviewDraft>) {
    const current = getDraft(req);
    setReviewDrafts((prev) => ({
      ...prev,
      [req.id]: {
        managerNote: patch.managerNote ?? current.managerNote,
        lines: patch.lines ?? current.lines,
      },
    }));
  }

  function patchLineDisposition(req: ReturnRequest, lineId: string, value: string) {
    const current = getDraft(req);
    patchDraft(req, {
      lines: { ...current.lines, [lineId]: value },
    });
  }

  async function review(req: ReturnRequest, action: "approve" | "reject") {
    setMsg("");
    try {
      const draft = getDraft(req);
      const r = await fetch(`${base}/api/restaurant/guest-returns/${encodeURIComponent(req.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reviewedBy: {
            userId: user?.id != null ? String(user.id) : "",
            name: sessionDisplayName(user) || "مدير",
            role: user?.role || "manager",
          },
          managerNote: draft.managerNote || (action === "reject" ? "مرفوض من المدير" : ""),
          lines:
            action === "approve"
              ? (req.lines || []).map((ln) => ({
                  lineId: ln.lineId,
                  finalDisposition:
                    draft.lines[String(ln.lineId || "")] || ln.finalDisposition || ln.proposedDisposition || ln.recommendedDisposition || "",
                }))
              : undefined,
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
            {rows.map((req) => {
              const draft = getDraft(req);
              const directEligible = Number(req.reviewSummary?.directEligibleCount || 0);
              const cancelIfNotStarted = Number(req.reviewSummary?.cancelIfNotStartedCount || 0);
              const pendingCount = Number(req.reviewSummary?.pendingCount || 0);
              const approveLabel =
                pendingCount === 0 && (directEligible > 0 || cancelIfNotStarted > 0) ? "اعتماد مباشر" : "اعتماد بالقرار الحالي";
              return (
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

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <span className="badge">{`مراجعة مدير: ${pendingCount}`}</span>
                    <span className="badge" style={{ background: "#eff6ff", color: "#1d4ed8" }}>{`إلغاء قبل التحضير: ${cancelIfNotStarted}`}</span>
                    <span className="badge" style={{ background: "#ecfdf5", color: "#166534" }}>{`اعتماد مباشر: ${directEligible}`}</span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                    {(req.lines || []).map((ln) => {
                      const lid = String(ln.lineId || "");
                      return (
                        <div key={lid} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "#f8fafc" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontWeight: 800 }}>
                                {ln.name} ×{ln.returnQty}
                                {ln.seatNo != null && Number(ln.seatNo) >= 1 ? ` · كرسي ${ln.seatNo}` : ""}
                              </div>
                              <div style={{ color: "var(--muted)", fontSize: "0.84rem", marginTop: 4 }}>
                                <em>{ln.reasonLabel}</em>
                                {ln.reasonCategory ? ` · ${ln.reasonCategory}` : ""}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <span className="badge" style={{ background: "#eef2ff", color: "#4338ca" }}>
                                {guestReturnKindLabel(String(ln.returnKindLabel || ln.returnKind || ""))}
                              </span>
                              <span className="badge" style={{ background: "#fff7ed", color: "#9a3412" }}>
                                {guestReturnApprovalModeLabel(String(ln.approvalModeLabel || ln.approvalMode || ""))}
                              </span>
                              <span className="badge" style={{ background: "#f8fafc", color: "#334155" }}>
                                {guestReturnItemStageLabel(String(ln.itemStage || ln.lineStatus || ln.orderStatus || ""))}
                              </span>
                            </div>
                          </div>

                          {ln.policyHint ? (
                            <div style={{ marginTop: 8, fontSize: "0.84rem", color: "var(--muted)" }}>{ln.policyHint}</div>
                          ) : null}
                          {ln.waiterNote ? (
                            <div style={{ marginTop: 8, fontSize: "0.84rem" }}>
                              ملاحظة الكابتن: <strong>{ln.waiterNote}</strong>
                            </div>
                          ) : null}

                          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                            <label style={{ fontSize: "0.84rem", fontWeight: 700 }}>
                              القرار المالي/التشغيلي
                              <select
                                value={draft.lines[lid] || ""}
                                disabled={String(req.status || "").toLowerCase() !== "pending_manager"}
                                onChange={(e) => patchLineDisposition(req, lid, e.target.value)}
                                style={{ display: "block", width: "100%", marginTop: 4 }}
                              >
                                <option value="">— اختر القرار —</option>
                                {GUEST_RETURN_DISPOSITIONS.map((disp) => (
                                  <option key={disp.code} value={disp.code}>
                                    {disp.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                              مقترح الكابتن: {dispositionLabel(String(ln.proposedDisposition || ""))}
                              {ln.recommendedDisposition ? ` · توصية النظام: ${dispositionLabel(String(ln.recommendedDisposition || ""))}` : ""}
                              {ln.finalDisposition ? ` · القرار المعتمد: ${dispositionLabel(String(ln.finalDisposition || ""))}` : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <label style={{ fontSize: "0.84rem", fontWeight: 700 }}>
                      ملاحظة المدير
                      <textarea
                        value={draft.managerNote}
                        disabled={String(req.status || "").toLowerCase() !== "pending_manager"}
                        onChange={(e) => patchDraft(req, { managerNote: e.target.value.slice(0, 2000) })}
                        rows={3}
                        style={{ display: "block", width: "100%", marginTop: 4 }}
                      />
                    </label>
                  </div>

                  {String(req.status).toLowerCase() === "pending_manager" ? (
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-primary" onClick={() => void review(req, "approve")}>
                        {approveLabel}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => void review(req, "reject")}>
                        رفض
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


