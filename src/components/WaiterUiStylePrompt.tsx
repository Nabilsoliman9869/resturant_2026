import { useState } from "react";
import {
  WAITER_UI_STYLE_OPTIONS,
  markWaiterUiPromptDone,
  saveOrderTakerMobileUi,
  type OrderTakerMobileUi,
} from "../lib/waiterOrderUiPrefs";

type Props = {
  roleLabel: string;
  onDone: (choice: OrderTakerMobileUi) => void;
};

export function WaiterUiStylePrompt({ roleLabel, onDone }: Props) {
  const [pick, setPick] = useState<OrderTakerMobileUi | null>(null);

  function confirm() {
    if (!pick) return;
    saveOrderTakerMobileUi(pick);
    markWaiterUiPromptDone();
    onDone(pick);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiter-ui-style-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        background: "rgba(15,23,42,0.72)",
        display: "grid",
        placeItems: "center",
        padding: 16,
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
          تجربة — اختيار واجهة الجوال
        </p>
        <h2 id="waiter-ui-style-title" style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", fontWeight: 900 }}>
          أي ستايل تفضّل؟
        </h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.5 }}>
          بعد دخول <strong>{roleLabel}</strong> سيُفتح «طلب للطاولة» مباشرة بالشكل الذي تختاره. يمكنك تغييره لاحقاً من القائمة
          أعلى الشاشة.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {WAITER_UI_STYLE_OPTIONS.map((opt) => {
            const on = pick === opt.id;
            return (
              <label
                key={opt.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "0.85rem 1rem",
                  borderRadius: 12,
                  border: on ? "2px solid #38bdf8" : "1px solid rgba(148,163,184,0.35)",
                  background: on ? "rgba(56,189,248,0.12)" : "rgba(15,23,42,0.5)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="waiter-ui-style"
                  checked={on}
                  onChange={() => setPick(opt.id)}
                  style={{ width: 20, height: 20, marginTop: 2, accentColor: "#38bdf8", flexShrink: 0 }}
                  aria-label={opt.title}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 900, fontSize: "1rem" }}>
                    {opt.num} — {opt.title}
                  </span>
                  <span style={{ display: "block", fontSize: "0.82rem", color: "#94a3b8", marginTop: 4, lineHeight: 1.45 }}>
                    {opt.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.1rem" }}>
          <button type="button" className="btn btn-primary" disabled={!pick} onClick={confirm}>
            ابدأ بهذا الستايل
          </button>
        </div>
      </div>
    </div>
  );
}
