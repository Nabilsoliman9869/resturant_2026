import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { playInterDeptInboxBeep } from "../lib/kdsBeep";
import type { RoleId } from "../auth/roles";

type Mat3amActorPayload = { id: string; login: string; name: string; role: string };

/** استطلاع أسرع حتى تصل الرسائل بين الأقسام بلا انتظار طويل (كان 8 ث). */
/** استطلاع الوارد — أبطأ لتقليل ضغط ODBC على Railway */
/** مزامنة مع RESTAURANT_POLL_MS — تقليل ضغط ODBC على Railway */
const POLL_MS = 18_000;

type InboxItem = {
  id: string;
  type?: string;
  title?: string;
  body?: string | null;
  createdAt?: string;
  transferRequestId?: string;
  sessionId?: string;
};

/** أدوار يمكن إرسال تنبيه عام إليها (معرّف API = RoleId) */
const SEND_TARGET_OPTIONS: { id: RoleId; label: string }[] = [
  { id: "cashier", label: "كاشير" },
  { id: "waiter", label: "جرسون طلبات" },
  { id: "host", label: "استقبال" },
  { id: "kitchen", label: "مطبخ" },
  { id: "manager", label: "مدير" },
  { id: "developer", label: "مطوّر" },
  { id: "accountant", label: "محاسب" },
  { id: "server", label: "مناولة" },
];

/**
 * جرس أحمر — وارد موجّه لهذا الدور (عدد على الشارة، قائمة، إخفاء بالتشيك)
 * جرس أخضر — صادر: إرسال تنبيه عام بدون طاولة للأدوار المختارة
 *
 * تنبيهات الطاولة تظهر على بطاقة الطاولة وعلى خريطة الصالة فقط — لا جرس ثالث هنا.
 */
export function RestaurantDualBells({
  role,
  userId,
  mat3amActor,
}: {
  role: RoleId;
  userId?: string;
  mat3amActor?: Mat3amActorPayload | null;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        zIndex: 50000,
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <RedInboxBell role={role} userId={userId} mat3amActor={mat3amActor} />
      <GreenSendBell currentRole={role} />
    </div>
  );
}

