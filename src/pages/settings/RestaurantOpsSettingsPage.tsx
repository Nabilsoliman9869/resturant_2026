import { useEffect, useMemo, useState } from "react";
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
  specialTableDefaultPriceMode: string;
  specialTableDefaultCostMarkupPct: string;
  kidsAreaSeparateTickets: string;
  auditRetentionDays: string;
  auditLogClientActions: string;
  deliveryChannelStrictFinancialModes: string;
  /** عند on: جرسون/استقبال/مناولة/طلبات سريعة يُرفض دخولهم بدون صف جدولة دور يغطي اليوم */
  enforceRoleScheduleForShift: string;
  vipOwnerTemplatesJson: string;
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
  specialTableDefaultPriceMode: "menu",
  specialTableDefaultCostMarkupPct: "0",
  kidsAreaSeparateTickets: "on",
  auditRetentionDays: "365",
  auditLogClientActions: "on",
  deliveryChannelStrictFinancialModes: "on",
  enforceRoleScheduleForShift: "off",
  vipOwnerTemplatesJson: "[]",
};

const FULL_DEFAULTS: RestaurantFullOpsBundle = { ...OPS_DEFAULTS, ...WORKFLOW_SETTINGS_DEFAULTS };

type OwnersVipAgent = { CardGuide: string; AgentName: string };
type VipTemplateRow = {
  id: string;
  agentGuid: string;
  label: string;
  noService: boolean;
  noVat: boolean;
  discountEnabled: boolean;
  discountPct: number;
  costPricingEnabled: boolean;
  costMarkupPct: number;
};

