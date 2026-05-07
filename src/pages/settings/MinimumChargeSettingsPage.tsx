import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { getApiBase } from "../../lib/apiBase";

export default function MinimumChargeSettingsPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const canEdit = user?.role === "manager" || user?.role === "developer";
  const [value, setValue] = useState("0");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setValue(String((j as { tableDefaultMinimumCharge?: string | number }).tableDefaultMinimumCharge ?? "0"));
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!canEdit) return;
    setBusy(true);
    setMsg("");
    try {
      const payload = { tableDefaultMinimumCharge: value };
      const r = await fetch(`${base}/api/restaurant/ops-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setValue(String((j as { tableDefaultMinimumCharge?: string | number }).tableDefaultMinimumCharge ?? value));
      setMsg("تم حفظ minimum charge الافتراضي بنجاح.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>الميني موم تشارج</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        هذه هي القيمة الافتراضية لحد الطاولة الأدنى. يمكن للمدير تعديلها أو جعلها صفرًا.
      </p>
      <div className="card">
        <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>minimum charge الافتراضي</label>
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!canEdit || busy}
          style={{ width: "100%" }}
        />
        {!canEdit ? (
          <div style={{ marginTop: 8, fontSize: "0.84rem", color: "#b45309" }}>التعديل متاح للمدير فقط.</div>
        ) : null}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={!canEdit || busy} onClick={() => void save()}>
          حفظ
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>
          تحديث
        </button>
      </div>
      {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
    </div>
  );
}
