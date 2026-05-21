import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import {
  fetchDailyMenuFromApi,
  fetchDailyMenuSchedule,
  isProductAllowedOnWaiterMenu,
  loadDailyMenuState,
  scheduleRestrictionForDate,
  todayYmd,
  type DailyMenuScheduleEntry,
  type DailyMenuState,
} from "../lib/dailyMenuSettings";
import { applyPromotions, type Promotion } from "../lib/posPromotions";
import { buildSegmentedTablesFromFloorPlan } from "../lib/restaurantTableView";
import "../styles/operationalRoles.css";
import SmartProductSearch from "../components/SmartProductSearch";
import GuestReturnRequestModal, { type GuestReturnOrderLine } from "../components/GuestReturnRequestModal";
import { useAuth } from "../auth/AuthContext";
import { sessionDisplayName } from "../auth/displayUser";
import { buildMat3amActor } from "../lib/mat3amActor";
import { useTerminalLock } from "../context/TerminalLockContext";
import { briefNetworkHint, safeFetch } from "../lib/safeFetch";
import { CaptainGuestDock } from "../components/CaptainGuestDock";
import { useAppMenu } from "../context/AppMenuContext";
import {
  CAPTAIN_MOBILE_TABS,
  captainDockSeatsFromLabels,
  captainShowsGuestDock,
  type CaptainMobileTab,
} from "../lib/waiterCaptainMobile";

/** عرض الجوال لسلوك التتابع (يتوافق مع operationalRoles @media max-width) */
const WAITER_OT_NARROW_MAX_PX = 900;

type Product = {
  CardGuide: string;
  ProductName: string;
  Price: number;
  AgentPrice?: number;
  BaseEndUserPrice?: number;
  PrepMinutes?: number;
  Hieght3?: number;
  GroupGuid?: string | null;
  image?: string;
  imageUrl?: string;
};

type SessionBillingProfile = {
  active?: boolean;
  source?: string;
  vipTemplateId?: string;
  vipAgentGuid?: string;
  vipOwnerLabel?: string;
  noService?: boolean;
  noVat?: boolean;
  discountPct?: number;
  priceMode?: string;
  costMarkupPct?: number;
};

type ProductGroup = { CardGuide: string; GroupName: string; image?: string; imageUrl?: string };
type Agent = { CardGuide: string; AgentName: string; CardNumber?: string };
type KitchenStopRow = { productGuide: string; stopped?: boolean; note?: string };

type RestTable = {
  id: string;
  name: string;
  status?: string;
  seats?: number;
  number?: number;
  /** حدّ أدنى للطاولة من الخادم — 0 يعني استخدام الافتراضي العام من ops-settings */
  minimumCharge?: number;
};

function matchesTablePickQuery(t: RestTable, rawQuery: string): boolean {
  const s = rawQuery.trim().toLowerCase();
  if (!s) return true;
  const name = String(t.name || "").toLowerCase().replace(/\s+/g, " ");
  const num = t.number != null ? String(t.number) : "";
  const id = String(t.id || "").toLowerCase();
  if (name.includes(s) || num.includes(s) || id.includes(s)) return true;
  const compact = s.replace(/\s+/g, "");
  const m = /^t(\d+)$|^(\d+)$/.exec(compact);
  const n = m ? Number(m[1] || m[2]) : NaN;
  if (Number.isFinite(n) && n > 0) {
    if (t.number != null && Number(t.number) === n) return true;
    const boundary = new RegExp(`(?:^|[^0-9])${n}(?:[^0-9]|$)`);
    if (boundary.test(name) || boundary.test(id)) return true;
  }
  return false;
}

type CartLine = {
  id: string;
  productGuide: string;
  name: string;
  qty: number;
  unitPrice: number;
  /** عرض فقط / ترجمة قديمة؛ التوزيع الحقيقي على seatNo */
  seatLabel: string | null;
  seatNo: number | null;
  /** معرّفات الإضافات مرتبة (|) — للتمييز عند الدمج مع نفس الصنف والمقعد */
  addonIdsKey?: string;
  /** ملاحظة للمطبخ/التذكرة — تُدمج مع اسم البند عند الإرسال */
  kitchenNotes?: string;
};

type CatalogAddonRow = { id: number; label: string; price: number; sortOrder: number; isActive: boolean };

type ServerOrderItem = {
  lineId?: string;
  name?: string;
  quantity?: number;
  unitPrice?: number;
  seatNo?: number | null;
  lineStatus?: string;
  cancelled?: boolean;
  productGuide?: string;
};

type ServerOrder = {
  id: string;
  sessionId?: string;
  tableId?: string;
  status?: string;
  items?: ServerOrderItem[];
  generalOrder?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const ORDER_STATUS_AR: Record<string, string> = {
  pending: "انتظار المطبخ",
  preparing: "قيد التحضير",
  ready: "جاهز",
  served: "مُقدَّم",
  paid: "مدفوع",
  cancelled: "ملغى",
};

function orderStatusLabelAr(st: string): string {
  const k = (st || "").toLowerCase();
  return ORDER_STATUS_AR[k] || st || "—";
}

function activeOrderItems(o: ServerOrder): ServerOrderItem[] {
  return (o.items || []).filter((i) => !i.cancelled && Number(i.quantity ?? 0) > 0);
}

function formatOrderItemLine(i: ServerOrderItem): string {
  const q = Number(i.quantity ?? 1) || 1;
  const seat = i.seatNo != null && Number(i.seatNo) >= 1 ? ` · ك${i.seatNo}` : "";
  const price = Number(i.unitPrice ?? 0) > 0 ? ` — ${Math.round(Number(i.unitPrice))} ج` : "";
  return `${i.name || "صنف"} ×${q}${seat}${price}`;
}

function flattenSessionLinesForReturn(orders: ServerOrder[]): GuestReturnOrderLine[] {
  const out: GuestReturnOrderLine[] = [];
  for (const o of orders) {
    if ((o.status || "").toLowerCase() === "cancelled") continue;
    for (const it of activeOrderItems(o)) {
      const lid = String(it.lineId || "").trim();
      if (!lid) continue;
      out.push({
        orderId: o.id,
        lineId: lid,
        productGuide: String(it.productGuide || ""),
        name: String(it.name || "صنف"),
        quantity: Number(it.quantity ?? 1) || 1,
        unitPrice: Number(it.unitPrice ?? 0) || 0,
        seatNo: it.seatNo,
      });
    }
  }
  return out;
}

type PosPolicy = {
  servicePercent: number;
  vatPercent: number;
  applyDiscountBeforeTax: boolean;
  serviceBeforeVat: boolean;
};

function lineId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addonRowsKey(rows: CatalogAddonRow[]): string {
  if (!rows.length) return "";
  return rows
    .map((r) => r.id)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .join("|");
}

function toNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function resolveGuestUnitPrice(p: Product, bp: SessionBillingProfile | null): number {
  const active = !!(bp && typeof bp === "object" && bp.active !== false);
  const mode = String(bp?.priceMode || "menu").toLowerCase();
  if (active && mode === "cost_plus") {
    const pct = Math.max(0, toNum(bp?.costMarkupPct, 0));
    const cost = Math.max(0, toNum(p.AgentPrice, 0));
    if (cost > 0) return Math.round(cost * (100 + pct)) / 100;
  }
  return Math.max(0, toNum(p.Price, 0));
}

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function prepMinutes(p: Product) {
  const db = Number((p as any).PrepMinutes ?? (p as any).Hieght3 ?? 0);
  if (Number.isFinite(db) && db > 0) return Math.round(db);
  let s = 0;
  for (let i = 0; i < p.CardGuide.length; i++) s += p.CardGuide.charCodeAt(i);
  return 10 + (s % 26);
}

function normalizeGroupName(name: string) {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ");
  return cleaned.replace(/^(.{2})\1+/u, "$1");
}

function normalizeTableStatus(raw: string): "ready" | "occupied" | "reserved" | "dirty" | "cleaning" {
  const s = String(raw || "").toLowerCase().trim();
  if (["available", "free", "open", "ready", "متاحة", "جاهزة"].includes(s)) return "ready";
  if (["occupied", "busy", "مشغولة"].includes(s)) return "occupied";
  if (["reserved", "محجوزة"].includes(s)) return "reserved";
  if (["dirty", "متسخة"].includes(s)) return "dirty";
  if (["cleaning", "تنظيف"].includes(s)) return "cleaning";
  return "ready";
}

const SERVICE_RATE_FOR_CARD_PRICE = 0.125;
const SEAT_SLOT_COUNT = 12;
/** كرسي وهمي: طلب مشترك يُقسّم على الشيكات عند «سبليت — فاتورة لكل مقعد» */
const SHARED_SEAT_NO = 13;

/** ترتيب «مقعد تالي» للجوال: ١→١٢ ثم ١٣ مشترك */
const SEAT_MOBILE_NAV_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, SHARED_SEAT_NO] as const;

