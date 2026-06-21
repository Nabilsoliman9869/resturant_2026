import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import SettingRow from "../../components/SettingRow";

/** إعدادات التدقيق والامتثال */
type AuditOps = {
  kidsAreaSeparateTickets: string;
  auditRetentionDays: string;
  auditLogClientActions: string;
  deliveryChannelStrictFinancialModes: string;
  enforceRoleScheduleForShift: string;
};

const DEFAULTS: AuditOps = {
  kidsAreaSeparateTickets: "on",
  auditRetentionDays: "365",
  auditLogClientActions: "on",
  deliveryChannelStrictFinancialModes: "on",
  enforceRoleScheduleForShift: "off",
};

export default function AuditComplianceSettingsPage() {
  const base = getApiBase();
  const [s, setS] = useState<AuditOps>(DEFAULTS);
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
      setMsg("تم حفظ إعدادات التدقيق والامتثال بنجاح.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ marginTop: 0 }}>التدقيق والامتثال</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        إعدادات التدقيق، منطقة الأطفال، وجدولة الأدوار. تؤثر على الأمان وحجم البيانات المخزنة.
      </p>

      <div className="grid-2">
        <SettingRow label="الوردية وجدولة الأدوار" tooltip="إلزام وجود جدولة يومية للموظف قبل السماح له بتسجيل الدخول. يمنع الدخول العشوائي.">
          <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
            عند التفعيل، لا يُسمح بتسجيل الدخول لأدوار الصالة (جرسون، استقبال، مناولة، طلبات سريعة) إلا إذا وُجد لهذا المستخدم صف في «جدولة أدوار المستخدمين» يغطي تاريخ اليوم.
          </p>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>إلزام وجود جدولة لليوم قبل الدخول</label>
          <select value={s.enforceRoleScheduleForShift} onChange={(e) => setS((x) => ({ ...x, enforceRoleScheduleForShift: e.target.value }))} style={{ width: "100%" }}>
            <option value="off">معطّل (الافتراضي)</option>
            <option value="on">مفعّل</option>
          </select>
        </SettingRow>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.9rem" }}>
          إعدادات مستقبلية (غير فعّالة حالياً)
        </summary>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <SettingRow label="Kids Area" tooltip="تذاكر منفصلة: هذا الإعداد مسجّل لكن لا يُطبّق حالياً على منطقة الأطفال (تُدار التذاكر منفصلة دائماً).">
            <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>تذاكر منفصلة عن الطاولات</label>
            <select value={s.kidsAreaSeparateTickets} onChange={(e) => setS((x) => ({ ...x, kidsAreaSeparateTickets: e.target.value }))} style={{ width: "100%" }}>
              <option value="on">نعم</option>
              <option value="off">لا</option>
            </select>
          </SettingRow>

          <SettingRow label="التدقيق والقنوات" tooltip="احتفاظ السجلات وتسجيل أحداث الواجهة مستقبليان — لا يوجد حذف تلقائي حالياً. سياسة الدليفري تذكير بدون تنفيذ مالي.">
            <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>احتفاظ سجلات (يوماً)</label>
            <input type="number" min={7} max={3650} value={s.auditRetentionDays} onChange={(e) => setS((x) => ({ ...x, auditRetentionDays: e.target.value }))} style={{ width: "100%" }} />
            <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>تسجيل أحداث الواجهة</label>
            <select value={s.auditLogClientActions} onChange={(e) => setS((x) => ({ ...x, auditLogClientActions: e.target.value }))} style={{ width: "100%" }}>
              <option value="on">مفعّل</option>
              <option value="off">معطّل</option>
            </select>
            <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>سياسة ذمّة الدليفري/المواقع (تذكير)</label>
            <select value={s.deliveryChannelStrictFinancialModes} onChange={(e) => setS((x) => ({ ...x, deliveryChannelStrictFinancialModes: e.target.value }))} style={{ width: "100%" }}>
              <option value="on">تمييز مسارات مالية صارم (موصى به)</option>
              <option value="off">مرن — للمطاعم التي لا تفرّق بعد</option>
            </select>
          </SettingRow>
        </div>
      </details>

      <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>حفظ</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>تحديث</button>
        {busy ? <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>جاري الحفظ...</span> : null}
      </div>
      {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
    </div>
  );
}
