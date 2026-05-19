import { markWaiterUiPromptDone } from "../lib/waiterOrderUiPrefs";
import { WAITER_HUB_PATH } from "../lib/waiterNav";

type Props = {
  roleLabel: string;
  onDone: () => void;
};

const FLOW_STEPS = [
  { emoji: "1️⃣", title: "شريحات الطاولات", desc: "اختر طاولة وافتح الجلسة — نقطة البداية بعد الدخول." },
  { emoji: "2️⃣", title: "طلب للطاولة", desc: "ضيوف → منيو → سلة → مرسل. أسماء الضيوف في تبويب «ضيوف» فقط." },
  { emoji: "☰", title: "قائمة واحدة للصالة", desc: "استلام المطبخ، لوحة الصالة، والخروج — من ☰ (جوال) أو القائمة الجانبية." },
];

export function WaiterUiStylePrompt({ roleLabel, onDone }: Props) {
  const confirm = () => {
    markWaiterUiPromptDone();
    onDone();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiter-ui-style-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        background: "rgba(15,23,42,0.78)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        direction: "rtl",
      }}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          background: "linear-gradient(165deg, #1e293b 0%, #0f172a 100%)",
          border: "1px solid rgba(148,163,184,0.35)",
          borderRadius: 16,
          padding: "1.25rem 1.35rem",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          color: "#e2e8f0",
        }}
      >
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.78rem", color: "#94a3b8", fontWeight: 700 }}>
          تدفق الجرسون
        </p>
        <h2 id="waiter-ui-style-title" style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", fontWeight: 900 }}>
          مرحباً {roleLabel}
        </h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.55 }}>
          تنقّل واحد من الدخول حتى الطلب — بدون قوائم مكررة.
        </p>
        <ol style={{ margin: "0 0 1rem", padding: "0 1.1rem", fontSize: "0.86rem", lineHeight: 1.65 }}>
          {FLOW_STEPS.map((s) => (
            <li key={s.title} style={{ marginBottom: 10 }}>
              <strong>
                {s.emoji} {s.title}
              </strong>
              — {s.desc}
            </li>
          ))}
        </ol>
        <p style={{ margin: "0 0 1rem", fontSize: "0.8rem", color: "#94a3b8" }}>
          ستبدأ من شريحات الطاولات ({WAITER_HUB_PATH.replace("/app/waiter/", "")}).
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-primary" onClick={confirm}>
            ابدأ من الشريحات
          </button>
        </div>
      </div>
    </div>
  );
}