function tableRefKey(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

/** مطابقة معرف طاولة بين المخطط (T14) والجلسة (GUID) */
function restaurantTableIdsEqual(a: unknown, b: unknown): boolean {
  const sa = String(a ?? "").trim();
  const sb = String(b ?? "").trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const norm = (s: string) => s.replace(/[{}]/g, "").toUpperCase();
  return norm(sa) === norm(sb);
}

/** فهرس جلسات نشطة: مفتاح = مرجع طاولة من الجلسة، ثم يُملأ تحت مرجع كل صف في المخطط يشير لنفس الطاولة */
function buildSessionByTableRef(sess: unknown[], catalog?: RestTable[]): Record<string, { id: string; captainUserId: string }> {
  const out: Record<string, { id: string; captainUserId: string }> = {};
  for (const x of sess) {
    if (!x || typeof x !== "object") continue;
    const o = x as { id?: string; tableId?: unknown; status?: string; captainUserId?: string };
    if (String(o.status || "").toLowerCase() !== "active") continue;
    const tid = tableRefKey(o.tableId);
    if (!tid) continue;
    out[tid] = { id: String(o.id || "").trim(), captainUserId: String(o.captainUserId || "").trim() };
  }
  if (catalog?.length) {
    for (const t of catalog) {
      const k = tableRefKey(t.id);
      if (out[k]?.id) continue;
      for (const x of sess) {
        if (!x || typeof x !== "object") continue;
        const o = x as { id?: string; tableId?: unknown; status?: string; captainUserId?: string };
        if (String(o.status || "").toLowerCase() !== "active") continue;
        if (!restaurantTableIdsEqual(t.id, o.tableId)) continue;
        out[k] = { id: String(o.id || "").trim(), captainUserId: String(o.captainUserId || "").trim() };
        break;
      }
    }
  }
  return out;
}

/** مطابقة معرف مستخدم/GUID بين الجلسة وواجهة الكابتن */
function mat3amGuidNormEq(a: string, b: string): boolean {
  const x = String(a || "").trim().replace(/[{}]/g, "").toUpperCase();
  const y = String(b || "").trim().replace(/[{}]/g, "").toUpperCase();
  return x.length > 0 && y.length > 0 && x === y;
}

function seatNoFromLine(l: CartLine): number | null {
  if (l.seatNo != null && Number.isFinite(l.seatNo)) return l.seatNo;
  const m = /كرسي\s*(\d+)/.exec(String(l.seatLabel || ""));
  if (m) {
    const n = parseInt(m[1] || "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= SHARED_SEAT_NO) return n;
  }
  return null;
}

function extractSeatFromOrderItem(it: { name?: string; seatNo?: number }): number | null {
  if (it.seatNo != null && String(it.seatNo).trim().length) {
    const n = Number(it.seatNo);
    if (Number.isFinite(n) && n >= 1 && n <= SHARED_SEAT_NO) return Math.floor(n);
  }
  const m = String(it.name || "").match(/كرسي\s*(\d+)/);
  if (m) {
    const n = parseInt(m[1] || "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= SHARED_SEAT_NO) return n;
  }
  return null;
}

export type WaiterOrderPageProps = {
  /** عند تضمين الصفحة (مثلاً كول سنتر) — يُمرَّر كـ orderType للفاتورة عند الإرسال */
  embeddedChannel?: string;
  pageTitle?: string;
  backTo?: string;
};

export default function WaiterOrderPage(props: WaiterOrderPageProps = {}) {
  const { embeddedChannel, pageTitle, backTo } = props;
  const base = getApiBase();
  const resolveMediaUrl = (u?: string) => {
    const raw = String(u || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("data:")) return raw;
    return `${base}${raw.startsWith("/") ? "" : "/"}${raw}`;
  };
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const terminalLock = useTerminalLock();

  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [kitchenStoppedMap, setKitchenStoppedMap] = useState<Map<string, string>>(() => new Map());
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tables, setTables] = useState<RestTable[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [policy, setPolicy] = useState<PosPolicy>({
    servicePercent: 12.5,
    vatPercent: 14,
    applyDiscountBeforeTax: true,
    serviceBeforeVat: true,
  });

  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [assignmentMode, setAssignmentMode] = useState<"per_seat" | "general">("per_seat");
  const [selectedSeat, setSelectedSeat] = useState(1);
  const [categoryKey, setCategoryKey] = useState<string>("all");
  const [couponCode, setCouponCode] = useState("");
  const [tipAmount, setTipAmount] = useState(0);
  const [selectedAgentGuid, setSelectedAgentGuid] = useState("");
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [dailyMenuState, setDailyMenuState] = useState<DailyMenuState | null>(null);
  const [dailyMenuScheduleEntries, setDailyMenuScheduleEntries] = useState<DailyMenuScheduleEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionOrders, setSessionOrders] = useState<ServerOrder[]>([]);
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnModalLines, setReturnModalLines] = useState<GuestReturnOrderLine[]>([]);
  const [catalogAddons, setCatalogAddons] = useState<CatalogAddonRow[]>([]);
  /** بعد أول محاولة جلب — يُمنع ضغطة سريقة قبل اكتمال التحميل (كانت تتخطّى المودال) */
  const [catalogAddonsReady, setCatalogAddonsReady] = useState(false);
  const [addonPickerProduct, setAddonPickerProduct] = useState<Product | null>(null);
  const [addonPickerSel, setAddonPickerSel] = useState<Record<number, boolean>>({});
  const [addonPickerNotes, setAddonPickerNotes] = useState("");
  const [addonPickerQty, setAddonPickerQty] = useState(1);
  const [billingRequestedAt, setBillingRequestedAt] = useState<string | null>(null);
  const [sessionBillingProfile, setSessionBillingProfile] = useState<SessionBillingProfile | null>(null);
  const [requestBillBusy, setRequestBillBusy] = useState(false);
  const [summonBusy, setSummonBusy] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [splitBySeat, setSplitBySeat] = useState(false);
  const [transferTargetTableId, setTransferTargetTableId] = useState("");
  const [mergeTargetTableId, setMergeTargetTableId] = useState("");
  const [transferPickQuery, setTransferPickQuery] = useState("");
  const [mergePickQuery, setMergePickQuery] = useState("");
  /** نتائج «بحث» — null = لم يُنفَّذ بحث بعد (لا تُعرض قائمة تحت الحقل) */
  const [transferSearchResults, setTransferSearchResults] = useState<RestTable[] | null>(null);
  const [mergeSearchResults, setMergeSearchResults] = useState<RestTable[] | null>(null);
  /** كل الطاولات (المخطط) لاختيار التحويل/الدمج — لا تُصفّى بمسند الكابتن */
  const [tablesMoveCatalog, setTablesMoveCatalog] = useState<RestTable[]>([]);
  /** جلسة نشطة واحدة لكل tableId (مرجع موحّد) */
  const [sessionByTableRef, setSessionByTableRef] = useState<Record<string, { id: string; captainUserId: string }>>({});
  const [sessionMoveBusy, setSessionMoveBusy] = useState(false);
  /** اسم للعرض/الطباعة على الشيك — نصّي على الجلسة وليس عميلاً منفصلاً في TBL016 */
  const [seatGuestLabels, setSeatGuestLabels] = useState<Record<number, string>>({});
  /** حدّ أدنى افتراضي من `/api/restaurant/ops-settings` عندما لا يُحدَّد على الطاولة */
  const [tableMinDefaultOps, setTableMinDefaultOps] = useState(0);
  /** ترشيح أصناف بسعر الوحدة ضمن فرق المينيموم (بديل عن دفع فرق بدون منفعة) */
  const [gapPickHits, setGapPickHits] = useState<Product[]>([]);
  const [gapPickBusy, setGapPickBusy] = useState(false);
  const seatGuestLabelsRef = useRef<Record<number, string>>({});
  const patchSeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** مقعد واحد له حقل اسم مفتوح (بعد ضغط الزر)، أو الكتابة مباشرة في الحقل بعد الفتح */
  const [seatNameEditorSeat, setSeatNameEditorSeat] = useState<number | null>(null);

  /** قفل إصدار الطلب حسب إعداد «قفل الطاولة على كابتن» — يطابق مسند الطلب وليس كل المستخدمين. */
  const [orderTakerExclusiveTable, setOrderTakerExclusiveTable] = useState(false);
  const [captainGate, setCaptainGate] = useState<{ id: string; name: string } | null>(null);

  const [narrowOtViewport, setNarrowOtViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${WAITER_OT_NARROW_MAX_PX}px)`).matches : false,
  );
  /** تدفق الكابتن الموحّد — تبويب واحد ظاهر على الجوال */
  const [captainTab, setCaptainTab] = useState<CaptainMobileTab>("menu");
  /** جوال: إخفاء قائمة المقاعد بعد تأكيد الاسم للانتقال للفئات/الأصناف */
  const [seatPanelMobCollapsed, setSeatPanelMobCollapsed] = useState(false);
  const [mobileFlowToast, setMobileFlowToast] = useState("");
  const mobileFlowToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCategoryKeyRef = useRef(categoryKey);

  const normalizedGroups = useMemo(
    () => groups.map((g) => ({ ...g, GroupName: normalizeGroupName(g.GroupName) })),
    [groups]
  );

  const groupNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of normalizedGroups) m.set(g.CardGuide, g.GroupName);
    return m;
  }, [normalizedGroups]);

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) || null,
    [tables, selectedTableId]
  );

  const transferPickBase = useMemo(() => {
    return tablesMoveCatalog.filter((t) => {
      if (String(t.id) === String(selectedTableId)) return false;
      const ref = tableRefKey(t.id);
      const occ = sessionByTableRef[ref];
      if (occ?.id) return false;
      const tst = normalizeTableStatus(String(t.status || ""));
      if (tst === "dirty" || tst === "cleaning") return false;
      return true;
    });
  }, [tablesMoveCatalog, sessionByTableRef, selectedTableId]);

  const mergePickBase = useMemo(() => {
    const capId = String(captainGate?.id || "").trim();
    return tablesMoveCatalog.filter((t) => {
      if (String(t.id) === String(selectedTableId)) return false;
      const ref = tableRefKey(t.id);
      const occ = sessionByTableRef[ref];
      if (!occ?.id) return false;
      if (String(occ.id) === String(activeSessionId || "")) return false;
      if (capId) {
        const oc = String(occ.captainUserId || "").trim();
        if (oc && !mat3amGuidNormEq(oc, capId)) return false;
      }
      return true;
    });
  }, [tablesMoveCatalog, sessionByTableRef, selectedTableId, captainGate?.id, activeSessionId]);

  const runTransferTableSearch = useCallback(() => {
    const q = transferPickQuery.trim();
    const list = q ? transferPickBase.filter((t) => matchesTablePickQuery(t, q)) : transferPickBase.slice(0, 80);
    setTransferSearchResults(list);
  }, [transferPickQuery, transferPickBase]);

  const runMergeTableSearch = useCallback(() => {
    const q = mergePickQuery.trim();
    const list = q ? mergePickBase.filter((t) => matchesTablePickQuery(t, q)) : mergePickBase.slice(0, 80);
    setMergeSearchResults(list);
  }, [mergePickQuery, mergePickBase]);

  useEffect(() => {
    setTransferSearchResults(null);
    setMergeSearchResults(null);
  }, [selectedTableId]);

  useEffect(() => {
    setTransferSearchResults(null);
    setTransferTargetTableId("");
  }, [transferPickQuery]);

  useEffect(() => {
    setMergeSearchResults(null);
    setMergeTargetTableId("");
  }, [mergePickQuery]);

  const isDeliveryEmbedded = String(embeddedChannel || "").trim().toLowerCase() === "delivery";
  const selectedTableStatus = normalizeTableStatus(String((selectedTable as any)?.status || ""));
  const selectedTableBlocked = selectedTableStatus === "dirty" || selectedTableStatus === "cleaning";

  /** عودة واضحة من «طلب للطاولة» إلى شاشة اختيار الطاولة (أو مسار التضمين) */
  const orderTakerExitPath = useMemo(() => {
    const b = String(backTo || "").trim();
    if (b) return b;
    if (isDeliveryEmbedded) return "/app/cashier/dashboard";
    const r = String(user?.role || "").trim().toLowerCase();
    if (r === "manager") return "/app/manager/captain-tables";
    if (r === "developer") return "/app/developer/captain-tables";
    return "/app/waiter/tables";
  }, [backTo, isDeliveryEmbedded, user?.role]);

  function seatGuestDisplay(seatIndex: number): string {
    const t = String(seatGuestLabels[seatIndex] ?? "").trim();
    if (t) return t;
    if (seatIndex === SHARED_SEAT_NO) return "١٣ — مشترك";
    return `مقعد ${seatIndex}`;
  }

  function seatHasCustomLabel(seatIndex: number): boolean {
    return String(seatGuestLabels[seatIndex] ?? "").trim().length > 0;
  }

  function truncateRailGuestLabel(display: string, maxChars = 11): string {
    const t = display.trim();
    if (!t) return "؟";
    if (t.length <= maxChars) return t;
    return `${t.slice(0, Math.max(1, maxChars - 1))}…`;
  }

  function tableDisplayName(t: RestTable | null | undefined): string {
    if (!t) return "";
    const n = Number(t.number);
    if (Number.isFinite(n) && n > 0) return `#${n}`;
    const raw = String(t.name || t.id || "").trim();
    const m = /^t\s*(\d+)$/i.exec(raw);
    if (m) return `#${m[1]}`;
    return raw || "طاولة";
  }

  const useCaptainMobileUi = narrowOtViewport;
  const appMenu = useAppMenu();

  const captainDockSeats = useMemo(
    () =>
      assignmentMode === "per_seat"
        ? captainDockSeatsFromLabels(seatGuestLabels, SEAT_SLOT_COUNT, SHARED_SEAT_NO)
        : [],
    [assignmentMode, seatGuestLabels],
  );

  const showCaptainGuestDock =
    useCaptainMobileUi && captainShowsGuestDock(captainTab, assignmentMode === "per_seat", captainDockSeats);

  useEffect(() => {
    if (!useCaptainMobileUi || assignmentMode !== "per_seat") return;
    if (captainDockSeats.length > 0 && !captainDockSeats.includes(selectedSeat)) {
      setSelectedSeat(captainDockSeats[0]!);
    }
  }, [captainDockSeats, selectedSeat, useCaptainMobileUi, assignmentMode]);

  const pickCaptainSeatForOrder = useCallback(
    (seatNo: number) => {
      setSelectedSeat(seatNo);
      setSeatNameEditorSeat(null);
      setSeatPanelMobCollapsed(true);
      setCaptainTab("menu");
    },
    [],
  );

  async function persistSeatGuestLabels(labels: Record<number, string>) {
    if (!activeSessionId) return;
    try {
      const payload: Record<string, string> = {};
      for (let i = 1; i <= SHARED_SEAT_NO; i++) payload[String(i)] = String(labels[i] ?? "").trim().slice(0, 120);
      await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatGuestLabels: payload }),
      });
    } catch {
      /* ignore */
    }
  }

  function onSeatGuestInputChange(seatIndex: number, value: string) {
    const sliced = value.slice(0, 120);
    setSeatGuestLabels((prev) => {
      const next = { ...prev, [seatIndex]: sliced };
      seatGuestLabelsRef.current = next;
      if (patchSeatTimer.current) window.clearTimeout(patchSeatTimer.current);
      patchSeatTimer.current = window.setTimeout(() => {
        patchSeatTimer.current = null;
        void persistSeatGuestLabels(seatGuestLabelsRef.current);
      }, 500);
      return next;
    });
  }


  const loadAll = useCallback(async () => {
    setMsg("");
    try {
      const bootR = await safeFetch(`${base}/api/restaurant/order-taker-bootstrap`);
      if (bootR.status === 0 || !bootR.ok) {
        setMsg(
          bootR.status === 0
            ? briefNetworkHint("Failed to fetch")
            : `تعذر تحميل بيانات الطلب (HTTP ${bootR.status})`,
        );
        return;
      }
      const boot =
        tryParseJson<{
          ok?: boolean;
          products?: unknown;
          groups?: unknown;
          tables?: unknown;
          sessions?: unknown;
          floorPlan?: { plan?: unknown };
          policy?: Record<string, unknown>;
          promotions?: unknown;
          agents?: unknown;
          kitchenStops?: { items?: unknown };
          opsSettings?: Record<string, unknown>;
        }>(await bootR.text()) ?? {};

      if (!boot.ok) {
        setMsg("تعذر تحميل بيانات الطلب — تحقق من الاتصال بقاعدة البيانات.");
        return;
      }

      const pj = { products: boot.products };
      const gj = { groups: boot.groups };
      const fpj = { plan: boot.floorPlan?.plan ?? boot.floorPlan };
      const tj = { tables: boot.tables };
      const rsj = { sessions: boot.sessions };
      const polj = boot.policy ?? {};
      const promoj = { promotions: boot.promotions };
      const aj = { agents: boot.agents };
      const ksj = boot.kitchenStops ?? { items: [] };

      setProducts(Array.isArray(pj.products) ? (pj.products as Product[]) : []);
      const rawGroups = Array.isArray(gj.groups) ? (gj.groups as ProductGroup[]) : [];
      const seenGroupIds = new Set<string>();
      const uniqueGroups: ProductGroup[] = [];
      for (const g of rawGroups) {
        const id = String(g?.CardGuide || "").trim();
        if (!id || seenGroupIds.has(id)) continue;
        seenGroupIds.add(id);
        uniqueGroups.push(g);
      }
      setGroups(uniqueGroups);
      const tlist: RestTable[] = Array.isArray(tj.tables) ? (tj.tables as RestTable[]) : [];
      const planRaw = fpj?.plan;
      const statusById = new Map<string, string>();
      for (const t of tlist) statusById.set(String(t.id), normalizeTableStatus(String(t.status || "")));
      const outList = buildSegmentedTablesFromFloorPlan(planRaw, tlist)
        .map((t) => ({ ...t, status: statusById.get(String((t as any).id)) || normalizeTableStatus(String((t as any).status || "")) }))
        .filter((table) => !table.isSeparator);

      const sessList = Array.isArray(rsj.sessions) ? rsj.sessions : [];
      const uid = user?.id != null ? String(user.id) : "";
      const mgrDev = user?.role === "manager" || user?.role === "developer";
      const allowedTableKeys = new Set<string>();
      for (const s of sessList as { captainUserId?: string; tableId?: string }[]) {
        if (!s || typeof s !== "object") continue;
        if (String(s.captainUserId || "").trim() === uid && uid) allowedTableKeys.add(tableRefKey(s.tableId));
      }
      const outFiltered = mgrDev ? outList : outList.filter((t: any) => allowedTableKeys.has(tableRefKey(t.id)));

      setSessionByTableRef(buildSessionByTableRef(sessList as unknown[], outList));
      setTablesMoveCatalog(outList);

      const fromUrl = searchParams.get("tableId");
      setTables(outFiltered);

      setSelectedTableId((prev) => {
        const arr = outFiltered;
        if (fromUrl && arr.some((x: any) => x.id === fromUrl)) return fromUrl;
        if (prev && arr.some((x: any) => x.id === prev)) return prev;
        return arr.length ? arr[0].id : "";
      });

      if (outFiltered.length === 0) {
        if (outList.length === 0) {
          setMsg(
            "لا توجد طاولات في المخطط — من المطوّر: تهيئة TBL005 + floor_plan.json أو افتح الطاولة من «لوحة الطاولات» أولاً.",
          );
        } else if (!mgrDev) {
          setMsg(
            "لا توجد طاولة مسندة لجلسة نشطة لحسابك. افتح «لوحة الطاولات» → ابدأ التسكين على طاولة، ثم ارجع لطلب للطاولة.",
          );
        }
      }

      setPolicy({
        servicePercent: toNum(polj.servicePercent, 12),
        vatPercent: toNum(polj.vatPercent, 14),
        applyDiscountBeforeTax: Boolean(polj.applyDiscountBeforeTax ?? true),
        serviceBeforeVat: Boolean(polj.serviceBeforeVat ?? true),
      });
      setPromotions(Array.isArray(promoj.promotions) ? (promoj.promotions as Promotion[]) : []);
      const alist = Array.isArray(aj.agents) ? (aj.agents as Agent[]) : [];
      const stopRows = Array.isArray(ksj.items) ? (ksj.items as KitchenStopRow[]) : [];
      const sm = new Map<string, string>();
      for (const s of stopRows) {
        if (!s || !s.productGuide || !s.stopped) continue;
        sm.set(String(s.productGuide).trim().toUpperCase(), String(s.note || "نفد من المطبخ"));
      }
      setKitchenStoppedMap(sm);
      setAgents(alist);
      const opJson = boot.opsSettings ?? {};
      const mcRaw = Number(opJson.tableDefaultMinimumCharge ?? 0);
      setTableMinDefaultOps(Number.isFinite(mcRaw) ? Math.max(0, mcRaw) : 0);
      setSelectedAgentGuid((prev) => {
        if (prev && alist.some((a) => a.CardGuide === prev)) return prev;
        const pick = alist.find((a) => {
          const n = String(a?.AgentName || "").toLowerCase();
          return n.includes("cash") || n.includes("عميل نقدي") || n.includes("نقدا") || n.includes("نقدي");
        });
        return pick?.CardGuide || alist[0]?.CardGuide || "";
      });
      void (async () => {
        try {
          const [dmRemote, dmSched] = await Promise.all([fetchDailyMenuFromApi(), fetchDailyMenuSchedule()]);
          setDailyMenuScheduleEntries(dmSched.entries || []);
          setDailyMenuState(dmRemote ?? loadDailyMenuState());
        } catch {
          setDailyMenuState(loadDailyMenuState());
        }
      })();
    } catch (e) {
      setMsg(`تعذر تحميل البيانات: ${briefNetworkHint(e)}`);
    }
  }, [base, searchParams, user?.id, user?.role]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const refreshKitchenStops = useCallback(async () => {
    try {
      const ks = await safeFetch(`${base}/api/restaurant/kitchen/item-stops?active_only=true`);
      const ksj = tryParseJson<{ items?: unknown }>(await ks.text()) ?? {};
      const stopRows = Array.isArray(ksj.items) ? (ksj.items as KitchenStopRow[]) : [];
      const sm = new Map<string, string>();
      for (const s of stopRows) {
        if (!s || !s.productGuide || !s.stopped) continue;
        sm.set(String(s.productGuide).trim().toUpperCase(), String(s.note || "نفد من المطبخ"));
      }
      setKitchenStoppedMap(sm);
    } catch {
      /* ignore */
    }
  }, [base]);

  useEffect(() => {
    void refreshKitchenStops();
    const id = window.setInterval(() => void refreshKitchenStops(), 15000);
    return () => window.clearInterval(id);
  }, [refreshKitchenStops]);

  const menuScheduleRestriction = useMemo(
    () => scheduleRestrictionForDate(dailyMenuScheduleEntries, todayYmd()),
    [dailyMenuScheduleEntries],
  );

  const isOnWaiterMenu = useCallback(
    (productGuide: string, productName: string) =>
      isProductAllowedOnWaiterMenu(productGuide, productName, dailyMenuState, menuScheduleRestriction),
    [dailyMenuState, menuScheduleRestriction],
  );

  const isKitchenStopped = useCallback(
    (productGuide: string) => kitchenStoppedMap.has(String(productGuide || "").trim().toUpperCase()),
    [kitchenStoppedMap],
  );

  const kitchenStopNote = useCallback(
    (productGuide: string) => kitchenStoppedMap.get(String(productGuide || "").trim().toUpperCase()) || "نفد من المطبخ",
    [kitchenStoppedMap],
  );

  const menuEligibleProducts = useMemo(
    () => products.filter((p) => isOnWaiterMenu(p.CardGuide, p.ProductName || "")),
    [products, isOnWaiterMenu],
  );

  const returnableLines = useMemo(
    () => flattenSessionLinesForReturn(sessionOrders),
    [sessionOrders],
  );

  const waiterMenuGroups = useMemo(() => {
    const groupIds = new Set<string>();
    for (const p of menuEligibleProducts) {
      const g = String(p.GroupGuid || "").trim();
      if (g) groupIds.add(g);
    }
    return normalizedGroups.filter((g) => groupIds.has(g.CardGuide));
  }, [menuEligibleProducts, normalizedGroups]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const [wf, sr] = await Promise.all([
          fetch(`${base}/api/restaurant/workflow-settings`),
          fetch(`${base}/api/restaurant/table-sessions?status=active`),
        ]);
        const wfj = await wf.json().catch(() => ({}));
        const ex = String((wfj as { orderTakerExclusiveTable?: string }).orderTakerExclusiveTable || "").toLowerCase();
        if (!stop) {
          setOrderTakerExclusiveTable(ex === "on" || ex === "1" || ex === "true" || ex === "yes");
        }
        const sj = await sr.json().catch(() => ({}));
        const sess = Array.isArray((sj as { sessions?: unknown }).sessions) ? (sj as { sessions: unknown[] }).sessions : [];
        setSessionByTableRef(buildSessionByTableRef(sess, tablesMoveCatalog));
        if (!activeSessionId) {
          if (!stop) {
            setCaptainGate(null);
            setSessionBillingProfile(null);
          }
          return;
        }
        let row:
          | {
            captainUserId?: string;
            captainName?: string;
            captainLogin?: string;
            billingProfile?: SessionBillingProfile;
          }
          | undefined;
        for (const x of sess) {
          if (!x || typeof x !== "object") continue;
          const o = x as {
            id?: string;
            captainUserId?: string;
            captainName?: string;
            captainLogin?: string;
            billingProfile?: SessionBillingProfile;
          };
          if (String(o.id || "") === String(activeSessionId)) {
            row = o;
            break;
          }
        }
        const cid = String(row?.captainUserId || "").trim();
        const cname = String(row?.captainName || row?.captainLogin || "").trim();
        if (!stop) {
          setCaptainGate(cid ? { id: cid, name: cname || "مسند الطلب" } : null);
          const bp = row?.billingProfile;
          setSessionBillingProfile(bp && typeof bp === "object" ? bp : null);
        }
      } catch {
        if (!stop) {
          setCaptainGate(null);
          setSessionBillingProfile(null);
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 12000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [base, activeSessionId, tablesMoveCatalog]);

  const orderTakingLocked = useMemo(() => {
    if (!orderTakerExclusiveTable) return false;
    if (!captainGate?.id) return false;
    if (user?.role === "manager" || user?.role === "developer") return false;
    if (!user?.id) return false;
    return String(user.id) !== String(captainGate.id);
  }, [orderTakerExclusiveTable, captainGate, user?.id, user?.role]);

  /**
   * عند تطبيق Owner/VIP على الجلسة (vip_owner_agent أو vip_owner_template):
   * نُجبر دروب داون «اسم العميل» في POS على عميل المالك بدل الافتراضي «عميل نقدي».
   * عند إلغاء VIP يعود الاختيار للعميل النقدي تلقائياً عبر منطق loadAll.
   */
  useEffect(() => {
    const bp = sessionBillingProfile;
    if (!bp || bp.active === false) return;
    const vipGuid = String(bp.vipAgentGuid || "").trim().toUpperCase();
    if (!vipGuid) return;
    const exists = agents.some((a) => String(a.CardGuide || "").toUpperCase() === vipGuid);
    if (!exists) return;
    setSelectedAgentGuid((prev) => (prev && String(prev).toUpperCase() === vipGuid ? prev : vipGuid));
  }, [sessionBillingProfile, agents]);

  /** إحصاء حالات طلبات الجلسة الحالية للمطبخ — شريط معلومات بالشريط العلوي */
  const sessionKitchenStats = useMemo(() => {
    let pending = 0;
    let preparing = 0;
    let ready = 0;
    for (const o of sessionOrders) {
      const st = String(o.status || "").toLowerCase();
      if (st === "cancelled" || st === "paid" || st === "served") continue;
      if (st === "pending") pending += 1;
      else if (st === "preparing") preparing += 1;
      else if (st === "ready") ready += 1;
    }
    return { pending, preparing, ready };
  }, [sessionOrders]);

  const activeCatalogAddons = useMemo(
    () =>
      catalogAddons
        .filter((r) => r.isActive !== false && String(r.label || "").trim() !== "")
        .slice()
        .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id - b.id)),
    [catalogAddons],
  );

  const loadCatalogAddons = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/catalog-addons?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const t = await r.text();
      if (r.ok) {
        const j = tryParseJson<{ items?: unknown }>(t) ?? {};
        const it = Array.isArray(j.items) ? j.items : [];
        setCatalogAddons(
          it.map((x: unknown) => {
            const row = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
            return {
              id: Number(row.id) || 0,
              label: String(row.label || "").trim() || "إضافة",
              price: Math.max(0, Number(row.price) || 0),
              sortOrder: Number(row.sortOrder) || 0,
              isActive: row.isActive !== false,
            };
          }),
        );
      }
    } catch {
      /* لا نعطل الشاشة إن تعذّر الكتالوج */
    } finally {
      setCatalogAddonsReady(true);
    }
  }, [base]);

  useEffect(() => {
    void loadCatalogAddons();
  }, [loadCatalogAddons]);

  /** عند فتح المودال نحدّث الكتالوج من الخادم */
  useEffect(() => {
    if (!addonPickerProduct) return;
    void loadCatalogAddons();
  }, [addonPickerProduct, loadCatalogAddons]);

  useEffect(() => {
    if (!addonPickerProduct) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddonPickerProduct(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addonPickerProduct]);

  useEffect(() => {
    const applyToday = () => setBillDate(new Date().toISOString().slice(0, 10));
    applyToday();
    const id = window.setInterval(applyToday, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (selectedSeat > SHARED_SEAT_NO) setSelectedSeat(SHARED_SEAT_NO);
    if (selectedSeat < 1) setSelectedSeat(1);
  }, [selectedSeat]);

  useEffect(() => {
    setSeatNameEditorSeat(null);
    if (patchSeatTimer.current) window.clearTimeout(patchSeatTimer.current);
    patchSeatTimer.current = null;
    let cancelled = false;
    if (!activeSessionId) {
      setSeatGuestLabels({});
      seatGuestLabelsRef.current = {};
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const r = await fetch(`${base}/api/restaurant/table-sessions?status=active`);
        const j = tryParseJson<{ sessions?: unknown }>(await r.text()) ?? {};
        const list = Array.isArray(j.sessions) ? j.sessions : [];
        const row =
          list.find((x: { id?: string }) => String(x?.id || "") === String(activeSessionId)) ?? undefined;
        const raw = row && typeof row === "object" ? (row as { seatGuestLabels?: unknown }).seatGuestLabels : undefined;
        const next: Record<number, string> = {};
        if (raw && typeof raw === "object") {
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            const n = Number(k);
            if (!Number.isFinite(n) || n < 1 || n > SHARED_SEAT_NO) continue;
            next[n] = String(v ?? "").slice(0, 120);
          }
        }
        if (!cancelled) {
          setSeatGuestLabels(next);
          seatGuestLabelsRef.current = next;
        }
      } catch {
        if (!cancelled) {
          setSeatGuestLabels({});
          seatGuestLabelsRef.current = {};
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, base]);

  useEffect(() => {
    if (assignmentMode !== "per_seat") setSeatNameEditorSeat(null);
  }, [assignmentMode]);

  useEffect(() => {
    setTransferTargetTableId((cur) => {
      if (cur && cur !== selectedTableId) return cur;
      const alt = tables.find((t) => t.id !== selectedTableId);
      return alt?.id || "";
    });
    setMergeTargetTableId((cur) => {
      if (cur && cur !== selectedTableId) return cur;
      const alt = tables.find((t) => t.id !== selectedTableId);
      return alt?.id || "";
    });
  }, [tables, selectedTableId]);

  const urlSessionId = searchParams.get("sessionId");

  const resolveSessionForTable = useCallback(
    async (tableId: string): Promise<string | null> => {
      if (!tableId) return null;
      const vr = await fetch(`${base}/api/restaurant/table-sessions?status=active`);
      const vj = tryParseJson<{ sessions?: unknown }>(await vr.text()) ?? {};
      const sessions = Array.isArray(vj.sessions) ? vj.sessions : [];
      if (urlSessionId) {
        const s = sessions.find(
          (x: { id?: string; tableId?: string }) => String(x.id) === String(urlSessionId)
        );
        if (s && String(s.tableId) === String(tableId)) return String(s.id);
      }
      const existing = sessions.find((x: { tableId?: string }) => String(x.tableId) === String(tableId));
      if (existing?.id) return String(existing.id);
      const cr = await fetch(`${base}/api/restaurant/table-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, guestCount: 2, mat3amActor: buildMat3amActor(user) }),
      });
      if (!cr.ok) return null;
      const rec = tryParseJson<{ id?: string }>(await cr.text());
      return rec?.id ? String(rec.id) : null;
    },
    [base, urlSessionId, user]
  );

  useEffect(() => {
    if (!selectedTableId) {
      setActiveSessionId(null);
      setSessionBusy(false);
      return;
    }
    if (selectedTableBlocked) {
      setActiveSessionId(null);
      setSessionBusy(false);
      return;
    }
    let cancel = false;
    setSessionBusy(true);
    void resolveSessionForTable(selectedTableId)
      .then((sid) => {
        if (!cancel) setActiveSessionId(sid);
      })
      .finally(() => {
        if (!cancel) setSessionBusy(false);
      });
    return () => {
      cancel = true;
    };
  }, [selectedTableId, resolveSessionForTable, selectedTableBlocked]);

  const loadSessionOrders = useCallback(async () => {
    if (!activeSessionId) {
      setSessionOrders([]);
      return;
    }
    setOrdersBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/orders?sessionId=${encodeURIComponent(activeSessionId)}`);
      const j = tryParseJson<{ orders?: unknown }>(await r.text()) ?? {};
      const list = Array.isArray(j.orders) ? j.orders : [];
      setSessionOrders(list as ServerOrder[]);
    } catch {
      setSessionOrders([]);
    } finally {
      setOrdersBusy(false);
    }
  }, [base, activeSessionId]);

  const refreshSessionBilling = useCallback(async () => {
    if (!activeSessionId) {
      setBillingRequestedAt(null);
      setSessionBillingProfile(null);
      return;
    }
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions?status=active`);
      const j = tryParseJson<{ sessions?: unknown }>(await r.text()) ?? {};
      const sessions = Array.isArray(j.sessions) ? j.sessions : [];
      const s = sessions.find(
        (x: { id?: string; billingRequestedAt?: string; billingProfile?: unknown }) => String(x.id) === String(activeSessionId)
      ) as { billingRequestedAt?: string; billingProfile?: SessionBillingProfile } | undefined;
      setBillingRequestedAt(s?.billingRequestedAt ? String(s.billingRequestedAt) : null);
      const bp = s?.billingProfile;
      setSessionBillingProfile(bp && typeof bp === "object" ? bp : null);
    } catch {
      setBillingRequestedAt(null);
      setSessionBillingProfile(null);
    }
  }, [base, activeSessionId]);

  useEffect(() => {
    void refreshSessionBilling();
  }, [refreshSessionBilling]);

  useEffect(() => {
    void loadSessionOrders();
    const id = window.setInterval(() => void loadSessionOrders(), 12000);
    return () => window.clearInterval(id);
  }, [loadSessionOrders]);

  const filteredProducts = useMemo(() => {
    let list = menuEligibleProducts;
    if (categoryKey !== "all") {
      list = list.filter((p) => (p.GroupGuid || "") === categoryKey);
    }
    return list;
  }, [menuEligibleProducts, categoryKey]);

  useEffect(() => {
    if (categoryKey === "all") return;
    if (waiterMenuGroups.some((g) => g.CardGuide === categoryKey)) return;
    setCategoryKey("all");
  }, [categoryKey, waiterMenuGroups]);

  const cartForPromo = useMemo(
    () => cart.map((l) => ({ id: l.id, productGuide: l.productGuide, name: l.name, qty: l.qty, unitPrice: l.unitPrice })),
    [cart]
  );

  const promoResult = useMemo(() => applyPromotions(cartForPromo, promotions, couponCode), [cartForPromo, promotions, couponCode]);

  const gross = useMemo(() => cart.reduce((a, l) => a + l.qty * l.unitPrice, 0), [cart]);
  const lineDiscountTotal = useMemo(
    () => Object.values(promoResult.lineDiscounts).reduce((a, v) => a + v, 0),
    [promoResult.lineDiscounts]
  );
  const discountValue = promoResult.invoiceDiscount + lineDiscountTotal;
  const netBeforeTax = Math.max(0, gross - discountValue);

  const effectiveTableMinimum = useMemo(() => {
    if (isDeliveryEmbedded) return 0;
    if (!selectedTable) return 0;
    const tmc = toNum(selectedTable.minimumCharge, 0);
    if (tmc > 0) return tmc;
    return Math.max(0, tableMinDefaultOps);
  }, [selectedTable, isDeliveryEmbedded, tableMinDefaultOps]);

  const netAfterMinimum =
    effectiveTableMinimum > 0 && !isDeliveryEmbedded ? Math.max(netBeforeTax, effectiveTableMinimum) : netBeforeTax;

  const minimumChargeDelta =
    effectiveTableMinimum > 0 && !isDeliveryEmbedded && netBeforeTax < effectiveTableMinimum
      ? effectiveTableMinimum - netBeforeTax
      : 0;

  const billingTotals = useMemo(() => {
    const sbp = sessionBillingProfile;
    const billActive = !!(sbp && typeof sbp === "object" && sbp.active !== false);
    const vipPct = billActive ? Math.max(0, Math.min(100, toNum(sbp?.discountPct, 0))) : 0;
    const netAfterOwner = billActive ? Math.max(0, netAfterMinimum * (1 - vipPct / 100)) : netAfterMinimum;
    const ownerTpl = billActive && String(sbp?.source || "") === "vip_owner_template";
    if (!billActive) {
      const baseAmount = policy.applyDiscountBeforeTax ? netAfterMinimum : gross;
      const svc = (baseAmount * policy.servicePercent) / 100;
      const vat =
        policy.serviceBeforeVat
          ? ((netAfterMinimum + svc) * policy.vatPercent) / 100
          : (netAfterMinimum * policy.vatPercent) / 100;
      return {
        netPortion: netAfterMinimum,
        serviceCharge: svc,
        vatValue: vat,
        ownerDiscountPct: 0,
        ownerTpl: false,
        costPricingNote: false,
      };
    }
    const costNote = billActive && String(sbp?.priceMode || "").toLowerCase() === "cost_plus";
    const svc =
      sbp?.noService ? 0 : (netAfterOwner * policy.servicePercent) / 100;
    let vat = 0;
    if (!sbp?.noVat) {
      vat =
        policy.serviceBeforeVat
          ? ((netAfterOwner + svc) * policy.vatPercent) / 100
          : (netAfterOwner * policy.vatPercent) / 100;
    }
    return {
      netPortion: netAfterOwner,
      serviceCharge: svc,
      vatValue: vat,
      ownerDiscountPct: vipPct,
      ownerTpl,
      costPricingNote: costNote,
    };
  }, [
    sessionBillingProfile,
    netAfterMinimum,
    gross,
    policy.applyDiscountBeforeTax,
    policy.servicePercent,
    policy.serviceBeforeVat,
    policy.vatPercent,
  ]);

  const serviceCharge = billingTotals.serviceCharge;
  const vatValue = billingTotals.vatValue;
  const total = Math.max(
    0,
    billingTotals.netPortion + serviceCharge + vatValue + Math.max(0, tipAmount || 0)
  );
  const itemCount = cart.reduce((a, l) => a + l.qty, 0);
  const billingLocked = Boolean(billingRequestedAt);

  useEffect(() => {
    if (isDeliveryEmbedded || minimumChargeDelta <= 0.001 || billingLocked || orderTakingLocked) {
      setGapPickHits([]);
      setGapPickBusy(false);
      return;
    }
    let cancelled = false;
    setGapPickBusy(true);
    const maxPx = Math.round(minimumChargeDelta * 100) / 100;
    void (async () => {
      try {
        const r = await safeFetch(
          `${base}/api/products/picks-under-price?max_price=${encodeURIComponent(String(maxPx))}&limit=28`,
        );
        const t = await r.text();
        if (cancelled || !r.ok) {
          if (!cancelled) setGapPickHits([]);
          return;
        }
        const j = tryParseJson<{ products?: unknown[] }>(t) ?? {};
        const arr = Array.isArray(j.products) ? j.products : [];
        const mapped: Product[] = [];
        for (const row of arr) {
          const p = row as Record<string, unknown>;
          const cg = String(p.CardGuide || "").trim();
          if (!cg) continue;
          const price = Number(p.Price ?? p.AgentPrice ?? 0) || 0;
          mapped.push({
            CardGuide: cg,
            ProductName: String(p.ProductName || ""),
            Price: price,
            AgentPrice: Number(p.AgentPrice ?? p.Price ?? 0) || 0,
          });
        }
        if (!cancelled) setGapPickHits(mapped.filter((p) => isOnWaiterMenu(p.CardGuide, p.ProductName || "")));
      } catch {
        if (!cancelled) setGapPickHits([]);
      } finally {
        if (!cancelled) setGapPickBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, minimumChargeDelta, isDeliveryEmbedded, billingLocked, orderTakingLocked, isOnWaiterMenu]);

  const addonPreview = useMemo(() => {
    if (!addonPickerProduct) {
      return { base: 0, addons: 0, unit: 0, service: 0, vat: 0, total: 0 };
    }
    const base = resolveGuestUnitPrice(addonPickerProduct, sessionBillingProfile);
    const picked = activeCatalogAddons.filter((r) => addonPickerSel[r.id]);
    const addons = picked.reduce((s, a) => s + Math.max(0, Number(a.price || 0)), 0);
    const unit = Math.max(0, base + addons);
    const service = Math.max(0, (unit * Number(policy.servicePercent || 0)) / 100);
    const vatBase = policy.serviceBeforeVat ? unit + service : unit;
    const vat = Math.max(0, (vatBase * Number(policy.vatPercent || 0)) / 100);
    const total = Math.max(0, unit + service + vat);
    return { base, addons, unit, service, vat, total };
  }, [
    addonPickerProduct,
    addonPickerSel,
    activeCatalogAddons,
    policy.servicePercent,
    policy.vatPercent,
    policy.serviceBeforeVat,
    sessionBillingProfile,
  ]);

  function pushCartLineForProduct(p: Product, addons: CatalogAddonRow[], kitchenNotesRaw = "", qtyRaw = 1) {
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`الطاولة مسندة إلى جرسون الطلبات: ${captainGate.name}. لا يمكن إضافة بنود إلا من حساب المسند أو عبر المدير (قفل الطاولة مفعّل).`);
      return;
    }
    if (selectedTableBlocked) {
      setMsg("الطاولة غير جاهزة للطلبات (متسخة/قيد التنظيف).");
      return;
    }
    if (!isOnWaiterMenu(p.CardGuide, p.ProductName || "")) {
      setMsg("هذا الصنف خارج القائمة اليومية — راجع إعدادات «المنيو والقائمة اليومية».");
      return;
    }
    const stopNote = kitchenStopNote(p.CardGuide);
    if (isKitchenStopped(p.CardGuide)) {
      setMsg(`الصنف غير متاح الآن من المطبخ: ${p.ProductName}${stopNote ? ` — ${stopNote}` : ""}`);
      return;
    }
    if (billingLocked) {
      setMsg("تم طلب الحساب — لا يمكن إضافة بنود حتى يُسدّد الكاشير.");
      return;
    }
    const notesForLine = String(kitchenNotesRaw || "").trim().slice(0, 300);
    const addQty = Math.max(1, Math.round(Number(qtyRaw) || 1));
    const addonKey = addonRowsKey(addons);
    const basePrice = resolveGuestUnitPrice(p, sessionBillingProfile);
    const addonSum = addons.reduce((s, a) => s + Math.max(0, a.price), 0);
    const unitPrice = basePrice + addonSum;
    const bits = addons.map((a) => String(a.label || "").trim()).filter(Boolean);
    const lineName = bits.length ? `${p.ProductName} (+ ${bits.join("، ")})` : p.ProductName;
    const sn = assignmentMode === "general" ? null : selectedSeat;
    setCart((prev) => {
      const ex = prev.find((x) => {
        const xn = seatNoFromLine(x);
        const ak = x.addonIdsKey ?? "";
        const nk = String(x.kitchenNotes || "").trim();
        return x.productGuide === p.CardGuide && (sn == null ? xn == null : xn === sn) && ak === addonKey && nk === notesForLine;
      });
      if (ex) {
        return prev.map((x) => {
          const xn = seatNoFromLine(x);
          const ak = x.addonIdsKey ?? "";
          const nk = String(x.kitchenNotes || "").trim();
          const match =
            x.productGuide === p.CardGuide && (sn == null ? xn == null : xn === sn) && ak === addonKey && nk === notesForLine;
          return match ? { ...x, qty: x.qty + addQty } : x;
        });
      }
      return [
        ...prev,
        {
          id: lineId(),
          productGuide: p.CardGuide,
          name: lineName,
          qty: addQty,
          unitPrice,
          seatLabel: null,
          seatNo: sn,
          ...(addonKey ? { addonIdsKey: addonKey } : {}),
          ...(notesForLine ? { kitchenNotes: notesForLine } : {}),
        },
      ];
    });
  }

  /** ضغطة على صنف: دائماً خطوة اختيار إضافات (مودال) — تجنّباً لتخطّي المودال عند تأخّر الشبكة أو كتالوج فارغ */
  function beginAddProduct(p: Product) {
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`الطاولة مسندة إلى جرسون الطلبات: ${captainGate.name}. لا يمكن إضافة بنود إلا من حساب المسند أو عبر المدير (قفل الطاولة مفعّل).`);
      return;
    }
    if (selectedTableBlocked) {
      setMsg("الطاولة غير جاهزة للطلبات (متسخة/قيد التنظيف).");
      return;
    }
    if (!isOnWaiterMenu(p.CardGuide, p.ProductName || "")) {
      setMsg("هذا الصنف خارج القائمة اليومية — راجع إعدادات «المنيو والقائمة اليومية».");
      return;
    }
    if (isKitchenStopped(p.CardGuide)) {
      const stopNote = kitchenStopNote(p.CardGuide);
      setMsg(`الصنف غير متاح الآن من المطبخ: ${p.ProductName}${stopNote ? ` — ${stopNote}` : ""}`);
      return;
    }
    if (billingLocked) {
      setMsg("تم طلب الحساب — لا يمكن إضافة بنود حتى يُسدّد الكاشير.");
      return;
    }
    setAddonPickerProduct(p);
    setAddonPickerSel({});
    setAddonPickerNotes("");
    setAddonPickerQty(1);
  }

  function confirmAddonPicker(opts: { withoutAddons: boolean }) {
    const p = addonPickerProduct;
    if (!p) return;
    const notes = String(addonPickerNotes || "").trim();
    const qty = Math.max(1, Math.round(Number(addonPickerQty) || 1));
    setAddonPickerProduct(null);
    setAddonPickerNotes("");
    setAddonPickerQty(1);
    if (opts.withoutAddons) {
      pushCartLineForProduct(p, [], notes, qty);
      return;
    }
    const picked = activeCatalogAddons.filter((r) => addonPickerSel[r.id]);
    pushCartLineForProduct(p, picked, notes, qty);
  }

  function setQty(lineIdStr: string, qty: number) {
    if (billingLocked || orderTakingLocked) return;
    setCart((prev) =>
      prev
        .map((l) => (l.id === lineIdStr ? { ...l, qty: qty > 0 ? qty : 0 } : l))
        .filter((l) => l.qty > 0)
    );
  }

  function removeLine(lineIdStr: string) {
    if (billingLocked || orderTakingLocked) return;
    setCart((prev) => prev.filter((l) => l.id !== lineIdStr));
  }

  function clearSeatLines(seatNum: number) {
    if (billingLocked || orderTakingLocked) return;
    setCart((prev) => prev.filter((l) => seatNoFromLine(l) !== seatNum));
  }

  async function cancelServerOrder(orderId: string) {
    setMsg("");
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`إلغاء الطلبات من هذه الشاشة لمَن سُكِّنَت الطاولة لهم فقط (${captainGate.name}) أو للمدير — قفل المسند مفعّل.`);
      return;
    }
    if (billingLocked) {
      setMsg("بعد طلب الحساب لا يمكن إلغاء الطلبات من هنا.");
      return;
    }
    try {
      const r = await fetch(`${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg("تم إلغاء الطلب (لم يبدأ المطبخ بعد).");
      void loadSessionOrders();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function submitSale() {
    setMsg("");
    if (!cart.length) {
      setMsg("الطلب فارغ.");
      return;
    }
    if (!selectedTable) {
      setMsg("اختر طاولة.");
      return;
    }
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`مسند هذه الطاولة (${captainGate.name}) هو من يمكنه الإرسال — قفل الطاولة على المسند مفعّل.`);
      return;
    }
    if (selectedTableBlocked) {
      setMsg("الطاولة غير جاهزة للطلبات (متسخة/قيد التنظيف).");
      return;
    }
    if (!activeSessionId) {
      setMsg(sessionBusy ? "جاري تجهيز الجلسة…" : "تعذر ربط جلسة نشطة بالطاولة. حدّث الصفحة أو تحقق من الاتصال.");
      return;
    }
    setLoading(true);
    try {
      const items = cart.map((l) => {
        const sn = seatNoFromLine(l);
        const tag = assignmentMode === "general" || sn == null ? null : seatGuestDisplay(sn);
        const kn = String(l.kitchenNotes || "").trim();
        let nm = tag ? `${l.name} (${tag})` : l.name;
        if (kn) nm += ` — ${kn.slice(0, 160)}`;
        return {
          productGuide: l.productGuide,
          menuItemId: l.productGuide,
          name: nm,
          quantity: l.qty,
          unitPrice: l.unitPrice,
          ...(assignmentMode === "general" || sn == null ? {} : { seatNo: sn }),
        };
      });

      const orderKind =
        String(embeddedChannel || "").trim().toLowerCase() === "delivery" ? "delivery" : "table";

      const body = {
        orderType: orderKind,
        sessionId: activeSessionId,
        tableId: selectedTableId,
        tableGuid: selectedTableId,
        tableName: selectedTable?.name || "",
        agentGuid: selectedAgentGuid || undefined,
        billDate: billDate || undefined,
        generalOrder: assignmentMode === "general",
        paymentMethod: "cash",
        postToSqlInvoice: false,
        items,
        subtotal: billingTotals.netPortion,
        discountValue,
        serviceCharge,
        tax: vatValue,
        tipAmount: Math.max(0, tipAmount || 0),
        total,
        mat3amActor: buildMat3amActor(user),
      };

      const r = await safeFetch(`${base}/api/restaurant/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setCart([]);
      setCouponCode("");
      setMsg("تم إرسال الطلب للمطبخ (الفاتورة تُنشأ عند «طلب الحساب» فقط).");
      // لا ننتظر إعادة جلب الطلبات — تخفيف ثقل «جاري الإرسال» بعد رد الخادم
      void loadSessionOrders();
      // Shared Terminal: إقفال تلقائي بعد كل إرسال للمطبخ (إن كان الإعداد مفعَّلاً)
      try { terminalLock.triggerLock("send"); } catch { /* صامت */ }
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function requestBill() {
    setMsg("");
    if (!activeSessionId) {
      setMsg("لا توجد جلسة نشطة.");
      return;
    }
    if (billingLocked) {
      setMsg("طُلِب الحساب مسبقاً — انتظر تسديد الكاشير.");
      return;
    }
    setRequestBillBusy(true);
    try {
      let splitGroups: Array<{ id: string; name: string; seats: number[] }> = [];
      if (splitBySeat) {
        const openOrders = sessionOrders.filter((o) => String(o.status || "").toLowerCase() !== "cancelled");
        const seatsWithItems = new Set<number>();
        for (const o of openOrders) {
          for (const it of o.items || []) {
            const sx = extractSeatFromOrderItem(it as { name?: string; seatNo?: number });
            if (sx != null) seatsWithItems.add(sx);
          }
        }
        const groupsBuild: typeof splitGroups = [];
        for (let i = 1; i <= SEAT_SLOT_COUNT; i++) {
          const label = String(seatGuestLabels[i] ?? "").trim();
          if (!label) continue;
          if (!seatsWithItems.has(i)) continue;
          groupsBuild.push({ id: `check-${i}`, name: label, seats: [i] });
        }
        const orphanSeats = [...seatsWithItems]
          .filter((i) => i !== SHARED_SEAT_NO && !String(seatGuestLabels[i] ?? "").trim())
          .sort((a, b) => a - b);
        if (orphanSeats.length > 0) {
          groupsBuild.push({ id: "check-rest", name: "بدون تسمية مقعد / باقي الطاولة", seats: orphanSeats });
        }
        splitGroups = groupsBuild;
      }
      const r = await fetch(`${base}/api/restaurant/sessions/request-bill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          splitBySeat,
          seatGroups: splitGroups,
          tipAmount: Math.max(0, tipAmount || 0),
          agentGuid: selectedAgentGuid || undefined,
          billDate: billDate || undefined,
          mat3amActor: buildMat3amActor(user),
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ splitApplied?: boolean; invoices?: Array<{ name?: string }> }>(t) ?? {};
      if (!r.ok) throw new Error(t);
      if (j.splitApplied && Array.isArray(j.invoices) && j.invoices.length > 1) {
        setMsg(`تم طلب الحساب وتقسيمه إلى ${j.invoices.length} شيكات حسب الكراسي.`);
      } else {
        setMsg("تم طلب الحساب — الفاتورة جاهزة عند الكاشير للتسديد.");
      }
      void refreshSessionBilling();
      void loadSessionOrders();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setRequestBillBusy(false);
    }
  }

  async function transferTable() {
    setMsg("");
    if (!activeSessionId || !transferTargetTableId) return;
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`تحويل الجلسة ضمن مسند الطاولة (${captainGate.name}) أو المدير.`);
      return;
    }
    if (transferTargetTableId === selectedTableId) {
      setMsg("اختر طاولة مختلفة للتحويل.");
      return;
    }
    setSessionMoveBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: transferTargetTableId, actor: "waiter", mat3amActor: buildMat3amActor(user) }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setSelectedTableId(transferTargetTableId);
      setTransferTargetTableId("");
      setTransferPickQuery("");
      setTransferSearchResults(null);
      setMsg("تم تحويل الجلسة إلى الطاولة الجديدة.");
      void loadSessionOrders();
      void loadAll();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSessionMoveBusy(false);
    }
  }

  async function mergeIntoTable() {
    setMsg("");
    if (!activeSessionId || !mergeTargetTableId) return;
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`دمج الجلسات ضمن مسند الطاولة (${captainGate.name}) أو المدير.`);
      return;
    }
    if (mergeTargetTableId === selectedTableId) {
      setMsg("اختر طاولة مختلفة للدمج.");
      return;
    }
    setSessionMoveBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTableId: mergeTargetTableId, actor: "waiter", mat3amActor: buildMat3amActor(user) }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setSelectedTableId(mergeTargetTableId);
      setMergeTargetTableId("");
      setMergePickQuery("");
      setMergeSearchResults(null);
      setMsg("تم دمج الطاولة الحالية مع الطاولة الهدف ونقل الطلبات للجلسة الهدف.");
      void loadSessionOrders();
      void loadAll();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSessionMoveBusy(false);
    }
  }

  const prevAssignmentModeRef = useRef<"per_seat" | "general" | null>(null);

  const clearMobileFlowToastTimer = useCallback(() => {
    if (mobileFlowToastTimer.current) {
      window.clearTimeout(mobileFlowToastTimer.current);
      mobileFlowToastTimer.current = null;
    }
  }, []);

  const showMobileFlowToast = useCallback(
    (text: string, ms = 9000) => {
      clearMobileFlowToastTimer();
      setMobileFlowToast(text);
      mobileFlowToastTimer.current = window.setTimeout(() => {
        setMobileFlowToast("");
        mobileFlowToastTimer.current = null;
      }, ms);
    },
    [clearMobileFlowToastTimer],
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${WAITER_OT_NARROW_MAX_PX}px)`);
    const fn = () => setNarrowOtViewport(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => () => clearMobileFlowToastTimer(), [clearMobileFlowToastTimer]);

  useEffect(() => {
    if (useCaptainMobileUi) setCaptainTab("menu");
  }, [useCaptainMobileUi]);

  useEffect(() => {
    const prev = prevCategoryKeyRef.current;
    const changed = prev !== categoryKey;
    prevCategoryKeyRef.current = categoryKey;
    if (!narrowOtViewport || !changed) return;
    if (useCaptainMobileUi) {
      setCaptainTab("menu");
      return;
    }
    const t = window.setTimeout(() => {
      document.getElementById("waiter-ot-sec-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [categoryKey, narrowOtViewport, useCaptainMobileUi]);

  const goToNextSeatMobile = useCallback(() => {
    setSeatNameEditorSeat(null);
    setSeatPanelMobCollapsed(false);
    setSelectedSeat((prev) => {
      const idx = SEAT_MOBILE_NAV_ORDER.findIndex((x) => x === prev);
      const i = idx < 0 ? 0 : (idx + 1) % SEAT_MOBILE_NAV_ORDER.length;
      return SEAT_MOBILE_NAV_ORDER[i]!;
    });
    if (typeof window !== "undefined" && window.matchMedia(`(max-width: ${WAITER_OT_NARROW_MAX_PX}px)`).matches) {
      showMobileFlowToast("المقعد التالي: عدّل الاسم ثم ✓. أنهيت؟ راجع «قيد الإرسال» ثم أرسل.");
      if (useCaptainMobileUi) {
        setCaptainTab("guests");
      } else {
        requestAnimationFrame(() => {
          document.getElementById("waiter-ot-sec-distribute")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  }, [showMobileFlowToast, useCaptainMobileUi]);

  const afterSeatNameConfirmGoCategories = useCallback(() => {
    setSeatNameEditorSeat(null);
    if (typeof window !== "undefined" && window.matchMedia(`(max-width: ${WAITER_OT_NARROW_MAX_PX}px)`).matches) {
      setSeatPanelMobCollapsed(true);
      showMobileFlowToast("اختر الفئة — ثم تبويب «أصناف» للشبكة.");
      if (useCaptainMobileUi) {
        setCaptainTab("menu");
        return;
      }
      requestAnimationFrame(() => {
        document.getElementById("waiter-ot-sec-categories")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      document.getElementById("waiter-ot-sec-categories")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showMobileFlowToast, useCaptainMobileUi]);

  useEffect(() => {
    const prev = prevAssignmentModeRef.current;
    prevAssignmentModeRef.current = assignmentMode;
    if (prev === null) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia(`(max-width: ${WAITER_OT_NARROW_MAX_PX}px)`).matches) return;
    setSeatPanelMobCollapsed(false);
    if (useCaptainMobileUi) {
      setCaptainTab(assignmentMode === "general" ? "menu" : "guests");
      return;
    }
    requestAnimationFrame(() => {
      if (assignmentMode === "general") {
        document.getElementById("waiter-ot-sec-categories")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        document.getElementById("waiter-ot-sec-distribute")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [assignmentMode, useCaptainMobileUi]);

  async function summonCashier() {
    setMsg("");
    if (!activeSessionId) {
      setMsg("لا توجد جلسة نشطة.");
      return;
    }
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`من نافذة الطاولات ستعرض هذه الطاولة تحت اسم مسند الطلب: ${captainGate.name}. الاستدعاء من هذه الشاشة لمسند الجلسة فقط.`);
      return;
    }
    setSummonBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "waiter_summon",
          sourceKey: `waiter_summon:${activeSessionId}`,
          title: "استدعاء من الجرسون",
          body: String(selectedTable?.name || selectedTableId || "طاولة").slice(0, 200),
          tableId: selectedTableId,
          sessionId: activeSessionId,
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ deduped?: boolean }>(t) ?? {};
      if (!r.ok) throw new Error(t);
      setMsg(j.deduped ? "أُرسل تنبيه مؤخراً لنفس الجلسة — انتظر حتى ٣ دقائق أو تجاهل الكاشير للتنبيه." : "تم إخطار الكاشير.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSummonBusy(false);
    }
  }

  return (
    <div
      className={`role-op waiter-pos waiter-pos--order-taker${narrowOtViewport && assignmentMode === "per_seat" ? " waiter-pos--ot-rail-guests" : ""}${
        useCaptainMobileUi ? " waiter-pos--ot-ui-captain" : ""
      }${showCaptainGuestDock ? " waiter-pos--captain-guest-dock-on" : ""}`}
      {...(useCaptainMobileUi ? { "data-ot-captain-tab": captainTab } : {})}
    >
      <OperationalRoleHeader
        roleTitle={pageTitle?.trim() ? pageTitle : "✦ OYA Resturant ✦"}
        backTo={orderTakerExitPath}
        hideUser
        titleSub={<span className="waiter-pos__producer-inline">© 2026 Sir Consult for Information Technology · SQL</span>}
        titleStyle={{
          fontSize: "1.15rem",
          fontWeight: 900,
          lineHeight: 1,
          fontStyle: "italic",
          letterSpacing: "0.03em",
          fontFamily: "'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', cursive",
          color: "#e879f9",
          textShadow: "0 0 7px rgba(232,121,249,0.95), 0 0 14px rgba(217,70,239,0.7)",
          borderBottom: "2px solid rgba(232,121,249,0.85)",
          paddingBottom: 2,
          whiteSpace: "nowrap",
        }}
        rightSlot={
          <div className="waiter-pos__hdr-tools" style={{ display: "grid", gridTemplateColumns: "minmax(560px, 1fr) minmax(250px, 290px) 36px", alignItems: "center", gap: 4, direction: "ltr", minWidth: 0, width: "100%" }}>
            {useCaptainMobileUi && appMenu ? (
              <button
                type="button"
                className="waiter-pos__hall-menu-btn"
                aria-label="قائمة الصالة"
                title="القائمة الرئيسية"
                onClick={appMenu.openAppMenu}
              >
                ☰
              </button>
            ) : null}
            <div className="waiter-pos__hdr-actions" style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap", justifyContent: "flex-start", maxWidth: "none", overflow: "hidden" }}>
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-mini-btn waiter-pos__hdr-mini-btn--hall" onClick={() => navigate("/app/waiter/dashboard")}>لوحة الصالة</button>
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-mini-btn waiter-pos__hdr-mini-btn--tables" onClick={() => navigate("/app/waiter/tables")}>الطاولات</button>
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-mini-btn waiter-pos__hdr-mini-btn--order" onClick={() => navigate("/app/waiter/order-taker")}>طلب للطاولة</button>
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-mini-btn waiter-pos__hdr-mini-btn--quick" onClick={() => navigate("/app/waiter/pos")}>طلب سريع</button>
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-mini-btn waiter-pos__hdr-mini-btn--report" onClick={() => setShowSummary((prev) => !prev)}>{showSummary ? "إخفاء التقرير" : "تقرير الطاولة"}</button>
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-mini-btn waiter-pos__hdr-mini-btn--cashier" disabled={summonBusy || !activeSessionId} onClick={() => void summonCashier()}>{summonBusy ? "…" : "استدعاء كاشير"}</button>
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-mini-btn waiter-pos__hdr-mini-btn--bill" disabled={requestBillBusy || !activeSessionId || billingLocked} onClick={() => void requestBill()}>{requestBillBusy ? "…" : "طلب الحساب"}</button>
              <input className="waiter-pos__coupon waiter-pos__hdr-coupon" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="قيمة الكوبون" disabled={billingLocked} />
            </div>
            <div className="waiter-pos__hdr-tools-col" style={{ display: "grid", gridTemplateColumns: "minmax(118px, 1fr) minmax(112px, 0.9fr) minmax(86px, 0.72fr)", alignItems: "center", gap: 4, minWidth: 0 }}>
              <select
                className="waiter-pos__select"
                value={selectedAgentGuid}
                onChange={(e) => setSelectedAgentGuid(e.target.value)}
                aria-label="اسم العميل"
                style={{ minWidth: 118, width: "100%", fontSize: "0.78rem", fontWeight: 700, padding: "0.32rem 0.45rem", textAlign: "right", height: 30 }}
              >
                {agents.length === 0 ? (
                  <option value="">اسم العميل</option>
                ) : (
                  agents.map((a) => (
                    <option key={a.CardGuide} value={a.CardGuide}>
                      {a.AgentName}
                    </option>
                  ))
                )}
              </select>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                aria-label="التاريخ"
                style={{ minWidth: 112, width: "100%", fontSize: "0.78rem", fontWeight: 700, padding: "0.32rem 0.45rem", borderRadius: 8, border: "1px solid #1e40af", background: "#fff", color: "#0f172a", height: 30 }}
              />
              <select
                className="waiter-pos__select"
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                aria-label="اختيار الطاولة"
                style={{ minWidth: 92, width: "100%", maxWidth: "100%", fontSize: "0.9rem", fontWeight: 800, padding: "0.35rem 0.55rem", textAlign: "center", flexShrink: 0, height: 30 }}
              >
                {tables.length === 0 ? (
                  <option value="" disabled>لا توجد طاولات — تحقق من TBL005 أو مزامنة المخطط</option>
                ) : (
                  tables.map((t) => (
                    <option key={t.id} value={t.id} disabled={["dirty", "cleaning"].includes(normalizeTableStatus(String((t as any).status || "")))}>
                      {tableDisplayName(t) || `طاولة ${t.number ?? ""}`}{["dirty", "cleaning"].includes(normalizeTableStatus(String((t as any).status || ""))) ? " (غير جاهزة)" : ""}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="waiter-pos__hdr-close-wrap">
              <button
                type="button"
                className="waiter-pos__close"
                onClick={() => navigate("/app/waiter/tables")}
                aria-label="إغلاق"
                style={{ background: "#dc2626", color: "#fff", border: "1px solid #b91c1c", height: 36, width: 36, fontSize: "1.2rem", borderRadius: 10 }}
              >
                ×
              </button>
            </div>
          </div>
        }
      />

      {orderTakingLocked && captainGate?.name ? (
        <div
          role="status"
          style={{
            margin: "0 1rem 0.5rem",
            padding: "10px 14px",
            borderRadius: 12,
            background: "rgba(127, 29, 29, 0.12)",
            border: "1px solid rgba(185, 28, 28, 0.45)",
            color: "#7f1d1d",
            fontWeight: 800,
            fontSize: "0.92rem",
            lineHeight: 1.45,
            textAlign: "right",
          }}
        >
          هذه الطاولة تحت مسند جرسون الطلبات: <strong>{captainGate.name}</strong>. مع تفعيل قفل الطاولة لا يمكن إصدار الطلبات من حسابك؛ راجع لوحة الطاولات ثم المدير إن احتجت التحويل.
        </div>
      ) : activeSessionId &&
        captainGate?.name &&
        user?.role === "waiter" &&
        captainGate.id &&
        String(captainGate.id) !== String(user?.id) &&
        !orderTakerExclusiveTable ? (
        <div
          style={{
            margin: "0 1rem 0.5rem",
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(30, 64, 175, 0.08)",
            border: "1px solid rgba(59, 130, 246, 0.35)",
            color: "#1e3a8a",
            fontWeight: 750,
            fontSize: "0.84rem",
            textAlign: "right",
          }}
        >
          مسند هذه الطاولة على الشريحة: <strong>{captainGate.name}</strong> — قفل الطاولة معطّل في الإعدادات فيمكنكم التعامل مع الحذر.
        </div>
      ) : null}

      {String(msg || "").trim() ? (
        <div
          role="alert"
          aria-live="polite"
          style={{
            margin: "0 1rem 0.75rem",
            padding: "12px 14px",
            borderRadius: 12,
            background:
              /تم إرسال|تم تحويل|تم طلب|تم إخطار|تم إلغاء|تم دمج/.test(String(msg))
                ? "rgba(22, 163, 74, 0.12)"
                : /فشل|تعذر|لا يمكن|مسند|قفل|غير جاهز|الطلب فارغ|اختر طاولة|لا يوجد اتصال|Failed to fetch|API متوقف|SQL غير|لا توجد طاولة/.test(
                    String(msg),
                  )
                  ? "rgba(185, 28, 28, 0.1)"
                  : "rgba(30, 64, 175, 0.08)",
            border:
              /تم إرسال|تم تحويل|تم طلب|تم إخطار|تم إلغاء|تم دمج/.test(String(msg))
                ? "1px solid rgba(22, 163, 74, 0.45)"
                : /فشل|تعذر|لا يمكن|مسند|قفل|غير جاهز|الطلب فارغ|اختر طاولة|لا يوجد اتصال|Failed to fetch|API متوقف|SQL غير|لا توجد طاولة/.test(
                    String(msg),
                  )
                  ? "1px solid rgba(185, 28, 28, 0.4)"
                  : "1px solid rgba(59, 130, 246, 0.35)",
            color: "#0f172a",
            fontWeight: 750,
            fontSize: "0.92rem",
            lineHeight: 1.45,
            textAlign: "right",
          }}
        >
          <div style={{ whiteSpace: "pre-wrap" }}>{msg}</div>
          {/failed to fetch|لا يوجد اتصال|API متوقف|run_full_stack/i.test(String(msg)) ? (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
                إعادة المحاولة
              </button>
              <a className="btn btn-ghost" href="http://127.0.0.1:2288/api/ping" target="_blank" rel="noreferrer">
                فحص API (2288)
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {showSummary && (
        <div className="card waiter-pos__summary-panel" style={{ margin: "0.75rem 1rem", padding: "1rem 1.1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800 }}>{selectedTable?.name ?? "طاولة"}</div>
            <button type="button" className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={() => setShowSummary(false)}>
              إغلاق
            </button>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.5rem", fontSize: "0.95rem" }}>
            <span style={{ padding: "6px 11px", borderRadius: 999, background: "#dcfce7", color: "#14532d", fontWeight: 700 }}>
              عناصر السلة: {cart.reduce((a, l) => a + l.qty, 0)}
            </span>
            <span style={{ padding: "6px 11px", borderRadius: 999, background: "#dbeafe", color: "#1e3a8a", fontWeight: 700 }}>
              طلبات الجلسة: {sessionOrders.length}
            </span>
            <span style={{ padding: "6px 11px", borderRadius: 999, background: "#fef3c7", color: "#92400e", fontWeight: 700 }}>
              مطبخ قيد التجهيز: {sessionOrders.filter((o: any) => ["pending", "preparing"].includes(String(o?.status || "").toLowerCase())).length}
            </span>
            <span style={{ padding: "6px 11px", borderRadius: 999, background: "#ffe4e6", color: "#9f1239", fontWeight: 700 }}>
              طلب حساب: {billingLocked ? "نعم" : "لا"}
            </span>
            <span style={{ padding: "6px 11px", borderRadius: 999, background: "#e2e8f0", color: "#1e293b", fontWeight: 700 }}>
              إجمالي السلة التقريبي: {cart.reduce((a, l) => a + l.qty * l.unitPrice, 0).toFixed(2)} ج.م
            </span>
          </div>
          <div style={{ marginTop: "0.6rem" }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: "0.88rem" }}>طلبات الطاولة</div>
            {sessionOrders.filter((o) => (o.status || "").toLowerCase() !== "cancelled").length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>لا توجد طلبات مرسلة بعد.</div>
            ) : (
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                {sessionOrders
                  .filter((o) => (o.status || "").toLowerCase() !== "cancelled")
                  .slice()
                  .reverse()
                  .map((o) => {
                    const st = String(o.status || "").toLowerCase();
                    const lines = activeOrderItems(o).map(formatOrderItemLine);
                    const canCancel = st === "pending";
                    return (
                      <div
                        key={`sum-${o.id}`}
                        style={{
                          minWidth: 320,
                          maxWidth: 380,
                          border: "1px solid #dbeafe",
                          borderRadius: 12,
                          padding: "12px 14px",
                          background: "#f8fbff",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.84rem",
                            fontWeight: 800,
                            marginBottom: 6,
                            color: "#0f172a",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 6,
                          }}
                        >
                          <span>
                            طلب #{o.id.slice(0, 8)} · {orderStatusLabelAr(st)}
                            {o.generalOrder ? " · عام" : ""}
                          </span>
                          {canCancel ? (
                            <button
                              type="button"
                              className="waiter-pos__btn waiter-pos__btn--ghost"
                              style={{ fontSize: "0.72rem", padding: "2px 6px" }}
                              onClick={() => void cancelServerOrder(o.id)}
                            >
                              إلغاء
                            </button>
                          ) : null}
                        </div>
                        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: "0.88rem", color: "#334155", lineHeight: 1.55 }}>
                          {lines.length ? lines.map((ln, idx) => <li key={`${o.id}-${idx}`}>{ln}</li>) : <li>بدون بنود نشطة</li>}
                        </ul>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="waiter-pos__body">
        {showCaptainGuestDock ? (
          <CaptainGuestDock
            seats={captainDockSeats}
            selectedSeat={selectedSeat}
            seatLabel={seatGuestDisplay}
            truncateLabel={truncateRailGuestLabel}
            onPickSeat={pickCaptainSeatForOrder}
          />
        ) : null}
        <main className="waiter-pos__main">
          <div className="waiter-pos__topbar">
            {useCaptainMobileUi && captainTab === "menu" && assignmentMode === "per_seat" && captainDockSeats.length > 0 ? (
              <div className="waiter-pos__captain-guest-strip" role="tablist" aria-label="اختصار أسماء الضيوف أعلى المنيو">
                {captainDockSeats.map((n) => (
                  <button
                    key={`cap-seat-${n}`}
                    type="button"
                    role="tab"
                    aria-selected={selectedSeat === n}
                    className={`waiter-pos__captain-guest-strip__btn${selectedSeat === n ? " waiter-pos__captain-guest-strip__btn--active" : ""}${
                      n === SHARED_SEAT_NO ? " waiter-pos__captain-guest-strip__btn--shared" : ""
                    }`}
                    onClick={() => pickCaptainSeatForOrder(n)}
                  >
                    {truncateRailGuestLabel(seatGuestDisplay(n))}
                  </button>
                ))}
              </div>
            ) : null}
            <div
              id="waiter-ot-sec-categories"
              className="waiter-pos__top-card waiter-pos__top-card--categories waiter-pos__ot-scroll-target"
              style={{ order: 10 }}
            >
              <h3 style={{ marginTop: 0 }}>التصنيف - الفئة</h3>
              <div className="waiter-pos__cats waiter-pos__cats-inbar" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}>
                <button
                  type="button"
                  className={`waiter-pos__cat ${categoryKey === "all" ? "waiter-pos__cat--active" : ""}`}
                  onClick={() => setCategoryKey("all")}
                  title="كل المجموعات"
                >
                  <div className="waiter-pos__cat-wrap">
                    <span className="waiter-pos__cat-noimg" />
                    <span className="waiter-pos__cat-label">الكل</span>
                  </div>
                </button>
                {waiterMenuGroups.map((g) => (
                  <button
                    key={`side-${g.CardGuide}`}
                    type="button"
                    className={`waiter-pos__cat ${categoryKey === g.CardGuide ? "waiter-pos__cat--active" : ""}`}
                    onClick={() => setCategoryKey(g.CardGuide)}
                    title={g.GroupName}
                  >
                    <div className="waiter-pos__cat-wrap">
                      <span className="waiter-pos__cat-noimg" />
                      <span className="waiter-pos__cat-label">{g.GroupName}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div
              id="waiter-ot-sec-navopts"
              className="waiter-pos__top-card waiter-pos__top-card--navopts waiter-pos__ot-scroll-target"
              style={{ order: 90 }}
            >
              <h3 style={{ marginTop: 0 }}>عمليات الطاولة</h3>
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  className="waiter-pos__btn waiter-pos__btn--ghost"
                  style={{ width: "100%", fontWeight: 800 }}
                  disabled={!activeSessionId || returnableLines.length === 0}
                  onClick={() => {
                    setReturnModalLines(returnableLines);
                    setReturnModalOpen(true);
                  }}
                >
                  طلب مرتجع ضيف
                </button>
              </div>
              <div className="waiter-pos__split-box">
                <div className="waiter-pos__field-stack waiter-pos__field-stack--table-pick" style={{ display: "grid", gap: 10 }}>
                  <div className="waiter-pos__table-move-block">
                    <div className="waiter-pos__table-move-block__title">
                      تحويل الجلسة — طاولات بلا جلسة نشطة (يبقى مسند الطلب كما هو على نفس الجلسة)
                    </div>
                    <div className="waiter-pos__table-pick-search-row">
                      <input
                        type="search"
                        enterKeyHint="search"
                        className="waiter-pos__table-pick-search"
                        value={transferPickQuery}
                        onChange={(e) => setTransferPickQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            runTransferTableSearch();
                          }
                        }}
                        placeholder="ابحث برقم أو اسم الطاولة…"
                        autoComplete="off"
                        aria-label="بحث طاولة للتحويل"
                      />
                      <button type="button" className="waiter-pos__btn waiter-pos__btn--primary waiter-pos__table-pick-search-btn" onClick={() => runTransferTableSearch()}>
                        بحث
                      </button>
                    </div>
                    {transferSearchResults === null ? (
                      <div className="waiter-pos__table-pick-hint">اضغط «بحث» أو Enter لعرض الطاولات الفارغة المتاحة (حد أقصى ٨٠ نتيجة).</div>
                    ) : transferSearchResults.length === 0 ? (
                      <div className="waiter-pos__table-pick-empty">لا توجد طاولة فارغة مطابقة (بلا جلسة نشطة، وليست متسخة/قيد التنظيف). جرّب بحثاً آخر ثم «بحث».</div>
                    ) : (
                      <div className="waiter-pos__table-pick-list" role="listbox" aria-label="طاولات للتحويل">
                        {transferSearchResults.map((t) => (
                          <button
                            key={`tr-pick-${t.id}`}
                            type="button"
                            role="option"
                            aria-selected={transferTargetTableId === t.id}
                            className={`waiter-pos__table-pick-row${transferTargetTableId === t.id ? " is-selected" : ""}`}
                            onClick={() => setTransferTargetTableId(t.id)}
                          >
                            {t.name}
                            {t.number != null ? ` · ${t.number}` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                    {transferTargetTableId ? (
                      <div className="waiter-pos__table-pick-selected">
                        <span>
                          المختار: <strong>{tableDisplayName(tablesMoveCatalog.find((x) => x.id === transferTargetTableId)) || transferTargetTableId}</strong>
                        </span>
                        <button type="button" className="waiter-pos__table-pick-clear" onClick={() => setTransferTargetTableId("")}>
                          مسح
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="waiter-pos__btn waiter-pos__btn--ghost waiter-pos__table-move-action"
                      disabled={!activeSessionId || sessionMoveBusy || !transferTargetTableId}
                      onClick={() => void transferTable()}
                    >
                      تنفيذ التحويل
                    </button>
                  </div>

                  <div className="waiter-pos__table-move-block">
                    <div className="waiter-pos__table-move-block__title">
                      دمج مع طاولة لها جلسة نشطة لنفس مسند الطلب (الكابتن) — الفوترة من جلسة الهدف
                    </div>
                    <div className="waiter-pos__table-pick-search-row">
                      <input
                        type="search"
                        enterKeyHint="search"
                        className="waiter-pos__table-pick-search"
                        value={mergePickQuery}
                        onChange={(e) => setMergePickQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            runMergeTableSearch();
                          }
                        }}
                        placeholder="ابحث برقم أو اسم طاولة الهدف…"
                        autoComplete="off"
                        aria-label="بحث طاولة للدمج"
                      />
                      <button type="button" className="waiter-pos__btn waiter-pos__btn--primary waiter-pos__table-pick-search-btn" onClick={() => runMergeTableSearch()}>
                        بحث
                      </button>
                    </div>
                    {mergeSearchResults === null ? (
                      <div className="waiter-pos__table-pick-hint">
                        اضغط «بحث» أو Enter لعرض طاولات الدمج المسموحة (جلسة نشطة لنفس الكابتن، حد أقصى ٨٠). إن لم يظهر شيء بعد البحث، استخدم «التحويل» إلى طاولة فارغة.
                      </div>
                    ) : mergeSearchResults.length === 0 ? (
                      <div className="waiter-pos__table-pick-empty">
                        {mergePickBase.length === 0
                          ? "الدمج يحتاج طاولة أخرى عليها جلسة نشطة لنفس مسند الطلب. إن لم توجد جلسة ثانية أو اختلف المسند، استخدم «التحويل» إلى طاولة فارغة."
                          : "لا نتائج للبحث — جرّب رقم الطاولة (مثل 14 أو t14) أو اسم العرض، أو امسح الحقل ثم «بحث» لعرض كل الأهداف المتاحة."}
                      </div>
                    ) : (
                      <div className="waiter-pos__table-pick-list" role="listbox" aria-label="طاولات للدمج">
                        {mergeSearchResults.map((t) => (
                          <button
                            key={`mg-pick-${t.id}`}
                            type="button"
                            role="option"
                            aria-selected={mergeTargetTableId === t.id}
                            className={`waiter-pos__table-pick-row${mergeTargetTableId === t.id ? " is-selected" : ""}`}
                            onClick={() => setMergeTargetTableId(t.id)}
                          >
                            {t.name}
                            {t.number != null ? ` · ${t.number}` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                    {mergeTargetTableId ? (
                      <div className="waiter-pos__table-pick-selected">
                        <span>
                          المختار: <strong>{tableDisplayName(tablesMoveCatalog.find((x) => x.id === mergeTargetTableId)) || mergeTargetTableId}</strong>
                        </span>
                        <button type="button" className="waiter-pos__table-pick-clear" onClick={() => setMergeTargetTableId("")}>
                          مسح
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="waiter-pos__btn waiter-pos__btn--ghost waiter-pos__table-move-action"
                      disabled={!activeSessionId || sessionMoveBusy || !mergeTargetTableId}
                      onClick={() => void mergeIntoTable()}
                    >
                      تنفيذ الدمج
                    </button>
                  </div>

                </div>
              </div>
              {activeSessionId ? (
                <div className="waiter-pos__table-kitchen-strip" style={{ marginTop: 10 }}>
                  <div className="waiter-pos__table-kitchen-strip__title">مرسل / جاهز بالمطبخ (جلسة التسكين الحالية)</div>
                  <div className="waiter-pos__table-kitchen-strip__counts" title="طلبات الجلسة الحالية المرسلة للمطبخ — حسب حالة التذكرة">
                    انتظار {sessionKitchenStats.pending} · تحضير {sessionKitchenStats.preparing} · جاهز {sessionKitchenStats.ready}
                  </div>
                </div>
              ) : null}
            </div>

            <div
              id="waiter-ot-sec-table"
              className="waiter-pos__top-card waiter-pos__top-card--tablemeta waiter-pos__ot-scroll-target"
              style={{ order: 40 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontWeight: 900 }}>{selectedTable?.name ?? "طاولة"}</div>
              </div>
              <div style={{ color: "var(--wp-muted)", marginTop: 4, fontSize: "0.8rem" }}>عنصر {itemCount}</div>
              {activeSessionId ? (
                <div style={{ color: "var(--wp-muted)", marginTop: 2, fontSize: "0.76rem" }} title={activeSessionId}>
                  دفعة طلب: {activeSessionId.slice(0, 8)}…
                </div>
              ) : null}
            </div>

            <div
              id="waiter-ot-sec-pending"
              className="waiter-pos__top-card waiter-pos__top-card--flexcol waiter-pos__ot-scroll-target"
              style={{ order: 30 }}
            >
              <h3 style={{ marginTop: 0 }}>السلة — قيد الإرسال</h3>
              <div className="waiter-pos__order-box">
                {cart.length === 0 ? <div style={{ color: "var(--wp-muted)", fontSize: "0.9rem" }}>لا توجد عناصر</div> : cart.map((l) => (
                  <div key={`top-line-${l.id}`} className="waiter-pos__order-line">
                    <div>
                      {(() => {
                        const xn = seatNoFromLine(l);
                        const tag = xn != null ? seatGuestDisplay(xn) : null;
                        return tag ? `${l.name} · ${tag}` : l.name;
                      })()}
                      {l.kitchenNotes?.trim() ? (
                        <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>ملاحظة: {l.kitchenNotes.trim()}</div>
                      ) : null}
                    </div>
                    <input type="number" min={1} value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value) || 0)} disabled={billingLocked} />
                    <span>{Math.max(0, l.qty * l.unitPrice - (promoResult.lineDiscounts[l.id] || 0)).toFixed(0)} ج.م</span>
                    <button type="button" className="waiter-pos__line-remove" onClick={() => removeLine(l.id)} disabled={billingLocked}>×</button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="waiter-pos__btn"
                style={{
                  marginTop: 8,
                  padding: "10px 12px",
                  fontSize: "1rem",
                  fontWeight: 900,
                  background:
                    cart.length === 0
                      ? "linear-gradient(180deg, #64748b 0%, #475569 100%)"
                      : "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                  color: "#fff",
                  border: cart.length === 0 ? "1px solid #64748b" : "1px solid #15803d",
                  opacity: loading || billingLocked ? 0.65 : 1,
                  cursor: loading || billingLocked || cart.length === 0 ? "not-allowed" : "pointer",
                }}
                disabled={loading || billingLocked || cart.length === 0}
                onClick={() => void submitSale()}
              >
                {loading ? "جاري الإرسال…" : "إرسال الطلب"}
              </button>
            </div>

            <div
              id="waiter-ot-sec-distribute"
              className={`waiter-pos__top-card waiter-pos__top-card--flexcol waiter-pos__top-card--seatpanel waiter-pos__ot-scroll-target${
                narrowOtViewport && seatPanelMobCollapsed && assignmentMode === "per_seat" ? " waiter-pos__seatpanel--mob-collapsed" : ""
              }`}
              style={{ order: 20 }}
            >
              <h3 style={{ marginTop: 0 }}>{assignmentMode === "per_seat" ? "تعريف الضيوف" : "توزيع الطلب"}</h3>
              <div className="waiter-pos__toggle-row">
                <button type="button" className={`waiter-pos__toggle ${assignmentMode === "per_seat" ? "waiter-pos__toggle--on" : ""}`} onClick={() => setAssignmentMode("per_seat")}>
                  حسب المقعد (١–١٢)
                </button>
                <button type="button" className={`waiter-pos__toggle ${assignmentMode === "general" ? "waiter-pos__toggle--on" : ""}`} onClick={() => setAssignmentMode("general")}>
                  طلب عام (بدون مقعد)
                </button>
              </div>
              {assignmentMode === "per_seat" ? (
                narrowOtViewport && seatPanelMobCollapsed ? (
                  <button type="button" className="waiter-pos__seatpanel-mob-expand" onClick={() => setSeatPanelMobCollapsed(false)}>
                    عرض تعريف الضيوف
                  </button>
                ) : (
                <>
                  <div
                    className="waiter-pos__seat-list-scroll waiter-pos__dropdown-wrap waiter-pos__seat-list-scroll--in-topbar"
                    style={{ marginTop: 4 }}
                  >
                    <div className="waiter-pos__seats waiter-pos__seats--twelve waiter-pos__seats--twelve-list">
                      {[SHARED_SEAT_NO, ...Array.from({ length: SEAT_SLOT_COUNT }, (_, idx) => idx + 1)].map((n) => {
                        const seatLines = cart.filter((l) => seatNoFromLine(l) === n);
                        const qty = seatLines.reduce((a, l) => a + l.qty, 0);
                        const dn = seatGuestDisplay(n);
                        const sharedRow = n === SHARED_SEAT_NO;
                        return (
                          <div
                            key={`top-seat-${n}`}
                            className={`waiter-pos__seat-slot waiter-pos__seat-slot--compact-row ${sharedRow ? "waiter-pos__seat-slot--shared" : ""} ${selectedSeat === n ? "waiter-pos__seat-slot--active-order" : ""}`}
                            onClick={() => {
                              if (billingLocked) return;
                              if (narrowOtViewport) setSeatPanelMobCollapsed(false);
                              setSelectedSeat(n);
                              if (seatNameEditorSeat != null && seatNameEditorSeat !== n) setSeatNameEditorSeat(null);
                            }}
                            role="presentation"
                          >
                            <div className="waiter-pos__seat-slot-head">
                              <span
                                className={`waiter-pos__seat-slot-no ${sharedRow ? "waiter-pos__seat-slot-no--shared" : ""}`}
                                title={
                                  sharedRow
                                    ? "مقعد ١٣ — طلب يُقسَّم بالتساوي على شيكات المقاعد عند تفعيل «سبليت — فاتورة لكل ضيف» في خيارات الطاولة"
                                    : `مقعد ${n}`
                                }
                              >
                                {sharedRow ? (
                                  <>
                                    {n}
                                    <span className="waiter-pos__seat-slot-no__sub">مشترك</span>
                                  </>
                                ) : (
                                  n
                                )}
                              </span>
                              {seatNameEditorSeat === n ? (
                                <input
                                  type="text"
                                  dir="rtl"
                                  autoFocus
                                  className={`waiter-pos__seat-slot-input waiter-pos__seat-slot-input--compact ${selectedSeat === n ? "waiter-pos__seat-slot-input--sel" : ""}`}
                                  placeholder={sharedRow ? "ملاحظة للمطبخ (اختياري)" : "اسم الضيف على الشيك"}
                                  value={String(seatGuestLabels[n] ?? "")}
                                  onFocus={() => setSelectedSeat(n)}
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={() => setSeatNameEditorSeat((cur) => (cur === n ? null : cur))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      e.stopPropagation();
                                      setSeatNameEditorSeat(null);
                                      (e.target as HTMLInputElement).blur();
                                    }
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      if (narrowOtViewport) {
                                        afterSeatNameConfirmGoCategories();
                                      } else {
                                        setSeatNameEditorSeat(null);
                                        (e.target as HTMLInputElement).blur();
                                      }
                                    }
                                  }}
                                  onChange={(e) => onSeatGuestInputChange(n, e.target.value)}
                                  disabled={billingLocked}
                                  aria-label={sharedRow ? `ملاحظة اختيارية للطلب المشترك (مقعد ${n})` : `اسم الضيف على الشيك — مقعد ${n}`}
                                  maxLength={120}
                                />
                              ) : (
                                <button
                                  type="button"
                                  dir="rtl"
                                  className={`waiter-pos__seat-slot-labelbtn waiter-pos__seat-slot-labelbtn--compact ${selectedSeat === n ? "waiter-pos__seat-slot-labelbtn--active" : ""}`}
                                  title={
                                    sharedRow
                                      ? `${dn}${seatHasCustomLabel(n) ? "" : " — ملاحظة اختيارية للمطبخ"}`
                                      : !seatHasCustomLabel(n)
                                        ? "اضغط ثم اكتب اسم الضيف على الشيك (اختياري)"
                                        : `${dn} — مقعد ${n}`
                                  }
                                  disabled={billingLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (billingLocked) return;
                                    setSelectedSeat(n);
                                    setSeatNameEditorSeat(n);
                                  }}
                                >
                                  <span className="waiter-pos__seat-name-only">{dn}</span>
                                </button>
                              )}
                              {qty > 0 ? (
                                <span className="waiter-pos__seat-slot-inline-qty" title={`كمية المرسل لهذا المقعد: ${qty}`}>
                                  {qty}
                                </span>
                              ) : null}
                              {qty > 0 ? (
                                <button
                                  type="button"
                                  className="waiter-pos__seat-clear waiter-pos__seat-clear--compact"
                                  title="مسح بنود هذا المقعد"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    clearSeatLines(n);
                                  }}
                                >
                                  ×
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {seatNameEditorSeat != null ? (
                      <div className="waiter-pos__seat-mob-actions" role="toolbar" aria-label="تأكيد اسم المقعد">
                        <button type="button" className="waiter-pos__seat-mob-actions__btn waiter-pos__seat-mob-actions__btn--primary" onClick={afterSeatNameConfirmGoCategories}>
                          ✓ تم
                        </button>
                        <button type="button" className="waiter-pos__seat-mob-actions__btn" onClick={afterSeatNameConfirmGoCategories}>
                          الفئات
                        </button>
                        <button type="button" className="waiter-pos__seat-mob-actions__btn" onClick={goToNextSeatMobile}>
                          التالي
                        </button>
                      </div>
                    ) : null}
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, marginTop: 6, color: "#e5e7eb", lineHeight: 1.35 }}>
                      <input type="checkbox" checked={splitBySeat} onChange={(e) => setSplitBySeat(e.target.checked)} disabled={billingLocked} />
                      سبليت — فاتورة لكل ضيف؛ المشترك ١٣ يُقسَّم بالتساوي
                    </label>
                  </div>
                </>
                )
              ) : null}
            </div>

            <div className="waiter-pos__top-card" style={{ order: 50 }}>
              <div id="waiter-ot-sec-sent" className="waiter-pos__sent waiter-pos__ot-scroll-target">
                <h4 style={{ margin: "0 0 6px", fontSize: "0.95rem" }}>مرسل / جاهز بالمطبخ</h4>
                {ordersBusy && !sessionOrders.length ? (
                  <div style={{ color: "var(--wp-muted)", fontSize: "0.85rem" }}>جاري التحميل…</div>
                ) : sessionOrders.filter((o) => (o.status || "").toLowerCase() !== "cancelled").length === 0 ? (
                  <div style={{ color: "var(--wp-muted)", fontSize: "0.85rem" }}>لا توجد بعد.</div>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {sessionOrders.filter((o) => (o.status || "").toLowerCase() !== "cancelled").slice().reverse().map((o) => {
                      const st = (o.status || "").toLowerCase();
                      const canCancel = st === "pending";
                      const lines = activeOrderItems(o).map(formatOrderItemLine);
                      return (
                        <li key={`sent-top-${o.id}`} style={{ borderBottom: "1px solid rgba(15,23,42,0.08)", padding: "8px 0", fontSize: "0.82rem", color: "#e2e8f0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                            <span><strong style={{ color: "#fff" }}>طلب #{o.id.slice(0, 8)}</strong> · {orderStatusLabelAr(st)}</span>
                            {canCancel ? <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ fontSize: "0.72rem", padding: "3px 7px", color: "#f87171", borderColor: "#7f1d1d" }} onClick={() => void cancelServerOrder(o.id)}>إلغاء</button> : null}
                          </div>
                          <ul style={{ margin: 0, paddingInlineStart: 16, color: "#cbd5e1", lineHeight: 1.45 }}>
                            {lines.length ? lines.map((ln, idx) => <li key={`${o.id}-ln-${idx}`}>{ln}</li>) : <li>بدون بنود</li>}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div id="waiter-ot-sec-totals" className="waiter-pos__footer-totals waiter-pos__ot-scroll-target">
                <div style={{ color: "#0f172a", fontSize: "0.92rem", fontWeight: 900, marginBottom: 4 }}>التكلفة</div>
                {billingTotals.ownerTpl ? (
                  <div style={{ color: "#b45309", fontSize: "0.86rem", fontWeight: 800 }}>
                    سياسة مالك/VIP ({String(sessionBillingProfile?.vipOwnerLabel || "").trim() || "نشطة"}) · عميل القالب مُعرَّف على الجلسة
                  </div>
                ) : null}
                {billingTotals.costPricingNote ? (
                  <div style={{ color: "#64748b", fontSize: "0.8rem", fontWeight: 600 }}>
                    تسعير تكلفة + هامش على الأصناف الجديدة — التقديم يعتمد على AgentPrice المحفوظ.
                  </div>
                ) : null}
                {effectiveTableMinimum > 0 && minimumChargeDelta > 0 ? (
                  <div style={{ color: "#92400e", fontSize: "0.85rem", fontWeight: 800, lineHeight: 1.35 }}>
                    الحدّ الأدنى {effectiveTableMinimum.toFixed(2)} ج.م — فرق مطبَّق على الصافي {minimumChargeDelta.toFixed(2)} ج.م (بدون فرق كان{" "}
                    {netBeforeTax.toFixed(2)}).
                  </div>
                ) : null}
                {effectiveTableMinimum > 0 && minimumChargeDelta > 0 && !billingLocked && !orderTakingLocked ? (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(217,119,6,0.35)",
                      background: "rgba(251,191,36,0.08)",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: "0.82rem", marginBottom: 6, color: "#92400e" }}>
                      بدائل ضمن فرق المينيموم — أضِف صنفاً تستفيد به بدل دفع الفرق وحده
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 8, lineHeight: 1.35 }}>
                      أصناف بسعر الوحدة ≤ {minimumChargeDelta.toFixed(2)} ج.م (قائمة الكتالوج). Minimum charge gap ≈{" "}
                      {minimumChargeDelta.toFixed(2)} ج.م
                    </div>
                    {gapPickBusy ? (
                      <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>جاري تحميل الاقتراحات…</div>
                    ) : gapPickHits.length === 0 ? (
                      <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                        لا توجد أصناف ضمن هذا السقف في الكتالوج — استخدم البحث أدناه أو راجع المدير.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {gapPickHits.slice(0, 14).map((p) => (
                          <button
                            key={`gap-${p.CardGuide}`}
                            type="button"
                            className="waiter-pos__btn waiter-pos__btn--ghost"
                            style={{ fontSize: "0.76rem", padding: "5px 10px", maxWidth: "100%" }}
                            title={`إضافة ${p.ProductName} إلى السلة`}
                            onClick={() => pushCartLineForProduct(p, [], "", 1)}
                          >
                            {p.ProductName.slice(0, 42)}
                            {p.ProductName.length > 42 ? "…" : ""}{" "}
                            <span style={{ opacity: 0.85 }}>({p.Price.toFixed(0)})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                {billingTotals.ownerDiscountPct > 0 ? (
                  <div style={{ color: "#0f172a", fontSize: "0.88rem", fontWeight: 700 }}>
                    خصم مالك بعد العروض {billingTotals.ownerDiscountPct}%: صافي قبل الضرائب {netAfterMinimum.toFixed(2)} ←{" "}
                    {billingTotals.netPortion.toFixed(2)}
                  </div>
                ) : null}
                <div style={{ color: "#0f172a", fontSize: "0.92rem", fontWeight: 700 }}>خدمة {policy.servicePercent}%: {serviceCharge.toFixed(2)}</div>
                <div style={{ color: "#0f172a", fontSize: "0.92rem", fontWeight: 700 }}>VAT {policy.vatPercent}%: {vatValue.toFixed(2)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, color: "#0f172a", fontSize: "0.92rem", fontWeight: 700 }}>
                  <span>بقشيش:</span>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(Math.max(0, Number(e.target.value) || 0))}
                    style={{ width: 86, padding: "6px 8px", borderRadius: 8, border: "1px solid #94a3b8", background: "#ffffff", color: "#0f172a", fontSize: "0.95rem", fontWeight: 800 }}
                  />
                </div>
                <div style={{ fontWeight: 900, marginTop: 6, color: "#0b3b2e", fontSize: "1rem" }}>الإجمالي: {total.toFixed(2)} ج.م</div>
                <div className="waiter-pos__actions" style={{ flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  <button
                    type="button"
                    className="waiter-pos__btn"
                    style={{
                      padding: "8px 16px",
                      fontSize: "1rem",
                      fontWeight: 900,
                      background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                      color: "#fff",
                      border: "1px solid #15803d",
                    }}
                    onClick={() => void loadAll()}
                  >
                    تحديث
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div
            id="waiter-ot-sec-search"
            className="waiter-pos__search-wrap waiter-pos__ot-scroll-target"
            style={{ marginBottom: "0.5rem" }}
          >
            {menuScheduleRestriction.limited ? (
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.88rem", color: "var(--wp-muted)" }}>
                القائمة اليومية: {menuEligibleProducts.length} صنفًا مسموحًا اليوم ({todayYmd()})
              </p>
            ) : null}
            <SmartProductSearch
              onSelect={(hit) =>
                beginAddProduct(
                  products.find((p) => String(p.CardGuide) === String(hit.CardGuide)) || {
                    CardGuide: hit.CardGuide,
                    ProductName: hit.ProductName,
                    Price: Number(hit.AgentPrice || 0) || 0,
                    AgentPrice: Number(hit.AgentPrice || 0) || 0,
                  },
                )
              }
              filterHit={(hit) => isOnWaiterMenu(hit.CardGuide, hit.ProductName)}
              isOutOfStock={(hit) => isKitchenStopped(hit.CardGuide)}
              placeholder="ابحث سريعًا باسم الصنف أو جزء منه… (Enter لإضافة أول نتيجة)"
            />
          </div>
          {narrowOtViewport && mobileFlowToast.trim() ? (
            <div className="waiter-pos__ot-flow-toast" role="status" aria-live="polite">
              <span className="waiter-pos__ot-flow-toast__text">{mobileFlowToast}</span>
              <button
                type="button"
                className="waiter-pos__ot-flow-toast__dismiss"
                aria-label="إغلاق التلميح"
                onClick={() => {
                  clearMobileFlowToastTimer();
                  setMobileFlowToast("");
                }}
              >
                ×
              </button>
            </div>
          ) : null}
          <div className="waiter-pos__mb-sendbar" role="region" aria-label="إرسال الطلب للمطبخ">
            <div className="waiter-pos__mb-sendbar__meta">
              <span className="waiter-pos__mb-sendbar__title">قيد الإرسال</span>
              <span className="waiter-pos__mb-sendbar__sub">
                {itemCount} صنف · ~{gross.toFixed(0)} ج
              </span>
            </div>
            <button
              type="button"
              className={`waiter-pos__mb-sendbar__btn${cart.length === 0 ? " waiter-pos__mb-sendbar__btn--blocked" : ""}`}
              disabled={loading || billingLocked || cart.length === 0}
              onClick={() => void submitSale()}
            >
              {loading ? "جاري الإرسال…" : "إرسال الطلب"}
            </button>
          </div>
          <div className="waiter-pos__section-divider" />

          <div id="waiter-ot-sec-grid" className="waiter-pos__grid waiter-pos__ot-scroll-target">
            {filteredProducts.length === 0 ? (
              <div style={{ gridColumn: "1 / -1", padding: "1rem", color: "var(--wp-muted)", textAlign: "center" }}>
                {menuScheduleRestriction.limited
                  ? "لا أصناف في القائمة اليومية لهذا اليوم — راجع إعدادات «المنيو والقائمة اليومية»."
                  : "لا أصناف في هذه الفئة."}
              </div>
            ) : null}
            {filteredProducts.map((p) => {
              const stopped = isKitchenStopped(p.CardGuide);
              const stopNote = kitchenStopNote(p.CardGuide);
              const hue = hashHue(p.CardGuide);
              const bg = `linear-gradient(135deg, hsl(${hue}, 55%, 42%) 0%, hsl(${(hue + 40) % 360}, 45%, 32%) 100%)`;
              const initial = (p.ProductName || "?").trim().charAt(0);
              const imgSrc = resolveMediaUrl(p.imageUrl || p.image);
              const hasImage = !!imgSrc;
              return (
                <button
                  key={p.CardGuide}
                  type="button"
                  className="waiter-pos__card"
                  onClick={() => pushCartLineForProduct(p, [])}
                  style={{ opacity: stopped ? 0.55 : 1, position: "relative" }}
                  title={stopped ? stopNote : undefined}
                >
                  {stopped ? (
                    <div style={{ position: "absolute", top: 6, left: 6, zIndex: 3, background: "#b91c1c", color: "#fff", borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 800 }}>
                      Out of Stock
                    </div>
                  ) : null}
                  <div className="waiter-pos__ribbon">{Math.round((p.Price || 0) * (1 + SERVICE_RATE_FOR_CARD_PRICE))} ج.م</div>
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 6,
                      left: 0,
                      zIndex: 4,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 0,
                      flexWrap: "nowrap",
                      padding: "0 0",
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        pushCartLineForProduct(p, []);
                      }}
                      style={{
                        background: "rgba(15,23,42,0.82)",
                        color: "#fff",
                        borderRadius: "999px 0 0 999px",
                        padding: "2px 7px",
                        fontSize: 11,
                        fontWeight: 900,
                        border: 0,
                        cursor: "pointer",
                      }}
                    >
                      عادي
                    </button>
                    {activeCatalogAddons.length > 0 ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          beginAddProduct(p);
                        }}
                        style={{
                          background: "rgba(245,158,11,0.95)",
                          color: "#111827",
                          borderRadius: "0 999px 999px 0",
                          padding: "2px 7px",
                          fontSize: 11,
                          fontWeight: 900,
                          border: 0,
                          cursor: "pointer",
                        }}
                      >
                        إضافات
                      </button>
                    ) : null}
                  </div>
                  <div className="waiter-pos__card-img" style={{ background: bg, position: "relative", overflow: "hidden" }}>
                    {hasImage && (
                      <img
                        src={imgSrc}
                        alt={p.ProductName}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <div style={{ position: "relative", zIndex: 1 }}>{initial}</div>
                  </div>
                  <div className="waiter-pos__card-body">
                    <div className="waiter-pos__card-name">{p.ProductName}</div>
                    <div className="waiter-pos__card-meta">
                      <span>🕐 {prepMinutes(p)} دقيقة</span>
                      {p.GroupGuid && <span>{groupNameById.get(p.GroupGuid) ?? ""}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      </div>

      {useCaptainMobileUi ? (
        <nav className="waiter-pos__ot-captain-bar" aria-label="تبويبات الكابتن (جوال)">
          {CAPTAIN_MOBILE_TABS.map((t) => {
            const active = captainTab === t.id;
            const badge = t.id === "cart" && cart.length > 0 ? cart.length : 0;
            return (
              <button
                key={t.id}
                type="button"
                className={`waiter-pos__ot-captain-bar__btn${active ? " waiter-pos__ot-captain-bar__btn--active" : ""}`}
                title={t.title}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (t.id === "table" || t.id === "guests") setSeatPanelMobCollapsed(false);
                  setCaptainTab(t.id);
                }}
              >
                <span className="waiter-pos__ot-captain-bar__emoji" aria-hidden>
                  {t.emoji}
                </span>
                <span className="waiter-pos__ot-captain-bar__label">{t.label}</span>
                {badge > 0 ? (
                  <span className="waiter-pos__ot-captain-bar__badge" aria-label={`${badge} في السلة`}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      ) : null}

      {addonPickerProduct ? (
        <div
          role="presentation"
          className="waiter-addon-modal__overlay"
          onClick={() => setAddonPickerProduct(null)}
        >
          <div
            role="dialog"
            aria-labelledby="addon-picker-title"
            className="waiter-addon-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="waiter-addon-modal__head">
              <h3 id="addon-picker-title">مكونات الصنف (إجابة العميل)</h3>
              <div className="waiter-addon-modal__product">{addonPickerProduct.ProductName}</div>
              <div className="waiter-addon-modal__sub">
                {assignmentMode === "general" ? "طلب عام" : selectedSeat === SHARED_SEAT_NO ? "مقعد ١٣ مشترك" : `مقعد ${selectedSeat}`} · سعر البطاقة: {addonPreview.base.toFixed(2)} ج.م
              </div>
            </div>
            <div className="waiter-addon-modal__empty">
              لا توجد مكونات مسجلة لهذا الصنف.
            </div>
            <div className="waiter-addon-modal__price-box">
              <div className="waiter-addon-modal__price-title">تقدير / وحدة (حسب «الضريبة والخدمة»)</div>
              <div className="waiter-addon-modal__price-row">
                <span>سعر السطر بعد الإضافات</span>
                <strong>{addonPreview.unit.toFixed(2)}</strong>
              </div>
              <div className="waiter-addon-modal__price-row">
                <span>خدمة ({policy.servicePercent}%)</span>
                <strong>{addonPreview.service.toFixed(2)} — تُدخل في أساس الضريبة</strong>
              </div>
              <div className="waiter-addon-modal__price-row">
                <span>VAT ({policy.vatPercent}%)</span>
                <strong>{addonPreview.vat.toFixed(2)}</strong>
              </div>
              <div className="waiter-addon-modal__price-total">إجمالي تقديري: {addonPreview.total.toFixed(2)} ج.م</div>
            </div>
            <div className="waiter-addon-modal__catalog-note">
              الإضافات (مجموعات) — من إعدادات النظام ← الإضافات.
              <br />
              حدّث الصنف بعد تعديل الكتالوج (أغلق المودال وافتحه) إن لزم.
            </div>
            <div className="waiter-addon-modal__list-title">الإضافات (من الإعدادات)</div>
            {!catalogAddonsReady ? (
              <div className="waiter-addon-modal__empty">
                جاري تحميل كتالوج الإضافات…
              </div>
            ) : activeCatalogAddons.length === 0 ? (
              <div className="waiter-addon-modal__empty">
                لا توجد إضافات نشطة في الكتالوج.
              </div>
            ) : (
              <div className="waiter-addon-modal__list">
                {activeCatalogAddons.map((r) => (
                  <label
                    key={r.id}
                    className={`waiter-addon-modal__row ${addonPickerSel[r.id] ? "is-on" : ""}`}
                  >
                    <span className="waiter-addon-modal__amt">+{r.price.toFixed(0)} ج.م</span>
                    <span className="waiter-addon-modal__name">{r.label}</span>
                    <input
                      type="checkbox"
                      className="waiter-addon-modal__check"
                      checked={Boolean(addonPickerSel[r.id])}
                      onChange={(e) => setAddonPickerSel((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                    />
                  </label>
                ))}
              </div>
            )}
            <label className="waiter-addon-modal__notes-wrap">
              <span>مواصفات وحرّة (نص للمطبخ)</span>
              <textarea
                value={addonPickerNotes}
                onChange={(e) => setAddonPickerNotes(e.target.value)}
                placeholder="مثال: بدون زيتون — صوص حار على الجانب"
                rows={3}
                maxLength={400}
                className="waiter-addon-modal__notes"
              />
            </label>
            <label className="waiter-addon-modal__qty">
              <span>الكمية</span>
              <input
                type="number"
                min={1}
                step={1}
                value={addonPickerQty}
                onChange={(e) => setAddonPickerQty(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              />
            </label>
            <div className="waiter-addon-modal__actions">
              <button
                type="button"
                className="waiter-pos__btn"
                disabled={!catalogAddonsReady}
                onClick={() => confirmAddonPicker({ withoutAddons: false })}
              >
                إضافة للطلب
              </button>
              <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" onClick={() => setAddonPickerProduct(null)}>
                إلغاء
              </button>
            </div>
            <div className="waiter-addon-modal__footnote">
              Esc لإلغاء. لنفس الصنف بمواصفات أخرى أضف من جديد بنص مختلف.
            </div>
          </div>
        </div>
      ) : null}
      <GuestReturnRequestModal
        open={returnModalOpen}
        onClose={() => setReturnModalOpen(false)}
        sessionId={activeSessionId || ""}
        tableId={selectedTableId}
        tableLabel={selectedTable?.name || selectedTableId}
        lines={returnModalLines}
        actor={{
          userId: user?.id != null ? String(user.id) : "",
          name: sessionDisplayName(user),
          role: user?.role || "waiter",
        }}
        onSubmitted={(requestId) =>
          setMsg(
            requestId
              ? `تم إرسال طلب المرتجع للمدير (${requestId.slice(0, 8)}…) — بانتظار الاعتماد.`
              : "تم إرسال طلب المرتجع للمدير — بانتظار الاعتماد.",
          )
        }
      />
    </div>
  );
}