function RedInboxBell({
  role,
  userId,
  mat3amActor,
}: {
  role: RoleId;
  userId?: string;
  mat3amActor?: Mat3amActorPayload | null;
}) {
  const base = getApiBase();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyTransferId, setBusyTransferId] = useState<string | null>(null);
  const [transferMsg, setTransferMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const inboxBases = ["/api/restaurant/cashier/role-inbox", "/api/restaurant/role-inbox"];
  const seenIdsRef = useRef<Set<string>>(new Set());
  const skipBeepRef = useRef(true);

  const load = useCallback(async () => {
    try {
      setLoadErr("");
      let lastErr = "";
      const uidQ =
        userId && String(userId).trim()
          ? `&userId=${encodeURIComponent(String(userId).trim())}`
          : "";
      for (const p of inboxBases) {
        const r = await fetch(`${base}${p}?forRole=${encodeURIComponent(role)}${uidQ}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        const txt = await r.text();
        const j = tryParseJson<{ items?: InboxItem[] }>(txt) ?? {};
        if (r.ok) {
          const next = Array.isArray(j.items) ? j.items : [];
          if (skipBeepRef.current) {
            skipBeepRef.current = false;
            for (const it of next) {
              if (it?.id) seenIdsRef.current.add(String(it.id));
            }
          } else {
            let hasNew = false;
            for (const it of next) {
              const id = String(it?.id || "");
              if (!id) continue;
              if (!seenIdsRef.current.has(id)) {
                seenIdsRef.current.add(id);
                hasNew = true;
              }
            }
            if (hasNew) playInterDeptInboxBeep();
          }
          setItems(next);
          return;
        }
        if (r.status !== 404) {
          lastErr = txt.slice(0, 120) || `HTTP ${r.status}`;
          break;
        }
        lastErr = txt.slice(0, 120) || `HTTP ${r.status}`;
      }
      setLoadErr(lastErr || "HTTP 404");
    } catch (e) {
      setLoadErr(String(e));
    }
  }, [base, role, inboxBases, userId]);

  useEffect(() => {
    skipBeepRef.current = true;
    seenIdsRef.current = new Set();
  }, [role, userId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const acceptCaptainTransfer = async (transferRequestId: string) => {
    setTransferMsg("");
    if (!mat3amActor?.id) {
      setTransferMsg("تعذّر تحديد المستخدم للقبول.");
      return;
    }
    setBusyTransferId(transferRequestId);
    try {
      const r = await fetch(
        `${base}/api/restaurant/captain-transfer-requests/${encodeURIComponent(transferRequestId)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mat3amActor }),
        },
      );
      const txt = await r.text();
      if (!r.ok) {
        const j = tryParseJson<{ detail?: unknown }>(txt);
        const d = j?.detail;
        setTransferMsg(typeof d === "string" ? d : txt.slice(0, 160) || `HTTP ${r.status}`);
        return;
      }
      setTransferMsg("تم قبول التحويل — أصبحت مسند هذه الطاولة.");
      await load();
    } catch (e) {
      setTransferMsg(String(e));
    } finally {
      setBusyTransferId(null);
    }
  };

  const dismiss = async (id: string) => {
    setBusyId(id);
    try {
      for (const p of inboxBases) {
        const r = await fetch(`${base}${p}/${encodeURIComponent(id)}/dismiss`, { method: "PATCH" });
        if (r.ok) {
          await load();
          break;
        }
        if (r.status !== 404) break;
      }
    } finally {
      setBusyId(null);
    }
  };

  const n = items.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "relative",
          border: "2px solid rgba(185,28,28,0.9)",
          borderRadius: 999,
          width: 46,
          height: 46,
          cursor: "pointer",
          background: "linear-gradient(145deg,#fecaca,#dc2626)",
          boxShadow: "0 4px 14px rgba(220,38,38,0.4)",
          display: "grid",
          placeItems: "center",
          fontSize: "1.25rem",
        }}
        title="الجرس الأحمر — إشعارات موجّهة لك (غير مرتبطة بطاولة أو عامة من المطبخ/زميل)"
        aria-label="وارد"
      >
        🔔
        <span
          style={{
            position: "absolute",
            top: -5,
            right: -5,
            minWidth: 22,
            height: 22,
            borderRadius: 999,
            background: n > 0 ? "#7f1d1d" : "#991b1b",
            color: "#fff",
            fontSize: "0.72rem",
            fontWeight: 900,
            display: "grid",
            placeItems: "center",
            padding: "0 5px",
            opacity: n > 0 ? 1 : 0.55,
          }}
        >
          {n > 99 ? "99+" : n}
        </span>
      </button>

      {loadErr ? (
        <div style={{ fontSize: "0.68rem", color: "#f87171", maxWidth: 200, lineHeight: 1.35 }} title={loadErr}>
          تعذّر تحميل الوارد — تحقق من اتصال الـ API ({loadErr.slice(0, 80)}
          {loadErr.length > 80 ? "…" : ""})
        </div>
      ) : null}

      {open ? (
        <div
          style={{
            background: "rgba(15,23,42,0.96)",
            border: "1px solid rgba(248,113,113,0.45)",
            borderRadius: 12,
            padding: "0.65rem 0.75rem",
            maxHeight: 380,
            overflowY: "auto",
            boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
            fontSize: "0.82rem",
            direction: "rtl",
            textAlign: "right",
            width: 320,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6, fontSize: "0.9rem", color: "#fca5a5" }}>
            وارد — موجّه لك ({role})
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 10, lineHeight: 1.45 }}>
            ضع علامة ✓ بجانب الرسالة لتخفيها. تنبيهات الطاولة تظهر على <strong>بطاقة الطاولة</strong> و<strong>خريطة الصالة</strong>.
            {userId ? null : (
              <span style={{ display: "block", marginTop: 6, color: "#fbbf24" }}>
                لتلقي طلبات تحويل الكابتن يجب أن يكون معرّف المستخدم متاحاً من تسجيل الدخول.
              </span>
            )}
          </div>
          {transferMsg ? (
            <div
              style={{
                fontSize: "0.78rem",
                marginBottom: 8,
                color: transferMsg.startsWith("تم") ? "#86efac" : "#fca5a5",
                lineHeight: 1.4,
              }}
            >
              {transferMsg}
            </div>
          ) : null}
          {items.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>لا توجد إشعارات موجّهة لك الآن.</div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {items.map((it) => (
                <li
                  key={it.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      cursor: busyId === it.id ? "wait" : "pointer",
                      margin: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={busyId === it.id}
                      title="تجاهل وأخفِ"
                      onChange={(e) => {
                        if (e.target.checked) void dismiss(it.id);
                        e.target.checked = false;
                      }}
                      style={{ marginTop: 4, width: 18, height: 18, flexShrink: 0 }}
                    />
                    <span style={{ flex: 1 }}>
                      <strong>{it.title || it.type || "تنبيه"}</strong>
                      {it.body ? <div style={{ color: "var(--muted)", marginTop: 4 }}>{it.body}</div> : null}
                      <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>
                        {(it.createdAt || "").replace("T", " ").slice(0, 19)}
                      </div>
                      {it.type === "captain_transfer_request" && it.transferRequestId && mat3amActor?.id ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ marginTop: 8, width: "100%", fontWeight: 800 }}
                          disabled={busyTransferId === it.transferRequestId || busyId === it.id}
                          onClick={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            void acceptCaptainTransfer(it.transferRequestId!);
                          }}
                        >
                          {busyTransferId === it.transferRequestId ? "جاري القبول…" : "قبول التحويل"}
                        </button>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function GreenSendBell({ currentRole }: { currentRole: RoleId }) {
  const base = getApiBase();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targets, setTargets] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const x of SEND_TARGET_OPTIONS) o[x.id] = false;
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const toggle = (id: RoleId) => {
    setTargets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const send = async () => {
    setMsg("");
    const list = SEND_TARGET_OPTIONS.filter((x) => targets[x.id]).map((x) => x.id);
    if (list.length === 0) {
      setMsg("اختر دوراً واحداً على الأقل يستلم التنبيه.");
      return;
    }
    const ti = title.trim();
    const tx = body.trim();
    if (!ti && !tx) {
      setMsg("اكتب عنواناً أو نصاً للرسالة.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "waiter_summon",
          scope: "global",
          targetRoles: list,
          title: ti || "تنبيه من الزميل",
          body: tx || undefined,
          message: ti || undefined,
          sourceKey: `broadcast:${currentRole}:${Date.now()}`,
        }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
      setMsg("تم إرسال التنبيه للأدوار المختارة.");
      setTitle("");
      setBody("");
      setTargets(() => {
        const o: Record<string, boolean> = {};
        for (const x of SEND_TARGET_OPTIONS) o[x.id] = false;
        return o;
      });
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          border: "2px solid rgba(22,163,74,0.9)",
          borderRadius: 999,
          width: 46,
          height: 46,
          cursor: "pointer",
          background: "linear-gradient(145deg,#bbf7d0,#16a34a)",
          boxShadow: "0 4px 14px rgba(22,163,74,0.35)",
          display: "grid",
          placeItems: "center",
          fontSize: "1.25rem",
        }}
        title="الجرس الأخضر — إرسال تنبيه عام لزملاء (بدون طاولة)"
        aria-label="إرسال تنبيه"
      >
        🔔
      </button>

      {open ? (
        <div
          style={{
            background: "rgba(15,23,42,0.96)",
            border: "1px solid rgba(34,197,94,0.45)",
            borderRadius: 12,
            padding: "0.75rem 0.85rem",
            maxHeight: 420,
            overflowY: "auto",
            boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
            fontSize: "0.82rem",
            direction: "rtl",
            textAlign: "right",
            width: 320,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6, fontSize: "0.9rem", color: "#86efac" }}>صادر — تنبيه عام</div>
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 10, lineHeight: 1.45 }}>
            يصل للزملاء في الجرس <strong style={{ color: "#fca5a5" }}>الأحمر</strong> عندهم. أنت الآن:{" "}
            <strong>{currentRole}</strong>
          </div>

          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ fontWeight: 700 }}>العنوان</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: مطلوب كاشير عند الباب"
              style={{
                width: "100%",
                marginTop: 4,
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.06)",
                color: "inherit",
              }}
            />
          </label>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ fontWeight: 700 }}>النص</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="تفاصيل اختيارية…"
              rows={3}
              style={{
                width: "100%",
                marginTop: 4,
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.06)",
                color: "inherit",
                resize: "vertical",
              }}
            />
          </label>

          <div style={{ fontWeight: 700, marginBottom: 4 }}>يُرسل إلى:</div>
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 8, lineHeight: 1.45 }}>
            فعّل كل دور يجب أن يرى الرسالة في جرسه الأحمر (مثلاً للمطبخ يجب تفعيل «مطبخ» — لا يُفترض تلقائياً).
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
            {SEND_TARGET_OPTIONS.filter((opt) => opt.id !== currentRole).map((opt) => (
              <label
                key={opt.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  padding: "4px 6px",
                  borderRadius: 8,
                  background: targets[opt.id] ? "rgba(34,197,94,0.15)" : "transparent",
                }}
              >
                <input type="checkbox" checked={!!targets[opt.id]} onChange={() => toggle(opt.id)} />
                {opt.label}
              </label>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            style={{ width: "100%", marginBottom: 8 }}
            onClick={() => void send()}
          >
            {busy ? "جاري الإرسال…" : "إرسال التنبيه"}
          </button>
          {msg ? (
            <div style={{ fontSize: "0.78rem", color: msg.startsWith("تم") ? "#86efac" : "var(--danger)" }}>{msg}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
