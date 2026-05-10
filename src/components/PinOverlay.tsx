import { useEffect, useRef, useState } from "react";
import { useTerminalLock, type LockReason } from "../context/TerminalLockContext";
import { useAuth } from "../auth/AuthContext";

const REASON_LABEL: Record<LockReason, string> = {
  manual: "قفل يدوي للجلسة",
  idle: "قفل تلقائي بعد فترة خمول",
  after_save: "قفل تلقائي بعد حفظ عملية",
  after_edit: "قفل تلقائي بعد تعديل",
  after_send: "قفل تلقائي بعد إرسال للمطبخ",
  after_delete: "قفل تلقائي بعد حذف",
  after_discount: "قفل تلقائي بعد تطبيق خصم",
  after_return: "قفل تلقائي بعد مرتجع",
  boot: "تأكيد المستخدم لاستخدام نقطة البيع",
  token_expired: "انتهاء صلاحية جلسة الجهاز",
  hard_logout: "تم الخروج الكامل بسبب الإهمال",
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function PinOverlay() {
  const { user, logout } = useAuth();
  const lock = useTerminalLock();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // لإجبار re-render خلال countdown
  const inputRef = useRef<HTMLInputElement | null>(null);

  // tick كل ثانية أثناء lockout
  useEffect(() => {
    if (!lock.lockState.locked || !lock.lockState.lockoutUntilEpoch) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [lock.lockState.locked, lock.lockState.lockoutUntilEpoch]);

  useEffect(() => {
    if (lock.lockState.locked) {
      setPin("");
      setErr(null);
      // ركّز على حقل PIN
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [lock.lockState.locked]);

  if (!lock.enabled || !lock.lockState.locked) return null;

  const lockoutLeft = (() => {
    const u = lock.lockState.lockoutUntilEpoch;
    if (!u) return 0;
    const left = u - nowSec();
    return left > 0 ? left : 0;
  })();
  const inLockout = lockoutLeft > 0;
  void tick; // فقط لاستخدام المتغير

  const submit = async () => {
    if (busy || inLockout) return;
    if (!pin) {
      setErr("أدخل PIN");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await lock.unlockWithPin(pin, user?.login || "");
    setBusy(false);
    if (!res.ok) {
      setErr(res.error || "فشل التحقق");
      setPin("");
      // ركّز مجدّداً
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const reasonText = lock.lockState.reason
    ? REASON_LABEL[lock.lockState.reason] || "قفل الجهاز"
    : "قفل الجهاز";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mat3am-pin-overlay-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(8,14,28,0.86)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        direction: "rtl",
        fontFamily: "var(--font, system-ui)",
      }}
      onKeyDown={(e) => {
        // امنع Tab خارج المربّع — overlay إجباري
        if (e.key === "Tab") e.preventDefault();
        if (e.key === "Escape") e.preventDefault();
      }}
    >
      <div
        style={{
          width: "min(420px, 92vw)",
          background: "linear-gradient(160deg,#0e1830,#101a36)",
          border: "1px solid #2a3a64",
          borderRadius: 16,
          padding: "1.4rem 1.5rem",
          color: "#eaf1ff",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 22 }}>🔒</div>
          <div>
            <div id="mat3am-pin-overlay-title" style={{ fontWeight: 800, fontSize: "1.1rem" }}>
              نقطة البيع المشتركة — مطلوب PIN
            </div>
            <div style={{ fontSize: ".85rem", color: "#aabae0" }}>
              {reasonText}
            </div>
          </div>
        </div>
        <div
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid #1d2b50",
            borderRadius: 10,
            padding: "0.6rem 0.75rem",
            margin: "0.6rem 0 0.9rem",
            fontSize: ".82rem",
            color: "#cfd9f3",
          }}
        >
          {user?.name || user?.login ? (
            <>
              <strong>{user?.name || user?.login}</strong>
              <span style={{ color: "#8a99c0" }}>{" — يلزم تأكيد الهوية قبل المتابعة."}</span>
            </>
          ) : (
            "ادخل PIN خاص بك للمتابعة."
          )}
        </div>
        <label style={{ display: "block", fontSize: ".85rem", color: "#a9b6da", marginBottom: 6 }}>
          PIN
        </label>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={inLockout || busy}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\s+/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          style={{
            width: "100%",
            padding: "0.7rem 0.85rem",
            borderRadius: 10,
            background: "#0a1228",
            border: "1px solid #2b3b6a",
            color: "#eaf1ff",
            fontSize: "1.15rem",
            letterSpacing: "0.4em",
            textAlign: "center",
          }}
          placeholder="••••"
        />
        {err ? (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: "0.5rem 0.7rem",
              borderRadius: 8,
              background: "rgba(255,80,80,0.12)",
              border: "1px solid rgba(255,80,80,0.45)",
              color: "#ffd0d0",
              fontSize: ".85rem",
            }}
          >
            {err}
          </div>
        ) : null}
        {inLockout ? (
          <div
            style={{
              marginTop: 10,
              padding: "0.5rem 0.7rem",
              borderRadius: 8,
              background: "rgba(255,170,0,0.12)",
              border: "1px solid rgba(255,170,0,0.45)",
              color: "#ffe6b3",
              fontSize: ".85rem",
              textAlign: "center",
            }}
          >
            تم قفل الجهاز مؤقتاً. أعد المحاولة بعد <strong>{lockoutLeft}</strong> ثانية.
          </div>
        ) : null}
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || inLockout || !pin}
            style={{
              flex: 1,
              padding: "0.65rem 1rem",
              borderRadius: 10,
              background: busy || inLockout || !pin ? "#2a3866" : "#3563ff",
              color: "#fff",
              border: 0,
              fontWeight: 700,
              cursor: busy || inLockout || !pin ? "not-allowed" : "pointer",
              fontSize: "1rem",
            }}
          >
            {busy ? "جارٍ التحقق…" : "دخول"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("تسجيل الخروج وإغلاق الجلسة؟")) {
                logout();
              }
            }}
            style={{
              padding: "0.65rem 0.9rem",
              borderRadius: 10,
              background: "transparent",
              color: "#cfd9f3",
              border: "1px solid #2b3b6a",
              cursor: "pointer",
            }}
            title="هذه ليست إلغاء — هي تسجيل خروج كامل (لا يُسمح بإغلاق الـ overlay بدون PIN)"
          >
            خروج كامل
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: ".75rem", color: "#8696bd", textAlign: "center" }}>
          محاولات فاشلة: {lock.lockState.failedAttempts} / {lock.settings.maxAttemptsBeforeLockout}
        </div>
      </div>
    </div>
  );
}
