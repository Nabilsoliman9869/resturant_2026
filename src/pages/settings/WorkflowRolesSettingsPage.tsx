import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type WorkflowSettings = {
  receiveGuestBy: string;
  takeOrderBy: string;
  deliverFromKitchenBy: string;
  cleanTableBy: string;
  checkRequestBy: string;
  cashierDispatchMode: string;
  cleaningStartTrigger: string;
  cleaningExecutionBy: string;
  cleaningReviewBy: string;
  cleaningStartStatus: string;
};

const DEFAULTS: WorkflowSettings = {
  receiveGuestBy: "host",
  takeOrderBy: "waiter",
  deliverFromKitchenBy: "server",
  cleanTableBy: "server",
  checkRequestBy: "waiter",
  cashierDispatchMode: "both",
  cleaningStartTrigger: "payment_completed",
  cleaningExecutionBy: "server",
  cleaningReviewBy: "none",
  cleaningStartStatus: "dirty",
};

const ROLE_OPTIONS = [
  { value: "host", label: "جرسون الاستقبال" },
  { value: "manager", label: "مدير المطعم" },
  { value: "waiter", label: "جرسون الطلبات" },
  { value: "customer_self", label: "العميل نفسه" },
  { value: "server", label: "جرسون المناولة" },
] as const;

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
      const payload = {
        ...s,
        // توحيد مفتاحي التنظيف (قديم/جديد) لمنع أي تضارب في التطبيق.
        cleanTableBy: s.cleaningExecutionBy,
      };
      const r = await fetch(`${base}/api/restaurant/workflow-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يستقبل العميل عند الدخول</h3>
          <select value={s.receiveGuestBy} onChange={(e) => setS((x) => ({ ...x, receiveGuestBy: e.target.value }))} style={{ width: "100%" }}>
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يأخذ طلبات العميل</h3>
          <select value={s.takeOrderBy} onChange={(e) => setS((x) => ({ ...x, takeOrderBy: e.target.value }))} style={{ width: "100%" }}>
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يستلم من المطبخ ويوصل للطاولات</h3>
          <select value={s.deliverFromKitchenBy} onChange={(e) => setS((x) => ({ ...x, deliverFromKitchenBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">نفس جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="host">جرسون الاستقبال</option>
            <option value="kitchen_window">استلام مباشر من نافذة الشيف</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>دور التنظيف (متوافق)</h3>
          <select value={s.cleaningExecutionBy} onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من ينفذ طلب الشيك</h3>
          <select value={s.checkRequestBy} onChange={(e) => setS((x) => ({ ...x, checkRequestBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cashier">الكاشير</option>
            <option value="server">جرسون المناولة</option>
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

        <div className="card">
          <h3 style={{ marginTop: 0 }}>متى يبدأ التنظيف تلقائياً</h3>
          <select value={s.cleaningStartTrigger} onChange={(e) => setS((x) => ({ ...x, cleaningStartTrigger: e.target.value }))} style={{ width: "100%" }}>
            <option value="request_check">عند طلب الحساب</option>
            <option value="payment_completed">عند إتمام الدفع</option>
            <option value="manager_command">بأمر مباشر من المدير</option>
            <option value="waiter_command">بأمر مباشر من جرسون الطلبات</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من ينفذ التنظيف</h3>
          <select value={s.cleaningExecutionBy} onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون المناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>مراجعة/اعتماد التنظيف</h3>
          <select value={s.cleaningReviewBy} onChange={(e) => setS((x) => ({ ...x, cleaningReviewBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="none">بدون مراجعة</option>
            <option value="manager">المدير</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>عند بدء التنظيف تتحول الطاولة إلى</h3>
          <select value={s.cleaningStartStatus} onChange={(e) => setS((x) => ({ ...x, cleaningStartStatus: e.target.value }))} style={{ width: "100%" }}>
            <option value="dirty">متسخة (تحتاج بدء تنظيف)</option>
            <option value="cleaning">قيد التنظيف (بدء مباشر)</option>
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

