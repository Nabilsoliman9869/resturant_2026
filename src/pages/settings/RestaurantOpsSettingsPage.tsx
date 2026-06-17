import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import SmartProductSearch from "../../components/SmartProductSearch";
import SettingRow from "../../components/SettingRow";
import SettingTooltip from "../../components/SettingTooltip";
import {
  WORKFLOW_ROLE_OPTIONS,
  WORKFLOW_SETTINGS_DEFAULTS,
  type WorkflowSettings,
} from "../../lib/workflowSettingsModel";

/** مفاتيح MAT3AM_RESTAURANT_OPS_SETTINGS + ملف restaurant_ops_settings.json */
export type RestaurantOpsSettings = {
  kitchenOutputMode: string;
  kitchenPrepBoardLayout: string;
  kitchenExecutionMode: string;
  kitchenSpecialistStationsJson: string;
  kitchenSpecialistChefsJson: string;
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
  /** وضع اختيار الأصناف عند الكابتن: classic (عادي) | wizard (معالج موجّه) */
  captainItemSelectionMode: string;
};

export type RestaurantFullOpsBundle = RestaurantOpsSettings & WorkflowSettings;

const OPS_DEFAULTS: RestaurantOpsSettings = {
  kitchenOutputMode: "screens",
  kitchenPrepBoardLayout: "per_station",
  kitchenExecutionMode: "current",
  kitchenSpecialistStationsJson: "[]",
  kitchenSpecialistChefsJson: "[]",
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
  captainItemSelectionMode: "classic",
};

const FULL_DEFAULTS: RestaurantFullOpsBundle = { ...OPS_DEFAULTS, ...WORKFLOW_SETTINGS_DEFAULTS };

type OwnersVipAgent = { CardGuide: string; AgentName: string };
type ProductRow = { CardGuide: string; ProductName: string; GroupGuid?: string | null };
type AuthUserRow = { id: string; login: string; name: string; role: string; isActive: boolean; specialistStationCode?: string };
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
type KitchenSpecialistChefRow = {
  id: string;
  label: string;
  jobTitle: string;
  active: boolean;
  stationCode: string;
  userId: string;
  userLogin: string;
  productGuids: string[];
};
type KitchenSpecialistStationRow = {
  id: string;
  label: string;
  jobTitle: string;
  active: boolean;
  stationCode: string;
};