export default function RestaurantOpsSettingsPage() {
  const base = getApiBase();
  const [s, setS] = useState<RestaurantFullOpsBundle>(FULL_DEFAULTS);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [printerMsg, setPrinterMsg] = useState("");
  const [ownersVipAgents, setOwnersVipAgents] = useState<OwnersVipAgent[]>([]);
  const [ownersVipGroupGuide, setOwnersVipGroupGuide] = useState<string>("");
  const [ownersVipAgentNameDraft, setOwnersVipAgentNameDraft] = useState("");
  const [ownersVipAgentBusy, setOwnersVipAgentBusy] = useState(false);
  const [ownersVipAgentMsg, setOwnersVipAgentMsg] = useState("");

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

  async function loadOwnersVipAgents() {
    setOwnersVipAgentMsg("");
    try {
      const r = await fetch(`${base}/api/agents/by-group-name?group_name=${encodeURIComponent("owners&vip")}`);
      const j = (await r.json().catch(() => ({}))) as { agents?: OwnersVipAgent[]; groupGuide?: string; detail?: string };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOwnersVipAgents(Array.isArray(j.agents) ? j.agents : []);
      setOwnersVipGroupGuide(String(j.groupGuide || ""));
    } catch (e) {
      setOwnersVipAgentMsg(`تعذر تحميل مجموعة owners&vip: ${String(e)}`);
      setOwnersVipAgents([]);
      setOwnersVipGroupGuide("");
    }
  }

  useEffect(() => {
    void loadOwnersVipAgents();
  }, [base]);

  async function createOwnersVipAgent() {
    const name = ownersVipAgentNameDraft.trim();
    if (!name) return;
    setOwnersVipAgentBusy(true);
    setOwnersVipAgentMsg("");
    try {
      const r = await fetch(`${base}/api/agents/owners-vip/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AgentName: name }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; detail?: string; deduped?: boolean };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOwnersVipAgentNameDraft("");
      setOwnersVipAgentMsg(j.deduped ? "الاسم موجود بالفعل داخل المجموعة (تم استخدامه)." : "تم إضافة العميل للمجموعة بنجاح.");
      await loadOwnersVipAgents();
    } catch (e) {
      setOwnersVipAgentMsg(`فشل إضافة عميل owners&vip: ${String(e)}`);
    } finally {
      setOwnersVipAgentBusy(false);
    }
  }

  const vipTemplates: VipTemplateRow[] = useMemo(() => {
    const raw = String((s as unknown as { vipOwnerTemplatesJson?: string }).vipOwnerTemplatesJson || "[]").trim();
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x === "object")
        .slice(0, 40)
        .map((x) => {
          const o = x as Partial<VipTemplateRow> & Record<string, unknown>;
          return {
            id: String(o.id || crypto.randomUUID()),
            agentGuid: String(o.agentGuid || ""),
            label: String(o.label || ""),
            noService: Boolean(o.noService),
            noVat: Boolean(o.noVat),
            discountEnabled: Boolean(o.discountEnabled),
            discountPct: Number(o.discountPct || 0),
            costPricingEnabled: Boolean(o.costPricingEnabled),
            costMarkupPct: Number(o.costMarkupPct || 0),
          };
        });
    } catch {
      return [];
    }
  }, [s]);

  function writeVipTemplates(next: VipTemplateRow[]) {
    const safe = next.map((t) => ({
      id: String(t.id || ""),
      agentGuid: String(t.agentGuid || "").toUpperCase(),
      label: String(t.label || ""),
      noService: Boolean(t.noService),
      noVat: Boolean(t.noVat),
      discountEnabled: Boolean(t.discountEnabled),
      discountPct: Number.isFinite(t.discountPct) ? t.discountPct : 0,
      costPricingEnabled: Boolean(t.costPricingEnabled),
      costMarkupPct: Number.isFinite(t.costMarkupPct) ? t.costMarkupPct : 0,
    }));
    setS((x) => ({ ...x, vipOwnerTemplatesJson: JSON.stringify(safe) }));
  }

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
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>تسعير المالك (طريقة قراءة الأسعار)</label>
          <select
            value={s.specialTableDefaultPriceMode}
            onChange={(e) => setS((x) => ({ ...x, specialTableDefaultPriceMode: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="menu">سعر المنيو (الافتراضي)</option>
            <option value="cost_plus">سعر التكلفة + نسبة</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>نسبة فوق التكلفة % (عند اختيار تكلفة + نسبة)</label>
          <input
            type="number"
            min={0}
            max={400}
            step={0.5}
            value={s.specialTableDefaultCostMarkupPct}
            disabled={String(s.specialTableDefaultPriceMode || "").toLowerCase() !== "cost_plus"}
            onChange={(e) => setS((x) => ({ ...x, specialTableDefaultCostMarkupPct: e.target.value }))}
            style={{ width: "100%" }}
            placeholder="مثال: 10 يعني تكلفة + 10%"
          />
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>عملاء owners&vip (TBL015 → TBL016)</h4>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
            هذه هي <strong>مصدر الدروب داون</strong> في شرائح الطاولات. لو أدخلت مجموعة في <code>TBL015</code> لكن لم تنشئ عملاء في <code>TBL016</code>{" "}
            فلن يظهر شيء في Owner/VIP داخل الشريحة.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={ownersVipAgentNameDraft}
              onChange={(e) => setOwnersVipAgentNameDraft(e.target.value)}
              style={{ width: "100%" }}
              placeholder="اسم عميل مالك/شخص مهم…"
            />
            <button type="button" className="btn btn-primary" disabled={ownersVipAgentBusy || !ownersVipAgentNameDraft.trim()} onClick={() => void createOwnersVipAgent()}>
              إضافة
            </button>
            <button type="button" className="btn btn-ghost" disabled={ownersVipAgentBusy} onClick={() => void loadOwnersVipAgents()}>
              تحديث
            </button>
          </div>
          {ownersVipAgentMsg ? <p style={{ marginTop: 8, fontSize: "0.85rem" }}>{ownersVipAgentMsg}</p> : null}
          <div style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--muted)" }}>
            GroupGuide: <code>{ownersVipGroupGuide || "غير موجود"}</code> — العدد: <strong>{ownersVipAgents.length}</strong>
          </div>
          <div style={{ marginTop: 8, maxHeight: 160, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
            {ownersVipAgents.length ? (
              ownersVipAgents.map((a) => (
                <div key={a.CardGuide} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{a.AgentName}</span>
                  <code style={{ opacity: 0.7 }}>{a.CardGuide}</code>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--muted)" }}>لا يوجد عملاء في مجموعة owners&vip حالياً.</div>
            )}
          </div>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>قوالب Owner/VIP (تغذي شرائح الطاولات)</h4>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
            القالب هو “اسم + عميل من <code>TBL016</code>” مع سياسة خصم/بدون ضريبة/بدون خدمة. القالب يظهر في دروب داون الشريحة، وعند تطبيقه تُربَط الجلسة بهذا العميل.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                writeVipTemplates([
                  ...vipTemplates,
                  {
                    id: crypto.randomUUID(),
                    agentGuid: "",
                    label: "",
                    noService: false,
                    noVat: false,
                    discountEnabled: true,
                    discountPct: 0,
                    costPricingEnabled: false,
                    costMarkupPct: 0,
                  },
                ])
              }
            >
              إضافة قالب
            </button>
          </div>
          {vipTemplates.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {vipTemplates.map((t, idx) => (
                <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={t.label}
                      onChange={(e) => {
                        const next = [...vipTemplates];
                        next[idx] = { ...t, label: e.target.value };
                        writeVipTemplates(next);
                      }}
                      style={{ width: "100%" }}
                      placeholder="اسم القالب (يظهر في الشريحة)…"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        const next = vipTemplates.filter((x) => x.id !== t.id);
                        writeVipTemplates(next);
                      }}
                    >
                      حذف
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <label style={{ fontWeight: 700, minWidth: 92 }}>العميل</label>
                    <select
                      value={t.agentGuid}
                      onChange={(e) => {
                        const next = [...vipTemplates];
                        next[idx] = { ...t, agentGuid: e.target.value };
                        writeVipTemplates(next);
                      }}
                      style={{ width: "100%" }}
                    >
                      <option value="">— اختر عميل من owners&vip —</option>
                      {ownersVipAgents.map((a) => (
                        <option key={a.CardGuide} value={a.CardGuide}>
                          {a.AgentName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={t.noService}
                        onChange={(e) => {
                          const next = [...vipTemplates];
                          next[idx] = { ...t, noService: e.target.checked };
                          writeVipTemplates(next);
                        }}
                      />
                      بدون خدمة
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={t.noVat}
                        onChange={(e) => {
                          const next = [...vipTemplates];
                          next[idx] = { ...t, noVat: e.target.checked };
                          writeVipTemplates(next);
                        }}
                      />
                      بدون ضريبة
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={t.discountEnabled}
                        onChange={(e) => {
                          const next = [...vipTemplates];
                          next[idx] = { ...t, discountEnabled: e.target.checked };
                          writeVipTemplates(next);
                        }}
                      />
                      خصم
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={t.discountPct}
                      disabled={!t.discountEnabled}
                      onChange={(e) => {
                        const next = [...vipTemplates];
                        next[idx] = { ...t, discountPct: Number(e.target.value || 0) };
                        writeVipTemplates(next);
                      }}
                      style={{ width: 140 }}
                    />
                    <span style={{ color: "var(--muted)" }}>%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--muted)" }}>لا توجد قوالب حالياً. اضغط “إضافة قالب”.</div>
          )}
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>عرض JSON الحالي</summary>
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(s.vipOwnerTemplatesJson || "[]")}</pre>
          </details>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>الوردية وجدولة الأدوار</h4>
          <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.88rem", lineHeight: 1.45 }}>
            عند التفعيل، لا يُسمح بتسجيل الدخول لأدوار الصالة (جرسون الطلبات، الاستقبال، المناولة، الطلبات السريعة) إلا إذا وُجد لهذا المستخدم{" "}
            <strong>صف في «جدولة أدوار المستخدمين»</strong> يغطي تاريخ اليوم. وإلا تظهر رسالة: «أنت لست ضمن فريق العمل اليوم».
            <br />
            <span style={{ color: "#0f766e", fontWeight: 700 }}>بعد «حفظ الكل» يكفي طلب تسجيل دخول جديد</span> — يُقرأ الإعداد من الملف مباشرة دون إعادة تشغيل الخادم (مع الدمج مع قاعدة البيانات).
          </p>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>إلزام وجود جدولة لليوم قبل الدخول</label>
          <select
            value={s.enforceRoleScheduleForShift}
            onChange={(e) => setS((x) => ({ ...x, enforceRoleScheduleForShift: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="off">معطّل (الافتراضي)</option>
            <option value="on">مفعّل</option>
          </select>
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
