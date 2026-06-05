import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import SettingRow from "../../components/SettingRow";

/** إعدادات طاولة المالك / VIP */
type VipOps = {
  specialTableDefaultNoService: string;
  specialTableDefaultNoVat: string;
  specialTableDefaultDiscountPct: string;
  specialTableDefaultPriceMode: string;
  specialTableDefaultCostMarkupPct: string;
};

const DEFAULTS: VipOps = {
  specialTableDefaultNoService: "off",
  specialTableDefaultNoVat: "off",
  specialTableDefaultDiscountPct: "0",
  specialTableDefaultPriceMode: "menu",
  specialTableDefaultCostMarkupPct: "0",
};

export default function VipOwnerSettingsPage() {
  const base = getApiBase();
  const [s, setS] = useState<VipOps>(DEFAULTS);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setS({ ...DEFAULTS, ...(j as object) });
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setS({ ...DEFAULTS, ...(j as object) });
      setMsg("تم حفظ إعدادات المالك/VIP بنجاح.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>إعدادات المالك / VIP</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        الإعدادات الافتراضية للجلسات على طاولات VIP (VIP 1…5). يمكن للمدير تعديلها يدوياً من شاشة الطلب.
      </p>
      <SettingRow label="طاولة المالك / VIP (افتراضيات)" tooltip="الإعدادات الافتراضية للجلسات على طاولات VIP. تُطبّق تلقائياً عند فتح الجلسة.">
        <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>بدون خدمة</label>
        <select value={s.specialTableDefaultNoService} onChange={(e) => setS((x) => ({ ...x, specialTableDefaultNoService: e.target.value }))} style={{ width: "100%" }}>
          <option value="off">لا</option>
          <option value="on">نعم</option>
        </select>
        <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>بدون ضريبة</label>
        <select value={s.specialTableDefaultNoVat} onChange={(e) => setS((x) => ({ ...x, specialTableDefaultNoVat: e.target.value }))} style={{ width: "100%" }}>
          <option value="off">لا</option>
          <option value="on">نعم</option>
        </select>
        <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>خصم افتراضي %</label>
        <input type="number" min={0} max={100} step={0.5} value={s.specialTableDefaultDiscountPct} onChange={(e) => setS((x) => ({ ...x, specialTableDefaultDiscountPct: e.target.value }))} style={{ width: "100%" }} />
        <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>تسعير المالك (طريقة قراءة الأسعار)</label>
        <select value={s.specialTableDefaultPriceMode} onChange={(e) => setS((x) => ({ ...x, specialTableDefaultPriceMode: e.target.value }))} style={{ width: "100%" }}>
          <option value="menu">سعر المنيو (الافتراضي)</option>
          <option value="cost_plus">سعر التكلفة + نسبة</option>
        </select>
        <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>نسبة فوق التكلفة % (عند اختيار تكلفة + نسبة)</label>
        <input type="number" min={0} max={400} step={0.5} value={s.specialTableDefaultCostMarkupPct} disabled={String(s.specialTableDefaultPriceMode || "").toLowerCase() !== "cost_plus"} onChange={(e) => setS((x) => ({ ...x, specialTableDefaultCostMarkupPct: e.target.value }))} style={{ width: "100%" }} placeholder="مثال: 10 يعني تكلفة + 10%" />
      </SettingRow>
      <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>حفظ</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>تحديث</button>
        {busy ? <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>جاري الحفظ...</span> : null}
      </div>
      {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
    </div>
  );
}