function normalizeStationCode(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 80)
    .replace(/^_+|_+$/g, "");
}

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
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productsMsg, setProductsMsg] = useState("");
  const [chefUsers, setChefUsers] = useState<AuthUserRow[]>([]);
  const [chefUsersMsg, setChefUsersMsg] = useState("");

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

  async function loadProducts() {
    setProductsMsg("");
    try {
      const r = await fetch(`${base}/api/products`);
      const j = (await r.json().catch(() => ({}))) as { products?: ProductRow[]; detail?: string };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setProducts(Array.isArray(j.products) ? j.products : []);
    } catch (e) {
      setProducts([]);
      setProductsMsg(`تعذر تحميل قائمة الأصناف: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, [base]);

  async function loadChefUsers() {
    setChefUsersMsg("");
    try {
      const r = await fetch(`${base}/api/auth/users`);
      const j = (await r.json().catch(() => ({}))) as { users?: AuthUserRow[]; detail?: string };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      const rows = Array.isArray(j.users) ? j.users : [];
      setChefUsers(rows.filter((u) => u && u.isActive && String(u.role || "").trim().toLowerCase() === "kitchen_specialist"));
    } catch (e) {
      setChefUsers([]);
      setChefUsersMsg(`تعذر تحميل مستخدمي الشيف المختص: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadChefUsers();
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

  const kitchenSpecialistChefs: KitchenSpecialistChefRow[] = useMemo(() => {
    const raw = String((s as { kitchenSpecialistChefsJson?: string }).kitchenSpecialistChefsJson || "[]").trim();
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x === "object")
        .slice(0, 60)
        .map((x) => {
          const o = x as Partial<KitchenSpecialistChefRow> & Record<string, unknown>;
          return {
            id: String(o.id || crypto.randomUUID()),
            label: String(o.label || ""),
            jobTitle: String(o.jobTitle || ""),
            active: o.active !== false,
            stationCode: String(o.stationCode || "").trim().toLowerCase(),
            userId: String(o.userId || "").trim().toUpperCase(),
            userLogin: String(o.userLogin || "").trim().toLowerCase(),
            productGuids: Array.isArray(o.productGuids)
              ? o.productGuids.map((g) => String(g || "").trim().toUpperCase()).filter(Boolean)
              : [],
          };
        });
    } catch {
      return [];
    }
  }, [s]);

  const kitchenSpecialistStations: KitchenSpecialistStationRow[] = useMemo(() => {
    const raw = String((s as { kitchenSpecialistStationsJson?: string }).kitchenSpecialistStationsJson || "[]").trim();
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x === "object")
        .slice(0, 80)
        .map((x) => {
          const o = x as Partial<KitchenSpecialistStationRow> & Record<string, unknown>;
          return {
            id: String(o.id || crypto.randomUUID()),
            label: String(o.label || ""),
            jobTitle: String(o.jobTitle || ""),
            active: o.active !== false,
            stationCode: String(o.stationCode || "").trim().toLowerCase(),
          };
        });
    } catch {
      return [];
    }
  }, [s]);

  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) {
      const id = String(p.CardGuide || "").trim().toUpperCase();
      if (!id) continue;
      m.set(id, String(p.ProductName || "").trim() || id);
    }
    return m;
  }, [products]);

  const chefStationStats = useMemo(() => {
    const m = new Map<string, { code: string; users: AuthUserRow[] }>();
    for (const u of chefUsers) {
      const code = String(u.specialistStationCode || "").trim().toLowerCase();
      if (!code) continue;
      if (!m.has(code)) m.set(code, { code, users: [] });
      m.get(code)!.users.push(u);
    }
    return m;
  }, [chefUsers]);

  const stationByCode = useMemo(() => {
    const m = new Map<string, KitchenSpecialistStationRow>();
    for (const station of kitchenSpecialistStations) {
      const code = normalizeStationCode(station.stationCode || "");
      if (!code) continue;
      m.set(code, { ...station, stationCode: code });
    }
    return m;
  }, [kitchenSpecialistStations]);

  const assignmentByStationCode = useMemo(() => {
    const m = new Map<string, KitchenSpecialistChefRow>();
    for (const row of kitchenSpecialistChefs) {
      const code = normalizeStationCode(row.stationCode || "");
      if (!code) continue;
      m.set(code, { ...row, stationCode: code });
    }
    return m;
  }, [kitchenSpecialistChefs]);

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

  function writeKitchenSpecialistChefs(next: KitchenSpecialistChefRow[]) {
    const safe = next.map((row) => ({
      id: String(row.id || crypto.randomUUID()),
      label: String(row.label || "").trim().slice(0, 120),
      jobTitle: String(row.jobTitle || "").trim().slice(0, 120),
      active: row.active !== false,
      stationCode: normalizeStationCode(row.stationCode || ""),
      // الإسناد التشغيلي صار على مستوى المحطة المشتركة لا المستخدم الفردي.
      userId: "",
      userLogin: "",
      productGuids: Array.from(new Set((row.productGuids || []).map((g) => String(g || "").trim().toUpperCase()).filter(Boolean))),
    }));
    setS((x) => ({ ...x, kitchenSpecialistChefsJson: JSON.stringify(safe) }));
  }

  function writeKitchenSpecialistStations(next: KitchenSpecialistStationRow[]) {
    const previousById = new Map(kitchenSpecialistStations.map((row) => [row.id, normalizeStationCode(row.stationCode || "")]));
    const safeStations = next.map((row) => ({
      id: String(row.id || crypto.randomUUID()),
      label: String(row.label || "").trim().slice(0, 120),
      jobTitle: String(row.jobTitle || "").trim().slice(0, 120),
      active: row.active !== false,
      stationCode: normalizeStationCode(row.stationCode || ""),
    }));
    const renameByOldCode = new Map<string, string>();
    for (const row of safeStations) {
      const oldCode = previousById.get(row.id) || "";
      const newCode = normalizeStationCode(row.stationCode || "");
      if (oldCode && newCode && oldCode !== newCode) renameByOldCode.set(oldCode, newCode);
    }
    const allowedCodes = new Set(safeStations.map((row) => normalizeStationCode(row.stationCode || "")).filter(Boolean));
    const nextAssignments = kitchenSpecialistChefs
      .map((row) => {
        let code = normalizeStationCode(row.stationCode || "");
        if (renameByOldCode.has(code)) code = renameByOldCode.get(code) || code;
        if (!code || !allowedCodes.has(code)) return null;
        const station = safeStations.find((x) => normalizeStationCode(x.stationCode || "") === code);
        return {
          ...row,
          stationCode: code,
          label: station?.label || row.label,
          jobTitle: station?.jobTitle || row.jobTitle,
          active: station ? station.active : row.active,
        };
      })
      .filter((x): x is KitchenSpecialistChefRow => Boolean(x));
    setS((x) => ({
      ...x,
      kitchenSpecialistStationsJson: JSON.stringify(safeStations),
      kitchenSpecialistChefsJson: JSON.stringify(
        nextAssignments.map((row) => ({
          id: String(row.id || crypto.randomUUID()),
          label: String(row.label || "").trim().slice(0, 120),
          jobTitle: String(row.jobTitle || "").trim().slice(0, 120),
          active: row.active !== false,
          stationCode: normalizeStationCode(row.stationCode || ""),
          userId: "",
          userLogin: "",
          productGuids: Array.from(new Set((row.productGuids || []).map((g) => String(g || "").trim().toUpperCase()).filter(Boolean))),
        })),
      ),
    }));
  }

  function writeStationAssignment(stationCode: string, productGuids: string[]) {
    const code = normalizeStationCode(stationCode || "");
    if (!code) return;
    const station = stationByCode.get(code);
    const rest = kitchenSpecialistChefs.filter((row) => normalizeStationCode(row.stationCode || "") !== code);
    const next: KitchenSpecialistChefRow[] = [
      ...rest,
      {
        id: assignmentByStationCode.get(code)?.id || crypto.randomUUID(),
        label: station?.label || code,
        jobTitle: station?.jobTitle || "",
        active: station?.active !== false,
        stationCode: code,
        userId: "",
        userLogin: "",
        productGuids: Array.from(new Set(productGuids.map((g) => String(g || "").trim().toUpperCase()).filter(Boolean))),
      },
    ];
    writeKitchenSpecialistChefs(next);
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
        <SettingRow label="من يستقبل العميل عند الدخول" tooltip="يُحدّد أي دور يستقبل العميل عند وصوله. يؤثر على شاشة الاستقبال وتوزيع المهام.">
          <select value={s.receiveGuestBy} onChange={(e) => setS((x) => ({ ...x, receiveGuestBy: e.target.value }))} style={{ width: "100%" }}>
            {WORKFLOW_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </SettingRow>

        <SettingRow label="من يأخذ طلبات العميل" tooltip="يُحدّد من يُسجّل الطلبات على الطاولة. يؤثر على شاشة POS للجرسون.">
          <select value={s.takeOrderBy} onChange={(e) => setS((x) => ({ ...x, takeOrderBy: e.target.value }))} style={{ width: "100%" }}>
            {WORKFLOW_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </SettingRow>

        <SettingRow label="قفل الطاولة على كابتن واحد" tooltip="عند التفعيل: يُقبل إرسال الطلبات وطلب الحساب فقط من مستخدم «تسكين كابتن» أو المدير. يمنع تداخل الجرسون على نفس الطاولة.">
          <p style={{ marginTop: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            عند التفعيل: يُقبل إرسال الطلبات وطلب الحساب فقط من مستخدم «تسكين كابتن» أو المدير/المطوّر.
          </p>
          <select value={s.orderTakerExclusiveTable} onChange={(e) => setS((x) => ({ ...x, orderTakerExclusiveTable: e.target.value }))} style={{ width: "100%" }}>
            <option value="off">لا — أي جرسون طلبات يعمل على الطاولة</option>
            <option value="on">نعم — قفل حتى تقفيل الحساب (مع استثناء المدير)</option>
          </select>
        </SettingRow>

        <SettingRow label="من يستلم من المطبخ ويوصل للطاولات" tooltip="يُحدّد من يتولى توصيل الطلبات الجاهزة من المطبخ للطاولات.">
          <select value={s.deliverFromKitchenBy} onChange={(e) => setS((x) => ({ ...x, deliverFromKitchenBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">نفس جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="host">جرسون الاستقبال</option>
            <option value="kitchen_window">استلام مباشر من نافذة الشيف</option>
          </select>
        </SettingRow>

        <SettingRow label="دور التنظيف (تنفيذ)" tooltip="من يقوم بتنظيف الطاولة فعلياً بعد انتهاء الجلسة.">
          <select value={s.cleaningExecutionBy} onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </SettingRow>

        <SettingRow label="كيفية اختيار الأصناف عند الكابتن" tooltip="وضع اختيار الأصناف: العادي (إضافات مسطحة) أو المعالج (تدفق موجّه خطوة بخطوة).">
          <select value={s.captainItemSelectionMode} onChange={(e) => setS((x) => ({ ...x, captainItemSelectionMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="classic">عادي — إضافات مسطحة كما هو الآن</option>
            <option value="wizard">معالج — تدفق موجّه خطوة بخطوة (مثل Toast)</option>
          </select>
        </SettingRow>

        <SettingRow label="من ينفذ طلب الشيك" tooltip="من يحق له طباعة أو إرسال طلب الحساب للكاشير.">
          <select value={s.checkRequestBy} onChange={(e) => setS((x) => ({ ...x, checkRequestBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cashier">الكاشير</option>
            <option value="server">جرسون المناولة</option>
          </select>
        </SettingRow>

        <SettingRow label="عند استدعاء الكاشير" tooltip="ما يحدث عندما يضغط الجرسون على زر 'استدعاء كاشير'.">
          <select value={s.cashierDispatchMode} onChange={(e) => setS((x) => ({ ...x, cashierDispatchMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="visa_machine">إرسال ماكينة الفيزا</option>
            <option value="cash_collector">إرسال مندوب تحصيل كاش</option>
            <option value="both">الاثنين معًا</option>
          </select>
        </SettingRow>

        <SettingRow label="متى يبدأ التنظيف تلقائياً" tooltip="الحدث الذي يُشغّل تغيير حالة الطاولة إلى 'متسخة' أو 'قيد التنظيف'.">
          <select value={s.cleaningStartTrigger} onChange={(e) => setS((x) => ({ ...x, cleaningStartTrigger: e.target.value }))} style={{ width: "100%" }}>
            <option value="request_check">عند طلب الحساب</option>
            <option value="payment_completed">عند إتمام الدفع</option>
            <option value="manager_command">بأمر مباشر من المدير</option>
            <option value="waiter_command">بأمر مباشر من جرسون الطلبات</option>
          </select>
        </SettingRow>

        <SettingRow label="من ينفذ التنظيف" tooltip="نفس 'دور التنظيف' — من يقوم بالتنظيف الفعلي.">
          <select value={s.cleaningExecutionBy} onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون المناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </SettingRow>

        <SettingRow label="مراجعة/اعتماد التنظيف" tooltip="من يُحقّق من أن الطاولة نظيفة قبل تغيير حالتها إلى 'جاهزة'.">
          <select value={s.cleaningReviewBy} onChange={(e) => setS((x) => ({ ...x, cleaningReviewBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="none">بدون مراجعة</option>
            <option value="manager">المدير</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </SettingRow>

        <SettingRow label="عند بدء التنظيف تتحول الطاولة إلى" tooltip="الحالة التي تنتقل إليها الطاولة فوراً عند بدء التنظيف.">
          <select value={s.cleaningStartStatus} onChange={(e) => setS((x) => ({ ...x, cleaningStartStatus: e.target.value }))} style={{ width: "100%" }}>
            <option value="dirty">متسخة (تحتاج بدء تنظيف)</option>
            <option value="cleaning">قيد التنظيف (بدء مباشر)</option>
          </select>
        </SettingRow>
      </div>

      <h3 style={{ marginTop: "1.5rem", marginBottom: "0.5rem", fontSize: "1.05rem" }}>مطبخ، طباعة، VIP، كيدز، تدقيق</h3>
      <div className="grid-2">
        <SettingRow label="مخرجات المطبخ" tooltip="كيف يُعرض الطلبات في المطبخ: شاشات KDS أو طابعات أو كلاهما. يؤثر على شاشة الطباخ فقط.">
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>الوضع</label>
          <select value={s.kitchenOutputMode} onChange={(e) => setS((x) => ({ ...x, kitchenOutputMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="screens">شاشات فقط (KDS)</option>
            <option value="printers">طابعات فقط</option>
            <option value="both">شاشات + طابعات</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>لوحة التحضير</label>
          <select value={s.kitchenPrepBoardLayout} onChange={(e) => setS((x) => ({ ...x, kitchenPrepBoardLayout: e.target.value }))} style={{ width: "100%" }}>
            <option value="per_station">شاشة/قائمة لكل محطة أو شيف</option>
            <option value="expeditor_single">شاشة واحدة لمدير المطبخ / الفرشجي</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>نمط تشغيل المطبخ</label>
          <select value={s.kitchenExecutionMode} onChange={(e) => setS((x) => ({ ...x, kitchenExecutionMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="current">استخدام النظام الحالي (مدير المطبخ هو المسؤول العام)</option>
            <option value="specialist_chefs">استخدام نظام الشيف المختص</option>
          </select>
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            عند اختيار <strong>نظام الشيف المختص</strong> تبقى شاشة مدير المطبخ العامة كما هي، ويُفعَّل معها تعريف الشيفات المختصين وأصناف كل شيف من هذه الصفحة.
          </p>
        </SettingRow>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="setting-card-header">
            <h4 style={{ marginTop: 0 }}>نظام الشيف المختص</h4>
            <SettingTooltip title="نظام الشيف المختص">
              يقسم المطبخ إلى محطات متخصصة (مثل شواء، معجنات، سلطة)، كل محطة مسؤولة عن أصناف محددة. يتطلب تعريف المحطات وربط الأصناف بها.
            </SettingTooltip>
          </div>
          <div
            style={{
              marginBottom: 10,
              padding: "0.7rem 0.8rem",
              borderRadius: 10,
              border: "1px solid rgba(56,189,248,0.25)",
              background: s.kitchenExecutionMode === "specialist_chefs" ? "rgba(14,165,233,0.08)" : "rgba(148,163,184,0.08)",
              color: "var(--muted)",
              fontSize: "0.85rem",
            }}
          >
            {s.kitchenExecutionMode === "specialist_chefs"
              ? "الوضع المختص محدد الآن."
              : "التجهيز متاح، والتفعيل يكون من نمط تشغيل المطبخ."}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                writeKitchenSpecialistStations([
                  ...kitchenSpecialistStations,
                  { id: crypto.randomUUID(), label: "", jobTitle: "", active: true, stationCode: "" },
                ])
              }
            >
              إضافة محطة
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void loadProducts()}>
              تحديث الأصناف
            </button>
          </div>
          {productsMsg ? <p style={{ marginTop: 0, fontSize: "0.85rem" }}>{productsMsg}</p> : null}
          {chefUsersMsg ? <p style={{ marginTop: 0, fontSize: "0.85rem" }}>{chefUsersMsg}</p> : null}
          <div style={{ marginBottom: 10, fontSize: "0.82rem", color: "var(--muted)" }}>المحطات تُعرّف هنا مرة واحدة، ثم ترتبط بها المستخدمون والأصناف والشاشات.</div>
          {kitchenSpecialistStations.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>لا توجد محطات مختصة بعد.</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>تعريف المحطات</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {kitchenSpecialistStations.map((station, idx) => (
                    <div key={station.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) auto auto", gap: 8, alignItems: "center" }}>
                        <input
                          value={station.label}
                          onChange={(e) => {
                            const next = [...kitchenSpecialistStations];
                            next[idx] = { ...station, label: e.target.value };
                            writeKitchenSpecialistStations(next);
                          }}
                          placeholder="اسم المحطة"
                          style={{ width: "100%" }}
                        />
                        <input
                          value={station.jobTitle}
                          onChange={(e) => {
                            const next = [...kitchenSpecialistStations];
                            next[idx] = { ...station, jobTitle: e.target.value };
                            writeKitchenSpecialistStations(next);
                          }}
                          placeholder="الوصف التشغيلي"
                          style={{ width: "100%" }}
                        />
                        <input
                          value={station.stationCode}
                          onChange={(e) => {
                            const next = [...kitchenSpecialistStations];
                            next[idx] = { ...station, stationCode: normalizeStationCode(e.target.value) };
                            writeKitchenSpecialistStations(next);
                          }}
                          placeholder="stationCode"
                          style={{ width: "100%" }}
                        />
                        <label style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                          <input
                            type="checkbox"
                            checked={station.active}
                            onChange={(e) => {
                              const next = [...kitchenSpecialistStations];
                              next[idx] = { ...station, active: e.target.checked };
                              writeKitchenSpecialistStations(next);
                            }}
                          />
                          نشط
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => writeKitchenSpecialistStations(kitchenSpecialistStations.filter((x) => x.id !== station.id))}
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>ربط الأصناف بالمحطات</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {kitchenSpecialistStations.map((station) => {
                    const code = normalizeStationCode(station.stationCode || "");
                    const assignment = assignmentByStationCode.get(code);
                    const productGuids = assignment?.productGuids || [];
                    return (
                      <div key={`assign-${station.id}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{station.label || code || "محطة"}</div>
                            <div style={{ marginTop: 4, fontSize: "0.82rem", color: "var(--muted)" }}>
                              المحطة: <strong>{code || "غير محددة"}</strong>
                            </div>
                            <div style={{ marginTop: 4, fontSize: "0.82rem", color: "var(--muted)" }}>
                              المستخدمون: <strong>{code ? (chefStationStats.get(code)?.users || []).map((u) => u.name || u.login).join("، ") || "لا يوجد" : "غير متاح"}</strong>
                            </div>
                          </div>
                          <div style={{ fontSize: "0.82rem", color: "var(--muted)", textAlign: "left" }}>
                            عدد الأصناف: <strong>{productGuids.length}</strong>
                          </div>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>إضافة صنف</div>
                          <SmartProductSearch
                            placeholder="ابحث عن صنف ثم اضغط عليه"
                            onSelect={(hit) => {
                              const gid = String(hit.CardGuide || "").trim().toUpperCase();
                              if (!gid || !code || productGuids.includes(gid)) return;
                              writeStationAssignment(code, [...productGuids, gid]);
                            }}
                          />
                        </div>
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {productGuids.length ? (
                            productGuids.map((gid) => (
                              <button
                                key={`${station.id}-${gid}`}
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                                title={gid}
                                onClick={() => writeStationAssignment(code, productGuids.filter((x) => x !== gid))}
                              >
                                {productNameById.get(gid) || gid} ×
                              </button>
                            ))
                          ) : (
                            <div style={{ color: "var(--muted)" }}>لا توجد أصناف مرتبطة.</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>عرض JSON الحالي</summary>
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(s.kitchenSpecialistStationsJson || "[]")}</pre>
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(s.kitchenSpecialistChefsJson || "[]")}</pre>
          </details>
        </div>

        <SettingRow label="طباعة المطبخ" tooltip="إعدادات طباعة تذاكر المطبخ. يتطلب توصيل طابعة محلية أو شبكية.">
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>نمط التذكرة</label>
          <select value={s.kitchenPrintTicketMode} onChange={(e) => setS((x) => ({ ...x, kitchenPrintTicketMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="batch_only">ما يُرسل في هذه الدفعة فقط</option>
            <option value="aggregated_summary">ملخص مُجمَّع (مثل شريط المطبخ)</option>
            <option value="delta_net">صافي «مزيلة» (مطلوب − منفّذ + الحالي)</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>طباعة بديل عن شريحة الطاولة</label>
          <select value={s.kitchenPrintShowTableChip} onChange={(e) => setS((x) => ({ ...x, kitchenPrintShowTableChip: e.target.value }))} style={{ width: "100%" }}>
            <option value="on">نعم</option>
            <option value="off">لا</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>تلميح جهاز الطابعة (اختياري)</label>
          <input value={s.kitchenPrinterDeviceHint} onChange={(e) => setS((x) => ({ ...x, kitchenPrinterDeviceHint: e.target.value }))} style={{ width: "100%" }} placeholder="اسم الطابعة أو المسار — للربط لاحقاً" />
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => void testPrinter()}>اختبار توصيل الطابعة (مهيأ)</button>
          {printerMsg ? <p style={{ marginTop: 8, fontSize: "0.85rem" }}>{printerMsg}</p> : null}
        </SettingRow>

        <SettingRow label="طاولة المالك / VIP (افتراضيات المدير)" tooltip="الإعدادات الافتراضية للجلسات على طاولات VIP (VIP 1…5). يمكن للمدير تعديلها يدوياً من شاشة الطلب.">
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
          <input type="number" min={0} max={100} step={0.5} value={s.specialTableDefaultDiscountPct} onChange={(e) => setS((x) => ({ ...x, specialTableDefaultDiscountPct: e.target.value }))} style={{ width: "100%" }} />
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>تسعير المالك (طريقة قراءة الأسعار)</label>
          <select value={s.specialTableDefaultPriceMode} onChange={(e) => setS((x) => ({ ...x, specialTableDefaultPriceMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="menu">سعر المنيو (الافتراضي)</option>
            <option value="cost_plus">سعر التكلفة + نسبة</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>نسبة فوق التكلفة % (عند اختيار تكلفة + نسبة)</label>
          <input type="number" min={0} max={400} step={0.5} value={s.specialTableDefaultCostMarkupPct} disabled={String(s.specialTableDefaultPriceMode || "").toLowerCase() !== "cost_plus"} onChange={(e) => setS((x) => ({ ...x, specialTableDefaultCostMarkupPct: e.target.value }))} style={{ width: "100%" }} placeholder="مثال: 10 يعني تكلفة + 10%" />
        </SettingRow>

        <SettingRow label="عملاء owners&vip (TBL015 → TBL016)" tooltip="قائمة العملاء (المالكين والشخصيات المهمة) التي تظهر في دروب داون طاولة VIP.">
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
            هذه هي <strong>مصدر الدروب داون</strong> في شرائح الطاولات. لو أدخلت مجموعة في <code>TBL015</code> لكن لم تنشئ عملاء في <code>TBL016</code>{" "}
            فلن يظهر شيء في Owner/VIP داخل الشريحة.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={ownersVipAgentNameDraft} onChange={(e) => setOwnersVipAgentNameDraft(e.target.value)} style={{ width: "100%" }} placeholder="اسم عميل مالك/شخص مهم…" />
            <button type="button" className="btn btn-primary" disabled={ownersVipAgentBusy || !ownersVipAgentNameDraft.trim()} onClick={() => void createOwnersVipAgent()}>إضافة</button>
            <button type="button" className="btn btn-ghost" disabled={ownersVipAgentBusy} onClick={() => void loadOwnersVipAgents()}>تحديث</button>
          </div>
          {ownersVipAgentMsg ? <p style={{ marginTop: 8, fontSize: "0.85rem" }}>{ownersVipAgentMsg}</p> : null}
          <div style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--muted)" }}>GroupGuide: <code>{ownersVipGroupGuide || "غير موجود"}</code> — العدد: <strong>{ownersVipAgents.length}</strong></div>
          <div style={{ marginTop: 8, maxHeight: 160, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
            {ownersVipAgents.length ? ownersVipAgents.map((a) => (
              <div key={a.CardGuide} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>{a.AgentName}</span>
                <code style={{ opacity: 0.7 }}>{a.CardGuide}</code>
              </div>
            )) : <div style={{ color: "var(--muted)" }}>لا يوجد عملاء في مجموعة owners&vip حالياً.</div>}
          </div>
        </SettingRow>

        <div className="card">
          <div className="setting-card-header">
            <h4 style={{ marginTop: 0 }}>قوالب Owner/VIP (تغذي شرائح الطاولات)</h4>
            <SettingTooltip title="قوالب Owner/VIP">
              قوالب جاهزة لطاولات المالكين والشخصيات المهمة. كل قالب يربط الجلسة بعميل محدد مع سياسة خصم/ضريبة/خدمة.
            </SettingTooltip>
          </div>
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

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px", gap: 10, marginTop: 8, alignItems: "end" }}>
                    <label style={{ display: "block" }}>
                      <span style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>سياسة التسعير</span>
                      <select
                        value={t.costPricingEnabled ? "cost_plus" : "menu"}
                        onChange={(e) => {
                          const next = [...vipTemplates];
                          const mode = String(e.target.value || "menu").trim().toLowerCase();
                          next[idx] = {
                            ...t,
                            costPricingEnabled: mode === "cost_plus",
                            costMarkupPct: mode === "cost_plus" ? Number(t.costMarkupPct || 0) : 0,
                          };
                          writeVipTemplates(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <option value="menu">سعر المنيو</option>
                        <option value="cost_plus">استاندر كوست + نسبة</option>
                      </select>
                    </label>

                    <label style={{ display: "block" }}>
                      <span style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>نسبة الزيادة %</span>
                      <input
                        type="number"
                        min={0}
                        max={400}
                        step={0.5}
                        value={t.costMarkupPct}
                        disabled={!t.costPricingEnabled}
                        onChange={(e) => {
                          const next = [...vipTemplates];
                          next[idx] = { ...t, costMarkupPct: Number(e.target.value || 0) };
                          writeVipTemplates(next);
                        }}
                        style={{ width: "100%" }}
                      />
                    </label>
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

        <SettingRow label="الوردية وجدولة الأدوار" tooltip="إلزام وجود جدولة يومية للموظف قبل السماح له بتسجيل الدخول. يمنع الدخول العشوائي.">
          <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.88rem", lineHeight: 1.45 }}>
            عند التفعيل، لا يُسمح بتسجيل الدخول لأدوار الصالة (جرسون الطلبات، الاستقبال، المناولة، الطلبات السريعة) إلا إذا وُجد لهذا المستخدم{" "}
            <strong>صف في «جدولة أدوار المستخدمين»</strong> يغطي تاريخ اليوم. وإلا تظهر رسالة: «أنت لست ضمن فريق العمل اليوم».
            <br />
            <span style={{ color: "#0f766e", fontWeight: 700 }}>بعد «حفظ الكل» يكفي طلب تسجيل دخول جديد</span> — يُقرأ الإعداد من الملف مباشرة دون إعادة تشغيل الخادم (مع الدمج مع قاعدة البيانات).
          </p>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>إلزام وجود جدولة لليوم قبل الدخول</label>
          <select value={s.enforceRoleScheduleForShift} onChange={(e) => setS((x) => ({ ...x, enforceRoleScheduleForShift: e.target.value }))} style={{ width: "100%" }}>
            <option value="off">معطّل (الافتراضي)</option>
            <option value="on">مفعّل</option>
          </select>
        </SettingRow>

        <SettingRow label="Kids Area" tooltip="إعدادات منطقة الأطفال. التذاكر المنفصلة تعني أن أطفال المنطقة لا تُحسب على حساب الطاولة.">
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>تذاكر منفصلة عن الطاولات</label>
          <select value={s.kidsAreaSeparateTickets} onChange={(e) => setS((x) => ({ ...x, kidsAreaSeparateTickets: e.target.value }))} style={{ width: "100%" }}>
            <option value="on">نعم</option>
            <option value="off">لا</option>
          </select>
        </SettingRow>

        <SettingRow label="التدقيق والقنوات" tooltip="إعدادات التدقيق والقنوات. ملاحظة: 'احتفاظ السجلات' و'تسجيل أحداث الواجهة' مستقبليان — لا يوجد حذف تلقائي حالياً. 'سياسة الدليفري' تذكير — التنفيذ المالي لاحقاً.">
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
