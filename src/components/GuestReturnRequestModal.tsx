import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import {
  DEFAULT_GUEST_RETURN_REASONS,
  GUEST_RETURN_DISPOSITIONS,
  dispositionLabel,
  guestReturnApprovalModeLabel,
  guestReturnItemStageLabel,
  guestReturnKindLabel,
  groupReasonsByCategory,
  resolveGuestReturnDecision,
  type GuestReturnReason,
} from "../lib/guestReturnCatalog";
import { guestReturnApiErrorMessage, probeGuestReturnsApi } from "../lib/guestReturnApi";
import { briefNetworkHint, safeFetch } from "../lib/safeFetch";
import { tryParseJson } from "../lib/tryParseJson";

export type GuestReturnOrderLine = {
  orderId: string;
  lineId: string;
  productGuide: string;
  name: string;
  quantity: number;
  unitPrice: number;
  seatNo?: number | null;
  lineStatus?: string;
  orderStatus?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  tableId: string;
  tableLabel: string;
  lines: GuestReturnOrderLine[];
  actor: { userId?: string; name?: string; role?: string };
  onSubmitted?: (requestId?: string) => void;
};

type LineDraft = {
  key: string;
  selected: boolean;
  returnQty: number;
  reasonCode: string;
  proposedDisposition: string;
  waiterNote: string;
};

function buildDraftsFromLines(lines: GuestReturnOrderLine[]): LineDraft[] {
  return lines.map((ln) => ({
    key: `${ln.orderId}::${ln.lineId}`,
    selected: false,
    returnQty: ln.quantity,
    reasonCode: "",
    proposedDisposition: "stock_return",
    waiterNote: "",
  }));
}

