import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTerminalLock, type DangerOp } from "../context/TerminalLockContext";

type Props = {
  /** نص الزر العادي (قبل التأكيد). */
  label: ReactNode;
  /** المهمة الفعلية التي يجب تنفيذها بعد PIN ناجح (أو فوراً إذا الوضع غير مفعّل). */
  onConfirm: () => Promise<void> | void;
  /** نوع العملية الخطرة — يُرسَل في reason لسجل التدقيق. */
  reason: DangerOp;
  /** يمكن تخطّي PIN لو الـ token الحالي أصدر منذ < freshSeconds (ثانية). افتراضي 60. اضبط 0 لإجبار PIN كل مرة. */
  freshSeconds?: number;
  /** نص توضيحي يظهر فوق حقل PIN (مثلاً «تأكيد خصم 25%»). */
  promptHint?: string;
  /** تنسيق الزر */
  className?: string;
  style?: React.CSSProperties;
  /** لون مميّز (لون عمليات حرجة) */
  variant?: "danger" | "primary" | "warn";
  /** غير مُفعَّل */
  disabled?: boolean;
  /** زر مساعد لإلغاء الوضع المنبسط للـ PIN */
  showCancel?: boolean;
};

const STYLE_BY_VARIANT: Record<NonNullable<Props["variant"]>, React.CSSProperties> = {
  danger:  { background: "#b13a3a", color: "#fff", border: "1px solid #d24c4c" },
  warn:    { background: "#a87000", color: "#fff", border: "1px solid #c98a18" },
  primary: { background: "#2c5fd9", color: "#fff", border: "1px solid #3a72ee" },
};

export function InlinePinConfirm({
  label,
  onConfirm,
  reason,
  freshSeconds = 60,
  promptHint,
  className,
  style,
  variant = "primary",
  disabled,
  showCancel = true,
}: Props) {
  const lock = useTerminalLock();
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // عند تفعيل PIN mode ركّز على الحقل
  useEffect(() => {
    if (pinMode) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [pinMode]);

  const sharedEnabled = lock.enabled && lock.settings.stepUpForDangerOps;

  const runConfirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
      // عند النجاح: نخرج من وضع الـ PIN
      setPin("");
      setPinMode(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  // الحالة 1: الوضع المشترك معطَّل أو step-up معطّل ⇒ زر عادي
  if (!sharedEnabled) {
    return (
      <button
        type="button"
        disabled={disabled || busy}
        className={className}
        onClick={() => void runConfirm()}
        style={{ padding: "0.55rem 1rem", borderRadius: 8, fontWeight: 700, cursor: "pointer", ...STYLE_BY_VARIANT[variant], ...style }}
      >
        {busy ? "جارٍ التنفيذ…" : label}
      </button>
    );
  }

  // الحالة 2: الوضع المشترك مفعَّل + الـ token «طازج» ⇒ زر عادي بدون PIN
  if (lock.isTokenFresh(freshSeconds)) {
    return (
      <button
        type="button"
        disabled={disabled || busy}
        className={className}
        onClick={() => void runConfirm()}
        title="تنفيذ مباشر — الجلسة موثَّقة بـ PIN حديث"
        style={{ padding: "0.55rem 1rem", borderRadius: 8, fontWeight: 700, cursor: "pointer", ...STYLE_BY_VARIANT[variant], ...style }}
      >
        {busy ? "جارٍ التنفيذ…" : label}
      </button>
    );
  }

  // الحالة 3: لازم step-up — أول كبسة على الزر تكشف حقل PIN
  if (!pinMode) {
    return (
      <button
        type="button"
        disabled={disabled || busy}
        className={className}
        onClick={() => setPinMode(true)}
        title="هذه عملية حسّاسة — يلزم تأكيد بـ PIN"
        style={{
          padding: "0.55rem 1rem",
          borderRadius: 8,
          fontWeight: 700,
          cursor: "pointer",
          ...STYLE_BY_VARIANT[variant],
          ...style,
          position: "relative",
        }}
      >
        🔒 {label}
      </button>
    );
  }

  // الحالة 4: PIN mode — يظهر حقل صغير + تأكيد
  const submit = async () => {
    if (!pin) {
      setErr("أدخل PIN");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await lock.stepUp(pin, { reason, freshSeconds });
    if (!r.ok) {
      setBusy(false);
      setErr(r.error || "فشل التحقق");
      setPin("");
      window.setTimeout(() => inputRef.current?.focus(), 30);
      return;
    }
    // PIN ناجح ⇒ ننفّذ المهمة
    await runConfirm();
  };

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: 4,
        borderRadius: 10,
        background: "rgba(255,255,255,0.05)",
        border: "1px dashed " + (variant === "danger" ? "#d24c4c" : variant === "warn" ? "#c98a18" : "#3a72ee"),
        ...style,
      }}
    >
      {promptHint ? (
        <span style={{ fontSize: ".8rem", color: "var(--muted)", padding: "0 6px" }}>{promptHint}</span>
      ) : null}
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        disabled={busy}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\s+/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape" && showCancel) {
            e.preventDefault();
            setPinMode(false);
            setPin("");
            setErr(null);
          }
        }}
        placeholder="PIN"
        style={{
          width: 90,
          padding: "0.45rem 0.6rem",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface, #0a1228)",
          color: "var(--text, #eaf1ff)",
          textAlign: "center",
          letterSpacing: "0.3em",
          fontSize: "1rem",
        }}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !pin}
        style={{
          padding: "0.45rem 0.9rem",
          borderRadius: 6,
          fontWeight: 700,
          cursor: busy || !pin ? "not-allowed" : "pointer",
          ...STYLE_BY_VARIANT[variant],
        }}
      >
        {busy ? "…" : "تأكيد"}
      </button>
      {showCancel ? (
        <button
          type="button"
          onClick={() => { setPinMode(false); setPin(""); setErr(null); }}
          disabled={busy}
          style={{
            padding: "0.45rem 0.7rem",
            borderRadius: 6,
            background: "transparent",
            color: "var(--muted)",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
          title="إلغاء (لن يُنفَّذ شيء)"
        >
          إلغاء
        </button>
      ) : null}
      {err ? (
        <span style={{ color: "#ff9c9c", fontSize: ".75rem", padding: "0 6px" }}>{err}</span>
      ) : null}
    </div>
  );
}
