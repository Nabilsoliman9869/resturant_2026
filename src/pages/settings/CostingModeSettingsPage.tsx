import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type ModeCode = "recipe" | "sci" | "hybrid";

export default function CostingModeSettingsPage() {
  const [mode, setMode] = useState<ModeCode>("hybrid");
  const [msg, setMsg] = useState("");

  async function loadMode() {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/costing/mode`);
      const j = await r.json().catch(() => ({}));
      const m = String(j.mode || "hybrid").toLowerCase() as ModeCode;
      if (m === "recipe" || m === "sci" || m === "hybrid") setMode(m);
    } catch (e) {
      setMsg(`تعذر تحميل وضع الاحتساب: ${String(e)}`);
    }
  }

  async function saveMode() {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/costing/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
      setMsg("تم حفظ أساس احتساب التكاليف بنجاح.");
    } catch (e) {
      setMsg(`فشل حفظ أساس الاحتساب: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadMode();
  }, []);

  return (
    <div className="page" style={{ direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>أساس احتساب التكاليف</h2>
      <p style={{ color: "var(--muted)" }}>خياران واضحان للمطور: Recipe أو محرك التحليل الاقتصادي (SCI). ويمكن وضع Hybrid.</p>
      <div className="card">
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input type="radio" checked={mode === "recipe"} onChange={() => setMode("recipe")} />
          <span>Recipe Costing (حسب المشتقات الفعلية)</span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input type="radio" checked={mode === "sci"} onChange={() => setMode("sci")} />
          <span>SCI Engine (تحليل الوجبات بدون كشف Recipe)</span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input type="radio" checked={mode === "hybrid"} onChange={() => setMode("hybrid")} />
          <span>Hybrid (حسب توفر Recipe أو SCI)</span>
        </label>
        <button className="btn btn-primary" onClick={() => void saveMode()}>
          حفظ
        </button>
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith("فشل") || msg.startsWith("تعذر") ? "#ef4444" : "#22c55e" }}>{msg}</div> : null}
    </div>
  );
}

