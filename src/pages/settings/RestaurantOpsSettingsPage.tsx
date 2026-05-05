import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import {
  WORKFLOW_ROLE_OPTIONS,
  WORKFLOW_SETTINGS_DEFAULTS,
  type WorkflowSettings,
} from "../../lib/workflowSettingsModel";

/** مفاتيح MAT3AM_RESTAURANT_OPS_SETTINGS + ملف restaurant_ops_settings.json */
export type RestaurantOpsSettings = {
  kitchenOutputMode: string;
  kitchenPrepBoardLayout: string;
  kitchenPrintTicketMode: string;
  kitchenPrintShowTableChip: string;
  kitchenPrinterDeviceHint: string;
  specialTableDefaultNoService: string;
  specialTableDefaultNoVat: string;
  specialTableDefaultDiscountPct: string;
  kidsAreaSeparateTickets: string;
  auditRetentionDays: string;
  auditLogClientActions: string;
  deliveryChannelStrictFinancialModes: string;
};

export type RestaurantFullOpsBundle = RestaurantOpsSettings & WorkflowSettings;

const OPS_DEFAULTS: RestaurantOpsSettings = {
  kitchenOutputMode: "screens",
  kitchenPrepBoardLayout: "per_station",
  kitchenPrintTicketMode: "batch_only",
  kitchenPrintShowTableChip: "on",
  kitchenPrinterDeviceHint: "",
  specialTableDefaultNoService: "off",
  specialTableDefaultNoVat: "off",
  specialTableDefaultDiscountPct: "0",
  kidsAreaSeparateTickets: "on",
  auditRetentionDays: "365",
  auditLogClientActions: "on",
  deliveryChannelStrictFinancialModes: "on",
};

const FULL_DEFAULTS: RestaurantFullOpsBundle = { ...OPS_DEFAULTS, ...WORKFLOW_SETTINGS_DEFAULTS };

