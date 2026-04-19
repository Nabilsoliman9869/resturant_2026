import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type WorkflowSettings = {
  receiveGuestBy: string;
  takeOrderBy: string;
  deliverFromKitchenBy: string;
  cleanTableBy: string;
  checkRequestBy: string;
  cashierDispatchMode: string;
};

const DEFAULTS: WorkflowSettings = {
  receiveGuestBy: "host",
  takeOrderBy: "waiter",
  deliverFromKitchenBy: "server",
  cleanTableBy: "server",
  checkRequestBy: "waiter",
  cashierDispatchMode: "both",
};

export default function WorkflowRolesSettingsPage() {
  const base = getApiBase();
  const [s, setS] = useState<WorkflowSettings>(DEFAULTS);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/workflow-settings`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setS({ ...DEFAULTS, ...(j || {}) });
    } catch (e) {
      setMsg(`تعذر تحميل إعدادات المسارات: ${String(e)}`);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/workflow-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setS({ ...DEFAULTS, ...(j || {}) });
      setMsg("تم حفظ دورة العمل حسب نوع المطعم بنجاح.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>دورة العمل ومسارات الأدوار</h2>
      <p style={{ color: "var(--muted)" }}>
        هذه الشاشة تظهر للمدير والمطور لتحديد من يقوم بكل خطوة تشغيلية. النظام يطبقها في مسارات التشغيل (استقبال، طلب، مناولة، تنظيف، الشيك، واستدعاء الكاشير).
      </p>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يستقبل العميل عند الدخول</h3>
          <select value={s.receiveGuestBy} onChange={(e) => setS((x) => ({ ...x, receiveGuestBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="manager">مدير المطعم</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="captain">كابتن</option>
            <option value="customer_self">العميل نفسه</option>
            <option value="none">لا أحد</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يأخذ طلبات العميل</h3>
          <select value={s.takeOrderBy} onChange={(e) => setS((x) => ({ ...x, takeOrderBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="manager">مدير المطعم</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="captain">كابتن</option>
            <option value="customer_self">العميل نفسه</option>
            <option value="none">لا أحد</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يستلم من المطبخ ويوصل للطاولات</h3>
          <select value={s.deliverFromKitchenBy} onChange={(e) => setS((x) => ({ ...x, deliverFromKitchenBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">نفس جرسون الطلبات</option>
            <option value="kitchen_window">استلام مباشر من نافذة الشيف</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من ينفذ النظافة</h3>
          <select value={s.cleanTableBy} onChange={(e) => setS((x) => ({ ...x, cleanTableBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="cleaner">عامل نظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من ينفذ طلب الشيك</h3>
          <select value={s.checkRequestBy} onChange={(e) => setS((x) => ({ ...x, checkRequestBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cashier">الكاشير</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>عند استدعاء الكاشير</h3>
          <select value={s.cashierDispatchMode} onChange={(e) => setS((x) => ({ ...x, cashierDispatchMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="visa_machine">إرسال ماكينة الفيزا</option>
            <option value="cash_collector">إرسال مندوب تحصيل كاش</option>
            <option value="both">الاثنين معًا</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          حفظ المسارات
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={busy}>
          تحديث
        </button>
      </div>
      {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
    </div>
  );
}