export default function GuestReturnRequestModal(props: Props) {
  const { open, onClose, sessionId, tableId, tableLabel, lines, actor, onSubmitted } = props;
  const base = getApiBase();
  const [reasons, setReasons] = useState<GuestReturnReason[]>(DEFAULT_GUEST_RETURN_REASONS);
  const [drafts, setDrafts] = useState<LineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [phase, setPhase] = useState<"form" | "success">("form");
  const [successId, setSuccessId] = useState("");
  const [apiReady, setApiReady] = useState<boolean | null>(null);
  const wasOpenRef = useRef(false);
  const frozenLinesRef = useRef<GuestReturnOrderLine[]>([]);

  /** تهيئة النموذج مرة واحدة عند الفتح فقط — لا نعيد التصفير عند تحديث الطلبات في الخلفية */
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      frozenLinesRef.current = lines;
      setDrafts(buildDraftsFromLines(lines));
      setMsg("");
      setPhase("form");
      setSuccessId("");
      setApiReady(null);
      void (async () => {
        const ready = await probeGuestReturnsApi();
        setApiReady(ready);
        if (!ready) {
          setMsg(guestReturnApiErrorMessage(404, "Not Found"));
          return;
        }
        try {
          const r = await safeFetch(`${base}/api/restaurant/guest-return-reasons`);
          const j = tryParseJson<{ reasons?: GuestReturnReason[] }>(await r.text()) ?? {};
          if (r.ok && Array.isArray(j.reasons) && j.reasons.length) setReasons(j.reasons);
        } catch {
          /* defaults */
        }
      })();
    }
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    wasOpenRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lines تُجمَّد عند أول فتح فقط (لقطة من الأب)
  }, [open, base]);

  const displayLines = frozenLinesRef.current.length ? frozenLinesRef.current : lines;

  const grouped = useMemo(() => groupReasonsByCategory(reasons), [reasons]);
  const reasonByCode = useMemo(() => new Map(reasons.map((r) => [r.code, r])), [reasons]);
  const selectedDecisions = useMemo(() => {
    const m = new Map<string, ReturnType<typeof resolveGuestReturnDecision>>();
    for (const d of drafts) {
      if (!d.reasonCode) continue;
      const ln = displayLines.find((x) => `${x.orderId}::${x.lineId}` === d.key);
      if (!ln) continue;
      const reason = reasonByCode.get(d.reasonCode);
      m.set(
        d.key,
        resolveGuestReturnDecision({
          reasonCode: d.reasonCode,
          reasonCategory: reason?.category,
          lineStatus: ln.lineStatus,
          orderStatus: ln.orderStatus,
        }),
      );
    }
    return m;
  }, [displayLines, drafts, reasonByCode]);

  const patchDraft = useCallback((key: string, patch: Partial<LineDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  const requestClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const submit = async () => {
    setMsg("");
    if (apiReady === false) {
      setMsg(guestReturnApiErrorMessage(404, "Not Found"));
      return;
    }
    const picked = drafts.filter((d) => d.selected);
    if (!picked.length) {
      setMsg("اختر بنداً واحداً على الأقل.");
      return;
    }
    for (const d of picked) {
      if (!d.reasonCode) {
        setMsg("حدد سبب المرتجع لكل بند مختار.");
        return;
      }
      if (!d.proposedDisposition) {
        setMsg("حدد طريقة المعالجة لكل بند.");
        return;
      }
    }
    const payloadLines = picked.map((d) => {
      const ln = displayLines.find((x) => `${x.orderId}::${x.lineId}` === d.key)!;
      return {
        orderId: ln.orderId,
        lineId: ln.lineId,
        productGuide: ln.productGuide,
        name: ln.name,
        quantity: ln.quantity,
        returnQty: Math.min(ln.quantity, Math.max(1, d.returnQty)),
        unitPrice: ln.unitPrice,
        seatNo: ln.seatNo,
        reasonCode: d.reasonCode,
        proposedDisposition: d.proposedDisposition,
        waiterNote: d.waiterNote,
        lineStatus: ln.lineStatus,
        orderStatus: ln.orderStatus,
        itemStage: selectedDecisions.get(d.key)?.stage,
        returnKind: selectedDecisions.get(d.key)?.kind,
        approvalMode: selectedDecisions.get(d.key)?.approvalMode,
      };
    });
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/restaurant/guest-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          tableId,
          tableLabel,
          requestedBy: actor,
          lines: payloadLines,
        }),
      });
      const t = await r.text();
      if (r.status === 0) {
        throw new Error(briefNetworkHint("Failed to fetch"));
      }
      const j = tryParseJson<{ detail?: string; request?: { id?: string } }>(t) ?? {};
      if (!r.ok) {
        const detail = typeof j.detail === "string" ? j.detail : t.trim();
        throw new Error(guestReturnApiErrorMessage(r.status, detail));
      }
      const rid = String(j.request?.id || "").trim();
      setSuccessId(rid);
      setPhase("success");
      onSubmitted?.(rid || undefined);
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 12000,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy && phase === "form") requestClose();
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          maxHeight: "min(92vh, 900px)",
          overflow: "auto",
          background: "#fff",
          borderRadius: 14,
          padding: "1rem 1.1rem",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.2rem" }}>طلب مرتجع — الطاولة</h2>
        <p style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.9rem" }}>
          {tableLabel || tableId}
        </p>

        {phase === "success" ? (
          <div
            style={{
              padding: "1rem",
              borderRadius: 10,
              background: "#ecfdf5",
              border: "1px solid #86efac",
              marginBottom: 12,
            }}
          >
            <p style={{ margin: "0 0 0.5rem", fontWeight: 800, color: "#166534" }}>تم استلام الطلب على الخادم</p>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "#15803d" }}>
              {successId
                ? `رقم الطلب: ${successId.slice(0, 8)}… — بانتظار اعتماد المدير من «مرتجعات الضيوف».`
                : "بانتظار اعتماد المدير من «مرتجعات الضيوف»."}
            </p>
          </div>
        ) : displayLines.length === 0 ? (
          <p style={{ color: "var(--danger)" }}>لا توجد بنود مرسلة في هذه الجلسة.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {displayLines.map((ln) => {
              const key = `${ln.orderId}::${ln.lineId}`;
              const d = drafts.find((x) => x.key === key);
              if (!d) return null;
              return (
                <div
                  key={key}
                  style={{
                    border: d.selected ? "2px solid #2563eb" : "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 10,
                    background: d.selected ? "#f8fafc" : "#fff",
                  }}
                >
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={d.selected}
                      disabled={busy}
                      onChange={(e) => patchDraft(key, { selected: e.target.checked })}
                      style={{ marginTop: 4 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800 }}>{ln.name}</div>
                      <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                        طلب {ln.orderId.slice(0, 8)} · أقصى كمية {ln.quantity}
                        {ln.seatNo != null && ln.seatNo >= 1 ? ` · كرسي ${ln.seatNo}` : ""}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            border: "1px solid #bfdbfe",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                          }}
                        >
                          المرحلة: {guestReturnItemStageLabel(resolveGuestReturnDecision({ lineStatus: ln.lineStatus, orderStatus: ln.orderStatus }).stage)}
                        </span>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "#f8fafc",
                            color: "#334155",
                            border: "1px solid #cbd5e1",
                            fontSize: "0.76rem",
                          }}
                        >
                          حالة الطلب: {guestReturnItemStageLabel(ln.orderStatus || ln.lineStatus || "")}
                        </span>
                      </div>
                    </div>
                  </label>
                  {d.selected ? (
                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      <label style={{ fontSize: "0.85rem" }}>
                        كمية الإرجاع
                        <input
                          type="number"
                          min={1}
                          max={ln.quantity}
                          value={d.returnQty}
                          disabled={busy}
                          onChange={(e) =>
                            patchDraft(key, {
                              returnQty: Math.min(ln.quantity, Math.max(1, Number(e.target.value) || 1)),
                            })
                          }
                          style={{ display: "block", width: 80, marginTop: 4 }}
                        />
                      </label>
                      <label style={{ fontSize: "0.85rem" }}>
                        سبب المرتجع
                        <select
                          value={d.reasonCode}
                          disabled={busy}
                          onChange={(e) => {
                            const nextReasonCode = e.target.value;
                            const reason = reasonByCode.get(nextReasonCode);
                            const decision = resolveGuestReturnDecision({
                              reasonCode: nextReasonCode,
                              reasonCategory: reason?.category,
                              lineStatus: ln.lineStatus,
                              orderStatus: ln.orderStatus,
                            });
                            patchDraft(key, {
                              reasonCode: nextReasonCode,
                              proposedDisposition: decision.recommendedDisposition || d.proposedDisposition,
                            });
                          }}
                          style={{ display: "block", width: "100%", marginTop: 4 }}
                        >
                          <option value="">— اختر السبب —</option>
                          {grouped.map((g) => (
                            <optgroup key={g.category} label={g.category}>
                              {g.items.map((r) => (
                                <option key={r.code} value={r.code}>
                                  {r.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      {(() => {
                        const decision = selectedDecisions.get(key);
                        if (!decision) return null;
                        const approvalBg =
                          decision.approvalMode === "manager_review_required"
                            ? "#fff7ed"
                            : decision.approvalMode === "direct_accept_recommended"
                              ? "#ecfdf5"
                              : "#eff6ff";
                        const approvalFg =
                          decision.approvalMode === "manager_review_required"
                            ? "#9a3412"
                            : decision.approvalMode === "direct_accept_recommended"
                              ? "#166534"
                              : "#1d4ed8";
                        return (
                          <div
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: 10,
                              background: "#f8fafc",
                              display: "grid",
                              gap: 6,
                            }}
                          >
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  background: "#eef2ff",
                                  color: "#4338ca",
                                  border: "1px solid #c7d2fe",
                                  fontSize: "0.78rem",
                                  fontWeight: 700,
                                }}
                              >
                                {guestReturnKindLabel(decision.kind)}
                              </span>
                              <span
                                style={{
                                  display: "inline-flex",
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  background: approvalBg,
                                  color: approvalFg,
                                  border: `1px solid ${decision.approvalMode === "manager_review_required" ? "#fdba74" : decision.approvalMode === "direct_accept_recommended" ? "#86efac" : "#93c5fd"}`,
                                  fontSize: "0.78rem",
                                  fontWeight: 700,
                                }}
                              >
                                {guestReturnApprovalModeLabel(decision.approvalMode)}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.84rem", color: "var(--muted)" }}>{decision.policyHint}</div>
                            <div style={{ fontSize: "0.83rem" }}>
                              التوجيه المقترح: <strong>{dispositionLabel(decision.recommendedDisposition)}</strong>
                            </div>
                          </div>
                        );
                      })()}
                      <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8 }} disabled={busy}>
                        <legend style={{ fontSize: "0.85rem", fontWeight: 700 }}>المعالجة المقترحة</legend>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {GUEST_RETURN_DISPOSITIONS.map((disp) => (
                            <label key={disp.code} style={{ display: "flex", gap: 6, fontSize: "0.88rem" }}>
                              <input
                                type="radio"
                                name={`disp-${key}`}
                                disabled={busy}
                                checked={d.proposedDisposition === disp.code}
                                onChange={() => patchDraft(key, { proposedDisposition: disp.code })}
                              />
                              <span>
                                {disp.label}
                                {disp.hint ? (
                                  <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}> — {disp.hint}</span>
                                ) : null}
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <input
                        placeholder="ملاحظة للمدير (اختياري)"
                        value={d.waiterNote}
                        disabled={busy}
                        onChange={(e) => patchDraft(key, { waiterNote: e.target.value.slice(0, 400) })}
                        style={{ width: "100%" }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {msg ? <p style={{ color: "var(--danger)", marginTop: 8, fontWeight: 600 }}>{msg}</p> : null}

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {phase === "success" ? (
            <button type="button" className="btn btn-primary" onClick={requestClose}>
              تم — إغلاق
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !displayLines.length || apiReady === false}
                onClick={() => void submit()}
              >
                {busy ? "جارٍ الإرسال والتحقق…" : apiReady === false ? "أعد تشغيل API أولاً" : "إرسال للمدير"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={requestClose}>
                إلغاء
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