export default function RestaurantOpsSettingsPage() {
  const base = getApiBase();
  const [s, setS] = useState<RestaurantFullOpsBundle>(FULL_DEFAULTS);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [printerMsg, setPrinterMsg] = useState("");

  async function load() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setS({ ...FULL_DEFAULTS, ...(j as object) } as RestaurantFullOpsBundle);
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
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
        cleanTableBy: s.cleaningExecutionBy,
      };
      const r = await fetch(`${base}/api/restaurant/ops-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setS({ ...FULL_DEFAULTS, ...(j as object) } as RestaurantFullOpsBundle);
      setMsg("تم حفظ الإعدادات (تشغيل المطعم + دورة العمل) بنجاح.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function testPrinter() {
    setPrinterMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings/printer-test`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setPrinterMsg(String((j as { message?: string }).message || (await r.text())));
    } catch (e) {
      setPrinterMsg(String(e));
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>إعدادات التشغيل الشاملة</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", maxWidth: 820 }}>
        مسار واحد: <code>GET/PUT /api/restaurant/ops-settings</code> — يدمج مفاتيح <strong>دورة العمل</strong> (جدول{" "}
        <code>MAT3AM_WORKFLOW_SETTINGS</code> وملف <code>workflow_settings.json</code>) مع <strong>تشغيل المطبخ والطباعة وVIP والكيدز والتدقيق</strong> (
        <code>MAT3AM_RESTAURANT_OPS_SETTINGS</code> و<code>restaurant_ops_settings.json</code>). الحفظ يوزّع تلقائياً بين المخزنين دون ازدواج يدوي.
      </p>

      <h3 style={{ marginTop: "1.25rem", marginBottom: "0.5rem", fontSize: "1.05rem" }}>دورة العمل ومسارات الأدوار</h3>
      <div className="grid-2">
        <div className="card">
          <h4 style={{ marginTop: 0 }}>من يستقبل العميل عند الدخول</h4>
          <select value={s.receiveGuestBy} onChange={(e) => setS((x) => ({ ...x, receiveGuestBy: e.target.value }))} style={{ width: "100%" }}>
            {WORKFLOW_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>من يأخذ طلبات العميل</h4>
          <select value={s.takeOrderBy} onChange={(e) => setS((x) => ({ ...x, takeOrderBy: e.target.value }))} style={{ width: "100%" }}>
            {WORKFLOW_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>قفل الطاولة على كابتن واحد (جرسون الطلبات)</h4>
          <p style={{ marginTop: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            عند التفعيل: يُقبل إرسال الطلبات وطلب الحساب فقط من مستخدم «تسكين كابتن» أو المدير/المطوّر.
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
          <h4 style={{ marginTop: 0 }}>من يستلم من المطبخ ويوصل للطاولات</h4>
          <select value={s.deliverFromKitchenBy} onChange={(e) => setS((x) => ({ ...x, deliverFromKitchenBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">نفس جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="host">جرسون الاستقبال</option>
            <option value="kitchen_window">استلام مباشر من نافذة الشيف</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>دور التنظيف (تنفيذ)</h4>
          <select
            value={s.cleaningExecutionBy}
            onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="server">جرسون مناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>من ينفذ طلب الشيك</h4>
          <select value={s.checkRequestBy} onChange={(e) => setS((x) => ({ ...x, checkRequestBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cashier">الكاشير</option>
            <option value="server">جرسون المناولة</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>عند استدعاء الكاشير</h4>
          <select value={s.cashierDispatchMode} onChange={(e) => setS((x) => ({ ...x, cashierDispatchMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="visa_machine">إرسال ماكينة الفيزا</option>
            <option value="cash_collector">إرسال مندوب تحصيل كاش</option>
            <option value="both">الاثنين معًا</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>متى يبدأ التنظيف تلقائياً</h4>
          <select value={s.cleaningStartTrigger} onChange={(e) => setS((x) => ({ ...x, cleaningStartTrigger: e.target.value }))} style={{ width: "100%" }}>
            <option value="request_check">عند طلب الحساب</option>
            <option value="payment_completed">عند إتمام الدفع</option>
            <option value="manager_command">بأمر مباشر من المدير</option>
            <option value="waiter_command">بأمر مباشر من جرسون الطلبات</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>من ينفذ التنظيف</h4>
          <select
            value={s.cleaningExecutionBy}
            onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="server">جرسون المناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>مراجعة/اعتماد التنظيف</h4>
          <select value={s.cleaningReviewBy} onChange={(e) => setS((x) => ({ ...x, cleaningReviewBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="none">بدون مراجعة</option>
            <option value="manager">المدير</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>عند بدء التنظيف تتحول الطاولة إلى</h4>
          <select value={s.cleaningStartStatus} onChange={(e) => setS((x) => ({ ...x, cleaningStartStatus: e.target.value }))} style={{ width: "100%" }}>
            <option value="dirty">متسخة (تحتاج بدء تنظيف)</option>
            <option value="cleaning">قيد التنظيف (بدء مباشر)</option>
          </select>
        </div>
      </div>

      <h3 style={{ marginTop: "1.5rem", marginBottom: "0.5rem", fontSize: "1.05rem" }}>مطبخ، طباعة، VIP، كيدز، تدقيق</h3>
      <div className="grid-2">
        <div className="card">
          <h4 style={{ marginTop: 0 }}>مخرجات المطبخ</h4>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>الوضع</label>
          <select value={s.kitchenOutputMode} onChange={(e) => setS((x) => ({ ...x, kitchenOutputMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="screens">شاشات فقط (KDS)</option>
            <option value="printers">طابعات فقط</option>
            <option value="both">شاشات + طابعات</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>لوحة التحضير</label>
          <select
            value={s.kitchenPrepBoardLayout}
            onChange={(e) => setS((x) => ({ ...x, kitchenPrepBoardLayout: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="per_station">شاشة/قائمة لكل محطة أو شيف</option>
            <option value="expeditor_single">شاشة واحدة لمدير المطبخ / الفرشجي</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>طباعة المطبخ</h4>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>نمط التذكرة</label>
          <select
            value={s.kitchenPrintTicketMode}
            onChange={(e) => setS((x) => ({ ...x, kitchenPrintTicketMode: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="batch_only">ما يُرسل في هذه الدفعة فقط</option>
            <option value="aggregated_summary">ملخص مُجمَّع (مثل شريط المطبخ)</option>
            <option value="delta_net">صافي «مزيلة» (مطلوب − منفّذ + الحالي)</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>طباعة بديل عن شريحة الطاولة</label>
          <select
            value={s.kitchenPrintShowTableChip}
            onChange={(e) => setS((x) => ({ ...x, kitchenPrintShowTableChip: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="on">نعم</option>
            <option value="off">لا</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>تلميح جهاز الطابعة (اختياري)</label>
          <input
            value={s.kitchenPrinterDeviceHint}
            onChange={(e) => setS((x) => ({ ...x, kitchenPrinterDeviceHint: e.target.value }))}
            style={{ width: "100%" }}
            placeholder="اسم الطابعة أو المسار — للربط لاحقاً"
          />
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => void testPrinter()}>
            اختبار توصيل الطابعة (مهيأ)
          </button>
          {printerMsg ? <p style={{ marginTop: 8, fontSize: "0.85rem" }}>{printerMsg}</p> : null}
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>طاولة المالك / VIP (افتراضيات المدير)</h4>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
            تُطبَّق تلقائياً على الجلسات التي تُفتح على طاولات <strong>VIP 1…5</strong> (معرفات ثابتة في البيانات الافتراضية والمخطط). يمكن للمدير تعديلها يدوياً من شاشة الطلب إن لزم.
          </p>
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
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={s.specialTableDefaultDiscountPct}
            onChange={(e) => setS((x) => ({ ...x, specialTableDefaultDiscountPct: e.target.value }))}
            style={{ width: "100%" }}
          />
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>Kids Area</h4>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>تذاكر منفصلة عن الطاولات</label>
          <select value={s.kidsAreaSeparateTickets} onChange={(e) => setS((x) => ({ ...x, kidsAreaSeparateTickets: e.target.value }))} style={{ width: "100%" }}>
            <option value="on">نعم</option>
            <option value="off">لا</option>
          </select>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>التدقيق والقنوات</h4>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>احتفاظ سجلات (يوماً)</label>
          <input
            type="number"
            min={7}
            max={3650}
            value={s.auditRetentionDays}
            onChange={(e) => setS((x) => ({ ...x, auditRetentionDays: e.target.value }))}
            style={{ width: "100%" }}
          />
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>تسجيل أحداث الواجهة</label>
          <select value={s.auditLogClientActions} onChange={(e) => setS((x) => ({ ...x, auditLogClientActions: e.target.value }))} style={{ width: "100%" }}>
            <option value="on">مفعّل</option>
            <option value="off">معطّل</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>سياسة ذمّة الدليفري/المواقع (تذكير)</label>
          <select
            value={s.deliveryChannelStrictFinancialModes}
            onChange={(e) => setS((x) => ({ ...x, deliveryChannelStrictFinancialModes: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="on">تمييز مسارات مالية صارم (موصى به)</option>
            <option value="off">مرن — للمطاعم التي لا تفرّق بعد</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          حفظ الكل
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={busy}>
          تحديث
        </button>
      </div>
      {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
    </div>
  );
}
