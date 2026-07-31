import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import {
  WORKFLOW_ROLE_OPTIONS,
  WORKFLOW_SETTINGS_DEFAULTS,
  type WorkflowSettings,
} from "../../lib/workflowSettingsModel";

const DEFAULTS = WORKFLOW_SETTINGS_DEFAULTS;


export default function WorkflowRolesSettingsPage() {
  const base = getApiBase();
  const [s, setS] = useState<WorkflowSettings>({ ...WORKFLOW_SETTINGS_DEFAULTS });
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
      <p style={{ color: "var(--muted)", fontSize: "0.88rem", maxWidth: 720 }}>
        نفس المفاتيح تُعاد في <code>GET /api/restaurant/ops-settings</code> مع إعدادات المطبخ؛ الحفظ هنا يحدّث <code>workflow-settings</code> فقط.
      </p>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يستقبل العميل عند الدخول</h3>
          <select value={s.receiveGuestBy} onChange={(e) => setS((x) => ({ ...x, receiveGuestBy: e.target.value }))} style={{ width: "100%" }}>
            {WORKFLOW_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يأخذ طلبات العميل</h3>
          <select value={s.takeOrderBy} onChange={(e) => setS((x) => ({ ...x, takeOrderBy: e.target.value }))} style={{ width: "100%" }}>
            {WORKFLOW_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>قفل الطاولة على كابتن واحد (جرسون الطلبات)</h3>
          <p style={{ marginTop: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
            عند التفعيل: يُقبل إرسال الطلبات وطلب الحساب فقط من المستخدم الذي ضغط «تسكين كابتن» على شريحة الطاولة، أو من المدير بعد التحويل. الافتراضي off لمطاعم لا تريد القفل.
          </p>
          <select
            value={s.orderTakerExclusiveTable}
            onChange={(e) => setS((x) => ({ ...x, orderTakerExclusiveTable: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="off">لا — أي جرسون طلبات يعمل على الطاولة</option>
            <option value="on">نعم — قفل حتى تقفيل الحساب (مع استثناء المدير)</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يستلم من المطبخ ويوصل للطاولات</h3>
          <p style={{ marginTop: 0, marginBottom: 8, fontSize: "0.88rem", color: "var(--wp-muted)" }}>
            مع دور استلام تذهب الأصناف الجاهزة لطابور التسليم. مع «لا أحد» تذهب مباشرة للطاولة بعد إنهاء المطبخ.
          </p>
          <select value={s.deliverFromKitchenBy} onChange={(e) => setS((x) => ({ ...x, deliverFromKitchenBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">نفس جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="operation_manager">مدير التشغيل</option>
            <option value="host">جرسون الاستقبال</option>
            <option value="kitchen_window">استلام مباشر من نافذة الشيف</option>
            <option value="none">لا أحد — مباشرة للطاولة بعد إنهاء المطبخ</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>دور التنظيف (متوافق)</h3>
          <select value={s.cleaningExecutionBy} onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="operation_manager">مدير التشغيل</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من ينفذ طلب الشيك</h3>
          <select value={s.checkRequestBy} onChange={(e) => setS((x) => ({ ...x, checkRequestBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="operation_manager">مدير التشغيل</option>
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
            <option value="operation_manager">مدير التشغيل</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>مراجعة/اعتماد التنظيف</h3>
          <select value={s.cleaningReviewBy} onChange={(e) => setS((x) => ({ ...x, cleaningReviewBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="none">بدون مراجعة</option>
            <option value="manager">المدير</option>
            <option value="operation_manager">مدير التشغيل</option>
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

