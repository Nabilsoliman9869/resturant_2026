import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { buildMat3amActor } from "../lib/mat3amActor";
import {
  formatReferenceCacheSummary,
  REFERENCE_DATA_REFRESH_OK,
  type ReferenceCacheStatus,
} from "../lib/referenceDataPolicy";
import { tryParseJson } from "../lib/tryParseJson";

type Props = {
  /** عرض خيار تضمين المستخدمين (أقصر TTL — افتراضي مفعّل للمطوّر) */
  showUsersOption?: boolean;
  compact?: boolean;
};

export default function ReferenceDataRefreshPanel({ showUsersOption = true, compact }: Props) {
  const { user } = useAuth();
  const base = getApiBase();
  const role = String(user?.role || "").toLowerCase();
  const allowed = role === "manager" || role === "developer";

  const [status, setStatus] = useState<ReferenceCacheStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeUsers, setIncludeUsers] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/mat3am/reference-data/status`);
      const j = tryParseJson<ReferenceCacheStatus>(await r.text());
      if (j) setStatus(j);
    } catch {
      /* ignore */
    }
  }, [base]);

  useEffect(() => {
    if (allowed) void loadStatus();
  }, [allowed, loadStatus]);

  async function refreshNow() {
    const actor = buildMat3amActor(user);
    if (!actor) {
      setMsg("سجّل الدخول أولاً.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/mat3am/reference-data/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mat3amActor: actor, includeUsers }),
      });
      const raw = await r.text();
      const j = tryParseJson<Record<string, unknown>>(raw);
      if (!r.ok) {
        const detail = (j?.detail as string) || raw || `HTTP ${r.status}`;
        throw new Error(detail);
      }
      const ms = j?.elapsedMs;
      setMsg(
        `${REFERENCE_DATA_REFRESH_OK}${typeof ms === "number" ? ` (${ms} ms)` : ""}`,
      );
      await loadStatus();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return null;

  return (
    <div
      className="card"
      style={{
        marginBottom: compact ? 10 : 14,
        borderInlineStart: "4px solid rgba(34, 197, 94, 0.5)",
      }}
    >
      <h3 style={{ marginTop: 0, fontSize: compact ? "1rem" : undefined }}>بيانات النظام المرجعية</h3>
      <p style={{ fontSize: "0.88rem", color: "var(--muted)", marginTop: -4, lineHeight: 1.5 }}>
        بعد تعديل أصناف أو مجموعات في SQL، اضغط «تحديث الآن» ليعكس التطبيق التغيير دون انتظار انتهاء
        مهلة الكاش. القراءة اليومية تستخدم الذاكرة/المرآة فقط عند تفعيل{" "}
        <code>MAT3AM_REFERENCE_CACHE_ONLY</code>.
      </p>
      <p style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{formatReferenceCacheSummary(status)}</p>
      {showUsersOption ? (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={includeUsers}
            onChange={(e) => setIncludeUsers(e.target.checked)}
            disabled={busy}
          />
          تضمين مستخدمي التطبيق (MAT3AM_APP_USERS)
        </label>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void refreshNow()}>
          {busy ? "جاري التحديث…" : "تحديث بيانات النظام الآن"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void loadStatus()}>
          عرض الحالة
        </button>
      </div>
      {msg ? (
        <p style={{ marginTop: 10, color: "var(--accent2)", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>
          {msg}
        </p>
      ) : null}
    </div>
  );
}
