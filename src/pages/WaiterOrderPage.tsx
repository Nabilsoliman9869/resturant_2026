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
import { buildSegmentedTablesFromFloorPlan, normalizeTableDisplayLabel } from "../lib/restaurantTableView";
import "../styles/operationalRoles.css";
import "../styles/deliveryOrderPage.css";
import SmartProductSearch from "../components/SmartProductSearch";
import GuestReturnRequestModal, { type GuestReturnOrderLine } from "../components/GuestReturnRequestModal";
import { CashierPayInvoiceModal, type CashierInvoiceRow } from "../components/CashierPayInvoiceModal";
import CaptainBillReviewModal, { type CaptainBillReviewLine } from "../components/CaptainBillReviewModal";
import { useAuth } from "../auth/AuthContext";
import { roleHasManagerOpsAccess } from "../auth/roles";
import { repairArabicDisplayText, sessionDisplayName } from "../auth/displayUser";
import { buildMat3amActor } from "../lib/mat3amActor";
import { useTerminalLock } from "../context/TerminalLockContext";
import { setTerminalDirtyChecker, TERMINAL_USER_SWITCHED_EVENT } from "../lib/terminalDirtyGuard";
import { briefNetworkHint, safeFetch } from "../lib/safeFetch";
import {
  effectiveTableIdsForUser,
  normalizeTempCaptainTransfers,
  normalizeWaiterTableAssignments,
  waiterTableAssignmentRestrictionApplies,
} from "../lib/waiterTableAssignments";
import { CaptainGuestDock } from "../components/CaptainGuestDock";
import ModifierWizard, { type ModifierGroup } from "../components/ModifierWizard";
import { useAppMenu } from "../context/AppMenuContext";
import {
  CAPTAIN_MOBILE_TABS,
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

type OrderTakerSessionRow = {
  id?: string;
  tableId?: string;
  status?: string;
  startTime?: string;
  guestCount?: number | string;
  minimumChargePerSeat?: number | string;
  guestSession?: boolean;
  guestApprovalPending?: boolean;
  customerType?: string;
  customerTypeLocked?: boolean;
  captainUserId?: string;
  captainName?: string;
  captainLogin?: string;
  billingRequestedAt?: string;
  billingProfile?: SessionBillingProfile;
  seatGuestLabels?: unknown;
  maxInvoiceLimit?: number;
  mergedIntoSessionId?: string;
  mergedSourceSessionIds?: string[];
  mergeId?: string;
  mergeRole?: "source" | "target";
  tableDisplayName?: string;
};

type PatchSessionResponse = {
  ok?: boolean;
  session?: OrderTakerSessionRow;
  detail?: string;
  approvalRequested?: boolean;
  message?: string;
};

type GuestApprovalRequestRow = {
  id?: string;
  type?: string;
  status?: string;
  sessionId?: string;
};

type ProductGroup = { CardGuide: string; GroupName: string; image?: string; imageUrl?: string; DisplayCategory?: string };
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

/** طاولة اصطناعية لمسار الدليفري داخل شاشة جرسون الطلبات */
const DELIVERY_SYNTH_TABLE_ID = "DELIVERY";
const DELIVERY_SYNTH_TABLE: RestTable = {
  id: DELIVERY_SYNTH_TABLE_ID,
  name: "توصيل",
  status: "occupied",
  seats: 1,
  number: 0,
  minimumCharge: 0,
};

type DeliveryAgentHit = {
  CardGuide: string;
  AgentName: string;
  Phone?: string;
  Mobile?: string;
  Address?: string;
  FullAdress?: string;
};
type DeliveryFavItem = {
  CardGuide: string;
  ProductName: string;
  Price?: number;
  invoiceCount?: number;
  qtyOrdered?: number;
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

type CartModifier = {
  groupId: string;
  groupName: string;
  itemName: string;
  priceDelta: number;
  source?: "item" | "free_text";
};

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
  /** إضافات المعالج (Wizard modifiers) */
  modifiers?: CartModifier[];
};

type CatalogAddonRow = { id: number; label: string; price: number; sortOrder: number; isActive: boolean };

type ProductModifierProfileEntry = {
  groupId: string;
  sortOrder?: number;
  isEnabled?: boolean;
  isRequired?: boolean | null;
  minSelect?: number | null;
  maxSelect?: number | null;
  allowFreeText?: boolean | null;
  freeTextRequired?: boolean | null;
  freeTextLabel?: string;
  freeTextPlaceholder?: string;
};

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

type ReviewSeatMoveRow = {
  key: string;
  source: "cart" | "order";
  orderId?: string;
  lineId: string;
  name: string;
  qty: number;
  seatNo: number | null;
  statusText: string;
  statusTone: "cart" | "sent";
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
        lineStatus: String(it.lineStatus || o.status || ""),
        orderStatus: String(o.status || ""),
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
const CAPTAIN_BILL_PRINTER_STORAGE_KEY = "mat3am.captain.bill.review.printer";

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
  const activeRows = (Array.isArray(sess) ? sess : [])
    .filter((x): x is OrderTakerSessionRow => !!x && typeof x === "object")
    .filter((x) => String(x.status || "").toLowerCase() === "active");
  for (const x of sortSessionsByRecencyDesc(activeRows)) {
    if (!x || typeof x !== "object") continue;
    const o = x as { id?: string; tableId?: unknown; status?: string; captainUserId?: string };
    const tid = tableRefKey(o.tableId);
    if (!tid) continue;
    if (out[tid]?.id) continue;
    out[tid] = { id: String(o.id || "").trim(), captainUserId: String(o.captainUserId || "").trim() };
  }
  if (catalog?.length) {
    for (const t of catalog) {
      const k = tableRefKey(t.id);
      if (out[k]?.id) continue;
      for (const o of sortSessionsByRecencyDesc(activeRows)) {
        if (!restaurantTableIdsEqual(t.id, o.tableId)) continue;
        out[k] = { id: String(o.id || "").trim(), captainUserId: String(o.captainUserId || "").trim() };
        break;
      }
    }
  }
  return out;
}

function sessionRecencyValue(row: OrderTakerSessionRow | null | undefined): string {
  return String(row?.startTime || "").trim();
}

function compareSessionRecencyDesc(a: OrderTakerSessionRow, b: OrderTakerSessionRow): number {
  return sessionRecencyValue(b).localeCompare(sessionRecencyValue(a));
}

function sortSessionsByRecencyDesc(rows: OrderTakerSessionRow[]): OrderTakerSessionRow[] {
  return rows.slice().sort(compareSessionRecencyDesc);
}

function clampSeatGuestCount(raw: unknown, fallback = 1): number {
  const fb = Math.max(1, Math.min(SEAT_SLOT_COUNT, Math.floor(Number(fallback) || 1)));
  const n = Math.floor(Number(raw) || 0);
  if (!Number.isFinite(n) || n < 1) return fb;
  return Math.max(1, Math.min(SEAT_SLOT_COUNT, n));
}

function buildAutoNumberedSeatLabels(guestCount: number, existing?: Record<number, string> | null): Record<number, string> {
  const count = clampSeatGuestCount(guestCount, 1);
  const out: Record<number, string> = {};
  for (let i = 1; i <= count; i += 1) out[i] = String(i);
  const shared = String(existing?.[SHARED_SEAT_NO] ?? "").trim();
  if (shared) out[SHARED_SEAT_NO] = shared.slice(0, 120);
  return out;
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

function extractSeatFromOrderItem(it: { name?: string; seatNo?: number | null }): number | null {
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
  const [subGroupKey, setSubGroupKey] = useState<string>("all");
  const [displayMode, setDisplayMode] = useState<"group" | "category">("group");
  const [sortMode, setSortMode] = useState<"default" | "name" | "price">("default");
  const [couponCode, setCouponCode] = useState("");
  const [tipAmount, setTipAmount] = useState(0);
  const [selectedAgentGuid, setSelectedAgentGuid] = useState("");
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setTerminalDirtyChecker(() => ({
      dirty: cart.length > 0,
      detail: cart.length > 0 ? `سلة طلبات (${cart.length} بند)` : undefined,
    }));
    return () => setTerminalDirtyChecker(null);
  }, [cart.length]);

  useEffect(() => {
    const onSwitch = () => {
      setCart([]);
      setMsg("تم تبديل الكابتن عبر البطاقة — صُفِّرت السلة المحلية غير المرسلة.");
    };
    window.addEventListener(TERMINAL_USER_SWITCHED_EVENT, onSwitch);
    return () => window.removeEventListener(TERMINAL_USER_SWITCHED_EVENT, onSwitch);
  }, []);

  /** بيانات عميل التوصيل — فقط عند embeddedChannel=delivery */
  const [deliverySearchQ, setDeliverySearchQ] = useState("");
  const [deliveryHits, setDeliveryHits] = useState<DeliveryAgentHit[]>([]);
  const [deliverySearching, setDeliverySearching] = useState(false);
  const [deliveryName, setDeliveryName] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryTicketId, setDeliveryTicketId] = useState("");
  const [deliveryNoVat, setDeliveryNoVat] = useState(true);
  const [deliveryShippingFee, setDeliveryShippingFee] = useState(0);
  const [deliveryShippingProductGuide, setDeliveryShippingProductGuide] = useState("");
  const [deliveryShippingProductName, setDeliveryShippingProductName] = useState("");
  const [deliveryFavorites, setDeliveryFavorites] = useState<DeliveryFavItem[]>([]);
  const [deliveryFavHint, setDeliveryFavHint] = useState<string | null>(null);
  const [deliveryCatalogTab, setDeliveryCatalogTab] = useState<"menu" | "favorites">("menu");
  const deliverySearchTimer = useRef<number | null>(null);
  const [unauthorizedAccessTable, setUnauthorizedAccessTable] = useState<string>("");
  const [unauthorizedAccessKind, setUnauthorizedAccessKind] = useState<"" | "captain" | "assignment">("");
  const [loading, setLoading] = useState(false);
  const [dailyMenuState, setDailyMenuState] = useState<DailyMenuState | null>(null);
  const [dailyMenuScheduleEntries, setDailyMenuScheduleEntries] = useState<DailyMenuScheduleEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionOrders, setSessionOrders] = useState<ServerOrder[]>([]);
  const [sessionInvoices, setSessionInvoices] = useState<CashierInvoiceRow[]>([]);
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnModalLines, setReturnModalLines] = useState<GuestReturnOrderLine[]>([]);
  const [approvedReturnsMap, setApprovedReturnsMap] = useState<Record<string, number>>({});
  const [billReviewOpen, setBillReviewOpen] = useState(false);
  const [captainInvoiceOpen, setCaptainInvoiceOpen] = useState(false);
  const [captainInvoiceId, setCaptainInvoiceId] = useState<string | null>(null);
  const [captainInitialInvoiceRow, setCaptainInitialInvoiceRow] = useState<CashierInvoiceRow | null>(null);
  const [captainInvoiceAutoPrint, setCaptainInvoiceAutoPrint] = useState(false);
  const [captainPrinterHint, setCaptainPrinterHint] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(CAPTAIN_BILL_PRINTER_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [catalogAddons, setCatalogAddons] = useState<CatalogAddonRow[]>([]);
  /** بعد أول محاولة جلب — يُمنع ضغطة سريقة قبل اكتمال التحميل (كانت تتخطّى المودال) */
  const [catalogAddonsReady, setCatalogAddonsReady] = useState(false);
  const [addonPickerProduct, setAddonPickerProduct] = useState<Product | null>(null);
  const [addonPickerSel, setAddonPickerSel] = useState<Record<number, boolean>>({});
  const [addonPickerNotes, setAddonPickerNotes] = useState("");
  const [addonPickerQty, setAddonPickerQty] = useState(1);
  const [billingRequestedAt, setBillingRequestedAt] = useState<string | null>(null);
  const [sessionBillingProfile, setSessionBillingProfile] = useState<SessionBillingProfile | null>(null);
  const [sessionGuestApprovalPending, setSessionGuestApprovalPending] = useState(false);
  const [pendingGuestApprovalId, setPendingGuestApprovalId] = useState<string | null>(null);
  const [sessionCustomerTypeLocked, setSessionCustomerTypeLocked] = useState(false);
  const [sessionCustomerType, setSessionCustomerType] = useState("cash");
  const [sessionMaxInvoiceLimit, setSessionMaxInvoiceLimit] = useState<number | null>(null);
  const [guestDecisionBusy, setGuestDecisionBusy] = useState(false);
  const [requestBillBusy, setRequestBillBusy] = useState(false);
  const [summonBusy, setSummonBusy] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showCostDrawer, setShowCostDrawer] = useState(false);
  const [showGapPicks, setShowGapPicks] = useState(false);
  const [splitBySeat, setSplitBySeat] = useState(false);
  /** مقاعد يُطلب حسابها الآن فقط (فارغ = كل المقاعد غير المفوترة) */
  const [billSeatNos, setBillSeatNos] = useState<number[]>([]);
  const [reorderSeatTargets, setReorderSeatTargets] = useState<Record<string, number>>({});
  const [reorderBusyKey, setReorderBusyKey] = useState("");
  const [partialMoveSelected, setPartialMoveSelected] = useState<Record<string, boolean>>({});
  const [partialMoveSeatTargets, setPartialMoveSeatTargets] = useState<Record<string, number>>({});
  const [partialMoveTargetTableId, setPartialMoveTargetTableId] = useState("");
  const [partialMoveIncludesGuest, setPartialMoveIncludesGuest] = useState(false);
  const [partialMoveBusy, setPartialMoveBusy] = useState(false);
  const [transferTargetTableId, setTransferTargetTableId] = useState("");
  const [mergeTargetTableId, setMergeTargetTableId] = useState("");
  const [transferPickQuery, setTransferPickQuery] = useState("");
  const [mergePickQuery, setMergePickQuery] = useState("");
  const [navoptsActiveTab, setNavoptsActiveTab] = useState<"returns" | "transfer" | "merge" | "reorder" | "invoices" | null>(null);
  const [guestSeatDialogOpen, setGuestSeatDialogOpen] = useState(false);
  /** نتائج «بحث» — null = لم يُنفَّذ بحث بعد (لا تُعرض قائمة تحت الحقل) */
  const [transferSearchResults, setTransferSearchResults] = useState<RestTable[] | null>(null);
  const [mergeSearchResults, setMergeSearchResults] = useState<RestTable[] | null>(null);
  /** كل الطاولات (المخطط) لاختيار التحويل/الدمج — لا تُصفّى بمسند الكابتن */
  const [tablesMoveCatalog, setTablesMoveCatalog] = useState<RestTable[]>([]);
  /** جلسة نشطة واحدة لكل tableId (مرجع موحّد) */
  const [sessionByTableRef, setSessionByTableRef] = useState<Record<string, { id: string; captainUserId: string }>>({});
  const [sessionMoveBusy, setSessionMoveBusy] = useState(false);
  const [mergedIntoSessionId, setMergedIntoSessionId] = useState("");
  const [mergedSourceSessionIds, setMergedSourceSessionIds] = useState<string[]>([]);
  const [unmergePreviewLines, setUnmergePreviewLines] = useState<Array<{
    orderId: string;
    lineId: string;
    name: string;
    quantity: number;
    seatNo?: number | null;
    origin: "source" | "target";
    tableId?: string;
  }>>([]);
  const [unmergeSeatTargets, setUnmergeSeatTargets] = useState<Record<string, number>>({});
  const [unmergeSeatEnabled, setUnmergeSeatEnabled] = useState<Record<string, boolean>>({});
  const [unmergeSourceSessionId, setUnmergeSourceSessionId] = useState("");
  const [unmergeBusy, setUnmergeBusy] = useState(false);
  /** اسم للعرض/الطباعة على الشيك — نصّي على الجلسة وليس عميلاً منفصلاً في TBL016 */
  const [seatGuestLabels, setSeatGuestLabels] = useState<Record<number, string>>({});
  const [sessionGuestCount, setSessionGuestCount] = useState(1);
  const [sessionMinimumChargePerSeat, setSessionMinimumChargePerSeat] = useState(0);
  const [guestCountDraft, setGuestCountDraft] = useState("1");
  const [minimumChargeFlowOpen, setMinimumChargeFlowOpen] = useState(false);
  const [minimumChargeFlowStep, setMinimumChargeFlowStep] = useState<"count" | "naming">("count");
  /** حدّ أدنى افتراضي من `/api/restaurant/ops-settings` عندما لا يُحدَّد على الطاولة */
  const [tableMinDefaultOps, setTableMinDefaultOps] = useState(0);
  /** وضع اختيار الأصناف: classic | wizard */
  const [captainItemSelectionMode, setCaptainItemSelectionMode] = useState<"classic" | "wizard">("classic");
  /** منتج قيد البناء في معالج الإضافات (modifier wizard) */
  const [wizardProduct, setWizardProduct] = useState<{ guide: string; name: string; price: number } | null>(null);
  const [wizardGroups, setWizardGroups] = useState<ModifierGroup[]>([]);
  const [_wizardStepInfo, setWizardStepInfo] = useState<{ step: number; total: number; groupName: string } | null>(null);
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
  const [, setSeatPanelMobCollapsed] = useState(false);
  const [mobileFlowToast, setMobileFlowToast] = useState("");
  const mobileFlowToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCategoryKeyRef = useRef(categoryKey);
  const activeSessionsRef = useRef<OrderTakerSessionRow[]>([]);

  const normalizedGroups = useMemo(
    () => groups.map((g) => ({ ...g, GroupName: normalizeGroupName(g.GroupName) })),
    [groups]
  );

  const groupNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of normalizedGroups) m.set(g.CardGuide, g.GroupName);
    return m;
  }, [normalizedGroups]);

  const transferPickBase = useMemo(() => {
    return tablesMoveCatalog.filter((t) => {
      if (String(t.id) === String(selectedTableId)) return false;
      const tst = normalizeTableStatus(String(t.status || ""));
      if (tst === "dirty" || tst === "cleaning") return false;
      return true;
    });
  }, [tablesMoveCatalog, selectedTableId]);

  const mergePickBase = useMemo(() => {
    return tablesMoveCatalog.filter((t) => {
      if (String(t.id) === String(selectedTableId)) return false;
      const tst = normalizeTableStatus(String(t.status || ""));
      if (tst === "dirty" || tst === "cleaning") return false;
      return true;
    });
  }, [tablesMoveCatalog, selectedTableId]);

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
    const q = transferPickQuery.trim();
    const list = q ? transferPickBase.filter((t) => matchesTablePickQuery(t, q)) : transferPickBase.slice(0, 80);
    setTransferSearchResults(list);
    setTransferTargetTableId((cur) => {
      const curId = String(cur || "").trim();
      if (curId && list.some((t) => String(t.id) === curId)) return curId;
      return String(list[0]?.id || "").trim();
    });
  }, [transferPickBase, transferPickQuery]);

  useEffect(() => {
    const q = mergePickQuery.trim();
    const list = q ? mergePickBase.filter((t) => matchesTablePickQuery(t, q)) : mergePickBase.slice(0, 80);
    setMergeSearchResults(list);
    setMergeTargetTableId((cur) => {
      const curId = String(cur || "").trim();
      if (curId && list.some((t) => String(t.id) === curId)) return curId;
      return String(list[0]?.id || "").trim();
    });
  }, [mergePickBase, mergePickQuery]);

  const isDeliveryEmbedded = String(embeddedChannel || "").trim().toLowerCase() === "delivery";
  const selectedTable = useMemo(() => {
    if (isDeliveryEmbedded) {
      return tables.find((t) => t.id === DELIVERY_SYNTH_TABLE_ID) || DELIVERY_SYNTH_TABLE;
    }
    return tables.find((t) => t.id === selectedTableId) || null;
  }, [tables, selectedTableId, isDeliveryEmbedded]);
  const selectedTableStatus = normalizeTableStatus(String((selectedTable as any)?.status || ""));
  const selectedTableBlocked = !isDeliveryEmbedded && (selectedTableStatus === "dirty" || selectedTableStatus === "cleaning");

  /** عودة واضحة من «طلب للطاولة» إلى شاشة اختيار الطاولة (أو مسار التضمين) */
  const orderTakerExitPath = useMemo(() => {
    const b = String(backTo || "").trim();
    if (b) return b;
    if (isDeliveryEmbedded) return "/app/cashier/delivery-hub";
    const r = String(user?.role || "").trim().toLowerCase();
    if (r === "manager") return "/app/manager/captain-tables";
    if (r === "operation_manager") return "/app/operation_manager/captain-tables";
    if (r === "developer") return "/app/developer/captain-tables";
    return "/app/waiter/tables";
  }, [backTo, isDeliveryEmbedded, user?.role]);

  // تهيئة مسار الدليفري داخل جرسون الطلبات
  useEffect(() => {
    if (!isDeliveryEmbedded) return;
    setSelectedTableId(DELIVERY_SYNTH_TABLE_ID);
    setAssignmentMode("general");
    const n = String(searchParams.get("name") || "").trim();
    const ph = String(searchParams.get("phone") || "").trim();
    const ad = String(searchParams.get("address") || "").trim();
    const ag = String(searchParams.get("agentGuid") || "").trim();
    if (n) {
      setDeliveryName(n);
      setDeliverySearchQ(n);
    }
    if (ph) setDeliveryPhone(ph);
    if (ad) setDeliveryAddress(ad);
    if (ag) setSelectedAgentGuid(ag);
    if (searchParams.get("deliveryTicketId")) setDeliveryTicketId(String(searchParams.get("deliveryTicketId")));
    if (searchParams.get("shippingFee")) setDeliveryShippingFee(Number(searchParams.get("shippingFee")) || 0);
    if (searchParams.get("shippingProductGuide")) setDeliveryShippingProductGuide(String(searchParams.get("shippingProductGuide")));
    if (searchParams.get("shippingProductName")) setDeliveryShippingProductName(String(searchParams.get("shippingProductName")));
    if (searchParams.get("noVat") === "0") setDeliveryNoVat(false);
  }, [isDeliveryEmbedded, searchParams]);

  useEffect(() => {
    if (!isDeliveryEmbedded) return;
    if (deliverySearchTimer.current) window.clearTimeout(deliverySearchTimer.current);
    const text = deliverySearchQ.trim();
    if (text.length < 2) {
      setDeliveryHits([]);
      return;
    }
    deliverySearchTimer.current = window.setTimeout(() => {
      void (async () => {
        setDeliverySearching(true);
        try {
          const r = await fetch(`${base}/api/agents/search?search_text=${encodeURIComponent(text)}`);
          const j = tryParseJson<{ agents?: DeliveryAgentHit[] }>(await r.text()) ?? {};
          setDeliveryHits(Array.isArray(j.agents) ? j.agents.slice(0, 14) : []);
        } catch {
          setDeliveryHits([]);
        } finally {
          setDeliverySearching(false);
        }
      })();
    }, 200);
    return () => {
      if (deliverySearchTimer.current) window.clearTimeout(deliverySearchTimer.current);
    };
  }, [deliverySearchQ, base, isDeliveryEmbedded]);

  useEffect(() => {
    if (!isDeliveryEmbedded) return;
    const guid = String(selectedAgentGuid || "").trim();
    if (!guid) {
      setDeliveryFavorites([]);
      setDeliveryFavHint("اختر عميلاً لعرض الأصناف المحببة من فواتيره السابقة");
      return;
    }
    void (async () => {
      try {
        const r = await fetch(
          `${base}/api/restaurant/delivery/customer-favorites?agent_guide=${encodeURIComponent(guid)}&limit=40`,
        );
        const j = tryParseJson<{ favorites?: DeliveryFavItem[]; hint?: string }>(await r.text()) ?? {};
        setDeliveryFavorites(Array.isArray(j.favorites) ? j.favorites : []);
        setDeliveryFavHint(j.hint || null);
      } catch {
        setDeliveryFavorites([]);
        setDeliveryFavHint("تعذر جلب الأصناف المحببة");
      }
    })();
  }, [isDeliveryEmbedded, selectedAgentGuid, base]);

  function pickDeliveryAgent(a: DeliveryAgentHit) {
    setSelectedAgentGuid(a.CardGuide);
    setDeliveryName(String(a.AgentName || ""));
    setDeliveryPhone(String(a.Phone || a.Mobile || ""));
    setDeliveryAddress(String(a.FullAdress || a.Address || ""));
    setDeliverySearchQ(String(a.AgentName || ""));
    setDeliveryHits([]);
    setDeliveryCatalogTab("favorites");
    setMsg(`تم تحميل العميل: ${a.AgentName}`);
  }

  async function ensureDeliveryCustomerSaved(): Promise<string> {
    if (!deliveryName.trim() || !deliveryPhone.trim()) {
      throw new Error("مطلوب اسم العميل ورقم الهاتف للتوصيل");
    }
    const upsert = await fetch(`${base}/api/agents/delivery-upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        AgentName: deliveryName.trim(),
        Phone: deliveryPhone.trim(),
        Mobile: deliveryPhone.trim(),
        FullAdress: deliveryAddress.trim(),
      }),
    });
    const ujText = await upsert.text();
    const uj = tryParseJson<{ success?: boolean; detail?: string; CardGuide?: string }>(ujText);
    if (!upsert.ok || !uj?.success) throw new Error(uj?.detail || ujText || "تعذر حفظ عميل الدليفري");
    const g = String(uj.CardGuide || "").trim();
    setSelectedAgentGuid(g);
    return g;
  }

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
    return normalizeTableDisplayLabel(t.name, t.number, t.id);
  }

  function findCachedActiveSession(sessionId: string | null | undefined): OrderTakerSessionRow | null {
    const sid = String(sessionId || "").trim();
    if (!sid) return null;
    const row = activeSessionsRef.current.find((x) => String(x?.id || "").trim() === sid);
    return row || null;
  }

  function applySessionMetaRow(row: OrderTakerSessionRow | null | undefined) {
    const cid = String(row?.captainUserId || "").trim();
    const cname = repairArabicDisplayText(String(row?.captainName || row?.captainLogin || "").trim());
    setCaptainGate(cid ? { id: cid, name: cname || "مسند الطلب" } : null);
    const bp = row?.billingProfile;
    setSessionBillingProfile(bp && typeof bp === "object" ? bp : null);
    setSessionGuestApprovalPending(Boolean(row?.guestApprovalPending));
    setSessionCustomerTypeLocked(Boolean(row?.customerTypeLocked));
    setSessionCustomerType(String(row?.customerType || (row?.guestSession ? "guest" : bp ? "vip_owner" : "cash")));
    setBillingRequestedAt(row?.billingRequestedAt ? String(row.billingRequestedAt) : null);
    setSessionMaxInvoiceLimit(typeof row?.maxInvoiceLimit === "number" ? row.maxInvoiceLimit : null);
    setMergedIntoSessionId(String(row?.mergedIntoSessionId || "").trim());
    setMergedSourceSessionIds(
      Array.isArray(row?.mergedSourceSessionIds)
        ? row.mergedSourceSessionIds.map((x) => String(x || "").trim()).filter(Boolean)
        : [],
    );
    const guestCount = clampSeatGuestCount(row?.guestCount, 1);
    setSessionGuestCount(guestCount);
    setGuestCountDraft(String(guestCount));
    setSessionMinimumChargePerSeat(Math.max(0, toNum(row?.minimumChargePerSeat, 0)));

    // التحديد التلقائي للعميل إذا كانت الجلسة للضيف
    if (row?.guestSession) {
      const guestAgent = agents.find((a) => {
        const n = String(a?.AgentName || "").toLowerCase();
        return n.includes("guest") || n.includes("ضيف");
      });
      if (guestAgent) setSelectedAgentGuid(guestAgent.CardGuide);
    } else {
      // إذا كانت الجلسة عادية، والعميل الحالي هو "ضيف"، نعيده للعميل النقدي الافتراضي
      const currentAgent = agents.find((a) => a.CardGuide === selectedAgentGuid);
      const isCurrentGuest = currentAgent && (currentAgent.AgentName.toLowerCase().includes("guest") || currentAgent.AgentName.includes("ضيف"));
      if (isCurrentGuest) {
        const cashAgent = agents.find((a) => {
          const n = String(a?.AgentName || "").toLowerCase();
          return n.includes("cash") || n.includes("عميل نقدي") || n.includes("نقدا") || n.includes("نقدي");
        });
        if (cashAgent) setSelectedAgentGuid(cashAgent.CardGuide);
      }
    }
  }

  function applySeatGuestLabelsFromRow(row: OrderTakerSessionRow | null | undefined) {
    const raw = row && typeof row === "object" ? row.seatGuestLabels : undefined;
    const guestCount = clampSeatGuestCount(row?.guestCount, 1);
    const next: Record<number, string> = {};
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const n = Number(k);
        if (!Number.isFinite(n) || n < 1 || n > SHARED_SEAT_NO) continue;
        next[n] = String(v ?? "").slice(0, 120);
      }
    }
    for (let i = 1; i <= guestCount; i += 1) {
      if (!String(next[i] ?? "").trim()) next[i] = String(i);
    }
    setSeatGuestLabels(next);
    seatGuestLabelsRef.current = next;
  }

  const useCaptainMobileUi = narrowOtViewport;
  const appMenu = useAppMenu();

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

  async function saveGuestCount(nextRaw: number): Promise<boolean> {
    const nextCount = clampSeatGuestCount(nextRaw, sessionGuestCount || 1);
    const sessionId = activeSessionId || (await ensureGuestSession());
    if (!sessionId) {
      return false;
    }
    if (highestOccupiedNormalSeat > nextCount) {
      setMsg(`لا يمكن تقليل عدد الضيوف إلى ${nextCount} لأن هناك بنودًا مرتبطة حتى المقعد ${highestOccupiedNormalSeat}. انقل البنود أولًا أو زد العدد.`);
      return false;
    }
    const autoLabels = buildAutoNumberedSeatLabels(nextCount, seatGuestLabelsRef.current);
    setSessionBusy(true);
    setMsg("");
    try {
      const payload = Object.fromEntries(
        Array.from({ length: SHARED_SEAT_NO }, (_, idx) => {
          const seatNo = idx + 1;
          return [String(seatNo), String(autoLabels[seatNo] ?? "").trim().slice(0, 120)];
        }),
      );
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestCount: nextCount, autoNumberSeats: true, seatGuestLabels: payload }),
      });
      const txt = await r.text();
      const js = tryParseJson<PatchSessionResponse>(txt) ?? {};
      if (!r.ok) throw new Error(js.detail || txt || `HTTP ${r.status}`);
      const sessionRow = js.session ?? (js as OrderTakerSessionRow);
      setSessionGuestCount(nextCount);
      setGuestCountDraft(String(nextCount));
      setSeatGuestLabels(autoLabels);
      seatGuestLabelsRef.current = autoLabels;
      setSelectedSeat((prev) => (prev !== SHARED_SEAT_NO && prev > nextCount ? nextCount : prev));
      applySessionMetaRow(sessionRow);
      applySeatGuestLabelsFromRow(sessionRow);
      setMsg(`تم اعتماد ${nextCount} ضيف/كرسي للجلسة الحالية.`);
      return true;
    } catch (e) {
      setMsg(`تعذر حفظ عدد الضيوف: ${briefNetworkHint(e)}`);
      return false;
    } finally {
      setSessionBusy(false);
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


  const loadAll = useCallback(async (preserveMsg = false) => {
    if (!preserveMsg) setMsg("");
    setLoading(true);
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
          waiterTableAssignments?: unknown;
          tempCaptainTransfers?: unknown;
          workflowSettings?: Record<string, unknown>;
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
      const wfj = boot.workflowSettings ?? {};
      const assignmentRows = normalizeWaiterTableAssignments(boot.waiterTableAssignments);
      const tempTransfers = normalizeTempCaptainTransfers(boot.tempCaptainTransfers);
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

      const sessListRaw = Array.isArray(rsj.sessions) ? (rsj.sessions as OrderTakerSessionRow[]) : [];
      const sessList = sortSessionsByRecencyDesc(sessListRaw);
      activeSessionsRef.current = sessList;
      const uid = user?.id != null ? String(user.id) : "";
      const mgrDev = roleHasManagerOpsAccess(user?.role);
      const allowedTableKeys = new Set<string>();
      for (const s of sessList as { captainUserId?: string; tableId?: string }[]) {
        if (!s || typeof s !== "object") continue;
        if (String(s.captainUserId || "").trim() === uid && uid) allowedTableKeys.add(tableRefKey(s.tableId));
      }
      const ex = String((wfj as { orderTakerExclusiveTable?: string }).orderTakerExclusiveTable || "").toLowerCase();
      const exclusiveOn = ex === "on" || ex === "1" || ex === "true" || ex === "yes";
      const assignmentRestricted = waiterTableAssignmentRestrictionApplies({
        rows: assignmentRows,
        tempTransfers,
        userId: uid,
        userRole: user?.role,
        exclusiveOn,
      });
      const assignedTableIds = effectiveTableIdsForUser({ assignmentRows, tempTransfers, userId: uid });
      const outFiltered = mgrDev
        ? outList
        : assignmentRestricted
          ? outList.filter((t: any) => assignedTableIds.has(tableRefKey(t.id)))
          : outList.filter((t: any) => allowedTableKeys.has(tableRefKey(t.id)));

      setSessionByTableRef(buildSessionByTableRef(sessList as unknown[], outList));
      setTablesMoveCatalog(outList);
      setOrderTakerExclusiveTable(exclusiveOn);

      const fromUrl = searchParams.get("tableId");
      let unauthorizedTableName = "";
      let unauthorizedKind: "" | "captain" | "assignment" = "";
      if (fromUrl && !mgrDev && !outFiltered.some((x: any) => x.id === fromUrl)) {
        const foreignTable = outList.find((t: any) => t.id === fromUrl);
        if (foreignTable) {
          unauthorizedTableName = String(foreignTable.name || foreignTable.id || "هذه الطاولة");
          unauthorizedKind = assignmentRestricted ? "assignment" : "captain";
        }
      }
      setUnauthorizedAccessTable(unauthorizedTableName);
      setUnauthorizedAccessKind(unauthorizedKind);
      if (isDeliveryEmbedded) {
        const withDeliv = outFiltered.some((t: any) => String(t.id) === DELIVERY_SYNTH_TABLE_ID)
          ? outFiltered
          : [DELIVERY_SYNTH_TABLE, ...outFiltered];
        setTables(withDeliv);
        setSelectedTableId(DELIVERY_SYNTH_TABLE_ID);
      } else {
        setTables(outFiltered);
        setSelectedTableId((prev) => {
          const arr = outFiltered;
          if (fromUrl && arr.some((x: any) => x.id === fromUrl)) return fromUrl;
          if (prev && arr.some((x: any) => x.id === prev)) return prev;
          return arr.length ? arr[0].id : "";
        });
      }

      if (!isDeliveryEmbedded && outFiltered.length === 0) {
        if (outList.length === 0) {
          setMsg(
            "لا توجد طاولات في المخطط — من المطوّر: تهيئة TBL005 + floor_plan.json أو افتح الطاولة من «لوحة الطاولات» أولاً.",
          );
        } else if (!mgrDev && assignmentRestricted) {
          setMsg("لا توجد طاولات مخصصة لك في هذه الفترة. راجع المدير أو شاشة توزيع الطاولات.");
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
      setCaptainItemSelectionMode(opJson.captainItemSelectionMode === "wizard" ? "wizard" : "classic");
      setSelectedAgentGuid((prev) => {
        const fromUrlAgent = String(searchParams.get("agentGuid") || "").trim();
        if (isDeliveryEmbedded && fromUrlAgent) return fromUrlAgent;
        if (isDeliveryEmbedded && prev) return prev;
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
    } finally {
      setLoading(false);
    }
  }, [base, searchParams, user?.id, user?.role, isDeliveryEmbedded]);

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

  const billReviewLines = useMemo<CaptainBillReviewLine[]>(() => {
    const rows: CaptainBillReviewLine[] = [];
    for (const o of sessionOrders) {
      const orderStatus = String(o.status || "").toLowerCase();
      if (orderStatus === "cancelled") continue;
      for (const it of activeOrderItems(o)) {
        const lid = String(it.lineId || "").trim();
        if (!lid) continue;
        const originalQty = Number(it.quantity ?? 1) || 1;
        const unitPrice = Number(it.unitPrice ?? 0) || 0;
        const approvedQty = approvedReturnsMap[`${o.id}:${lid}`] || 0;
        const qty = Math.max(0, originalQty - approvedQty);
        if (qty <= 0) continue;
        rows.push({
          key: `${o.id}:${lid}`,
          name: String(it.name || "صنف"),
          quantity: qty,
          unitPrice,
          lineTotal: qty * unitPrice,
          seatNo: extractSeatFromOrderItem(it),
          statusLabel: orderStatusLabelAr(String(it.lineStatus || o.status || "")),
        });
      }
    }
    return rows;
  }, [sessionOrders, approvedReturnsMap]);

  const returnedReviewLines = useMemo<CaptainBillReviewLine[]>(() => {
    const rows: CaptainBillReviewLine[] = [];
    for (const o of sessionOrders) {
      const orderStatus = String(o.status || "").toLowerCase();
      if (orderStatus === "cancelled") continue;
      for (const it of activeOrderItems(o)) {
        const lid = String(it.lineId || "").trim();
        if (!lid) continue;
        const approvedQty = approvedReturnsMap[`${o.id}:${lid}`] || 0;
        if (approvedQty <= 0) continue;
        const unitPrice = Number(it.unitPrice ?? 0) || 0;
        rows.push({
          key: `ret:${o.id}:${lid}`,
          name: String(it.name || "صنف"),
          quantity: approvedQty,
          unitPrice,
          lineTotal: approvedQty * unitPrice,
          seatNo: extractSeatFromOrderItem(it),
          statusLabel: "مرتجع معتمد",
        });
      }
    }
    return rows;
  }, [sessionOrders, approvedReturnsMap]);

  const reviewSeatMoveRows = useMemo<ReviewSeatMoveRow[]>(() => {
    const rows: ReviewSeatMoveRow[] = [];
    for (const l of cart) {
      if (Number(l.qty || 0) <= 0) continue;
      rows.push({
        key: `cart:${l.id}`,
        source: "cart",
        lineId: l.id,
        name: l.name,
        qty: Number(l.qty || 0) || 0,
        seatNo: seatNoFromLine(l),
        statusText: "قيد الإرسال",
        statusTone: "cart",
      });
    }
    for (const o of sessionOrders) {
      const orderStatus = String(o.status || "").toLowerCase();
      if (orderStatus === "cancelled" || orderStatus === "paid") continue;
      for (const it of activeOrderItems(o)) {
        const lid = String(it.lineId || "").trim();
        if (!lid) continue;
        rows.push({
          key: `order:${o.id}:${lid}`,
          source: "order",
          orderId: o.id,
          lineId: lid,
          name: String(it.name || "صنف"),
          qty: Number(it.quantity ?? 1) || 1,
          seatNo: extractSeatFromOrderItem(it),
          statusText: orderStatusLabelAr(String(it.lineStatus || o.status || "")),
          statusTone: "sent",
        });
      }
    }
    return rows;
  }, [cart, sessionOrders]);

  const highestOccupiedNormalSeat = useMemo(() => {
    let maxSeat = 1;
    for (const row of reviewSeatMoveRows) {
      const seatNo = row.seatNo != null ? Number(row.seatNo) : 0;
      if (Number.isFinite(seatNo) && seatNo >= 1 && seatNo <= SEAT_SLOT_COUNT) {
        maxSeat = Math.max(maxSeat, Math.floor(seatNo));
      }
    }
    return maxSeat;
  }, [reviewSeatMoveRows]);

  const activeGuestSeatCount = useMemo(() => {
    let maxLabeled = 1;
    for (let i = 1; i <= SEAT_SLOT_COUNT; i += 1) {
      if (String(seatGuestLabels[i] ?? "").trim()) maxLabeled = i;
    }
    return clampSeatGuestCount(Math.max(sessionGuestCount, maxLabeled, highestOccupiedNormalSeat), 1);
  }, [sessionGuestCount, seatGuestLabels, highestOccupiedNormalSeat]);

  const visibleSeatNumbers = useMemo(
    () => Array.from({ length: activeGuestSeatCount }, (_, idx) => idx + 1),
    [activeGuestSeatCount],
  );

  const guestSeatNumbers = useMemo(
    () => [SHARED_SEAT_NO, ...visibleSeatNumbers],
    [visibleSeatNumbers],
  );

  const seatCartStats = useMemo(() => {
    const map = new Map<number, { qty: number; lines: number }>();
    for (const line of cart) {
      const seatNo = seatNoFromLine(line);
      if (seatNo == null) continue;
      const prev = map.get(seatNo) ?? { qty: 0, lines: 0 };
      prev.qty += Number(line.qty || 0);
      prev.lines += 1;
      map.set(seatNo, prev);
    }
    return map;
  }, [cart]);

  const captainDockSeats = useMemo(
    () => (assignmentMode === "per_seat" ? [...visibleSeatNumbers, SHARED_SEAT_NO] : []),
    [assignmentMode, visibleSeatNumbers],
  );

  const showCaptainGuestDock =
    !isDeliveryEmbedded &&
    useCaptainMobileUi &&
    captainShowsGuestDock(captainTab, assignmentMode === "per_seat", captainDockSeats);

  const desktopSeatPills = useMemo(
    () => (assignmentMode === "per_seat" ? [...visibleSeatNumbers, SHARED_SEAT_NO] : []),
    [assignmentMode, visibleSeatNumbers],
  );

  useEffect(() => {
    if (!useCaptainMobileUi || assignmentMode !== "per_seat") return;
    if (captainDockSeats.length > 0 && !captainDockSeats.includes(selectedSeat)) {
      setSelectedSeat(captainDockSeats[0]!);
    }
  }, [captainDockSeats, selectedSeat, useCaptainMobileUi, assignmentMode]);

  async function requireSeatFlowBeforeOrder(): Promise<boolean> {
    if (isDeliveryEmbedded) return true;
    if (!useDesktopOrderWorkspace) return true;
    if (selectedTableBlocked) {
      setMsg("الطاولة غير جاهزة للطلبات (متسخة/قيد التنظيف).");
      return false;
    }
    if (!selectedTableId || !activeSessionId || assignmentMode !== "per_seat" || activeGuestSeatCount < 1) {
      setMsg("ابدأ من زر منيموم شارج وحدد عدد الأفراد أولًا قبل تسجيل الأصناف على المقاعد.");
      await openMinimumChargeFlow();
      return false;
    }
    return true;
  }

  const waiterMenuGroups = useMemo(() => {
    const groupIds = new Set<string>();
    for (const p of menuEligibleProducts) {
      const g = String(p.GroupGuid || "").trim();
      if (g) groupIds.add(g);
    }
    return normalizedGroups.filter((g) => groupIds.has(g.CardGuide));
  }, [menuEligibleProducts, normalizedGroups]);

  const displayCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const g of waiterMenuGroups) {
      const c = (g.DisplayCategory || "").trim();
      if (c) cats.add(c);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b, "ar"));
  }, [waiterMenuGroups]);

  const groupsInSelectedCategory = useMemo(() => {
    if (categoryKey === "all") return [];
    return waiterMenuGroups.filter((g) => (g.DisplayCategory || "").trim() === categoryKey);
  }, [waiterMenuGroups, categoryKey]);

  useEffect(() => {
    setSubGroupKey("all");
  }, [categoryKey]);

  useEffect(() => {
    if (displayMode === "group") setSubGroupKey("all");
  }, [displayMode]);

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
        const sess = Array.isArray((sj as { sessions?: unknown }).sessions)
          ? ((sj as { sessions: OrderTakerSessionRow[] }).sessions ?? [])
          : [];
        activeSessionsRef.current = sess;
        setSessionByTableRef(buildSessionByTableRef(sess, tablesMoveCatalog));
        if (!activeSessionId) {
          if (!stop) {
            setCaptainGate(null);
            setSessionBillingProfile(null);
            setBillingRequestedAt(null);
            setMergedIntoSessionId("");
            setMergedSourceSessionIds([]);
          }
          return;
        }
        let row: OrderTakerSessionRow | undefined;
        for (const x of sess) {
          if (!x || typeof x !== "object") continue;
          const o = x as OrderTakerSessionRow;
          if (String(o.id || "") === String(activeSessionId)) {
            row = o;
            break;
          }
        }
        if (!stop) {
          applySessionMetaRow(row);
        }
      } catch {
        if (!stop) {
          setCaptainGate(null);
          setSessionBillingProfile(null);
          setSessionGuestApprovalPending(false);
          setSessionCustomerTypeLocked(false);
          setSessionCustomerType("cash");
          setSessionMaxInvoiceLimit(null);
          setBillingRequestedAt(null);
        }
      }
    };
    const id = window.setInterval(() => void tick(), 12000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [base, activeSessionId, tablesMoveCatalog]);

  const orderTakingLocked = useMemo(() => {
    if (!orderTakerExclusiveTable) return false;
    if (!captainGate?.id) return false;
    if (roleHasManagerOpsAccess(user?.role)) return false;
    if (!user?.id) return false;
    return String(user.id) !== String(captainGate.id);
  }, [orderTakerExclusiveTable, captainGate, user?.id, user?.role]);

  const customerTypeLocked = sessionCustomerTypeLocked || sessionOrders.length > 0;
  const canManagerResolveGuest = roleHasManagerOpsAccess(user?.role) && sessionGuestApprovalPending;

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
    if (selectedSeat !== SHARED_SEAT_NO && selectedSeat > activeGuestSeatCount) setSelectedSeat(activeGuestSeatCount);
  }, [selectedSeat, activeGuestSeatCount]);

  useEffect(() => {
    setSeatNameEditorSeat(null);
    if (patchSeatTimer.current) window.clearTimeout(patchSeatTimer.current);
    patchSeatTimer.current = null;
    let cancelled = false;
    if (!activeSessionId) {
      setSeatGuestLabels({});
      seatGuestLabelsRef.current = {};
      setSessionGuestCount(1);
      setGuestCountDraft("1");
      setSessionMinimumChargePerSeat(0);
      return () => {
        cancelled = true;
      };
    }
    const cached = findCachedActiveSession(activeSessionId);
    if (cached) {
      applySeatGuestLabelsFromRow(cached);
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
        activeSessionsRef.current = Array.isArray(list) ? (list as OrderTakerSessionRow[]) : [];
        if (!cancelled) {
          applySeatGuestLabelsFromRow(row as OrderTakerSessionRow | undefined);
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
      let sessions = activeSessionsRef.current;
      if (!sessions.length) {
        const vr = await safeFetch(`${base}/api/restaurant/table-sessions?status=active`, { timeoutMs: 10000 });
        if (!vr.ok) return null;
        const vj = tryParseJson<{ sessions?: unknown }>(await vr.text()) ?? {};
        sessions = sortSessionsByRecencyDesc(Array.isArray(vj.sessions) ? (vj.sessions as OrderTakerSessionRow[]) : []);
        activeSessionsRef.current = sessions;
      }
      const sameTableActive = sessions
        .filter((x) => String(x?.status || "active").toLowerCase() === "active")
        .filter((x) => restaurantTableIdsEqual(String(x?.tableId || ""), String(tableId || "")))
        .slice()
        .sort(compareSessionRecencyDesc);
      const latest = sameTableActive[0];
      if (latest?.id) {
        if (urlSessionId) {
          const fromUrl = sameTableActive.find((x) => String(x.id || "") === String(urlSessionId));
          if (fromUrl?.id && String(fromUrl.id) === String(latest.id)) return String(latest.id);
        }
        return String(latest.id);
      }
      const cr = await safeFetch(`${base}/api/restaurant/table-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, guestCount: 1, autoNumberSeats: true, mat3amActor: buildMat3amActor(user) }),
        timeoutMs: 12000,
      });
      if (!cr.ok) return null;
      const rec = tryParseJson<{ id?: string; approvalRequested?: boolean; message?: string }>(await cr.text());
      if (rec?.approvalRequested) {
        setMsg(typeof rec.message === "string" && rec.message.trim() ? rec.message : "تم رفع طلب موافقة للمدير.");
        return null;
      }
      return rec?.id ? String(rec.id) : null;
    },
    [base, urlSessionId, user]
  );

  const ensureGuestSession = useCallback(async (): Promise<string | null> => {
    if (activeSessionId) return activeSessionId;
    if (!selectedTableId) {
      setMsg("اختر طاولة أولًا قبل إدارة الضيوف أو المينيموم شارج.");
      return null;
    }
    if (selectedTableBlocked) {
      setMsg("الطاولة الحالية ليست جاهزة للتشغيل الآن.");
      return null;
    }
    setSessionBusy(true);
    setMsg("");
    try {
      const sid = await resolveSessionForTable(selectedTableId);
      if (!sid) {
        setMsg("تعذر فتح جلسة الطاولة الحالية. أعد المحاولة.");
        return null;
      }
      setActiveSessionId(sid);
      activeSessionsRef.current = [];
      return sid;
    } catch (e) {
      setMsg(`تعذر فتح جلسة الطاولة: ${briefNetworkHint(e)}`);
      return null;
    } finally {
      setSessionBusy(false);
    }
  }, [activeSessionId, resolveSessionForTable, selectedTableBlocked, selectedTableId]);

  const requestGuestSessionApproval = useCallback(async () => {
    if (billingRequestedAt) {
      setMsg("تم طلب الحساب — لا يمكن تحويل الجلسة إلى ضيف الآن.");
      return;
    }
    if (sessionGuestApprovalPending) {
      setMsg("هذه الجلسة لديها بالفعل طلب ضيف بانتظار اعتماد المدير.");
      return;
    }
    if (customerTypeLocked) {
      setMsg("نوع العميل مقفول بعد أول طلب على الجلسة.");
      return;
    }
    const sid = await ensureGuestSession();
    if (!sid) return;
    setSessionBusy(true);
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/restaurant/manager-approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "guest_session_request",
          sessionId: sid,
          reason: "طلب تحويل الجلسة إلى ضيف صالة من شاشة الطلب",
          mat3amActor: buildMat3amActor(user),
        }),
      });
      const txt = await r.text();
      const js = tryParseJson<PatchSessionResponse>(txt) ?? {};
      if (!r.ok) throw new Error(js.detail || txt || `HTTP ${r.status}`);
      setSessionGuestApprovalPending(true);
      setSessionCustomerType("cash");
      setSelectedAgentGuid("");
      setMsg(js.message || "تم تسجيل الجلسة كضيف مؤقت وإشعار المدير لاتخاذ القرار.");
    } catch (e) {
      setMsg(`تعذر تسجيل الجلسة كضيف مؤقت: ${briefNetworkHint(e)}`);
    } finally {
      setSessionBusy(false);
    }
  }, [
    base,
    billingRequestedAt,
    customerTypeLocked,
    ensureGuestSession,
    sessionGuestApprovalPending,
    user,
  ]);

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

  useEffect(() => {
    applySessionMetaRow(findCachedActiveSession(activeSessionId));
  }, [activeSessionId]);

  const loadSessionOrders = useCallback(async () => {
    if (!activeSessionId) {
      setSessionOrders([]);
      return;
    }
    setOrdersBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/orders?sessionId=${encodeURIComponent(activeSessionId)}&includeMerged=true`);
      const j = tryParseJson<{ orders?: unknown }>(await r.text()) ?? {};
      const list = Array.isArray(j.orders) ? j.orders : [];
      setSessionOrders(list as ServerOrder[]);
    } catch {
      setSessionOrders([]);
    } finally {
      setOrdersBusy(false);
    }
  }, [base, activeSessionId]);

  const loadSessionInvoices = useCallback(async () => {
    if (!activeSessionId) {
      setSessionInvoices([]);
      return;
    }
    try {
      const q = new URLSearchParams();
      q.set("payment_status", "all");
      q.set("session_id", activeSessionId);
      const r = await fetch(`${base}/api/restaurant/invoices-local?${q.toString()}`);
      const j = tryParseJson<{ invoices?: unknown }>(await r.text()) ?? {};
      const list = Array.isArray(j.invoices) ? (j.invoices as CashierInvoiceRow[]) : [];
      setSessionInvoices(list);
    } catch {
      setSessionInvoices([]);
    }
  }, [activeSessionId, base]);

  const loadPendingGuestApproval = useCallback(async () => {
    if (!activeSessionId || !sessionGuestApprovalPending) {
      setPendingGuestApprovalId(null);
      return;
    }
    try {
      const r = await safeFetch(
        `${base}/api/restaurant/manager-approvals?status=pending_manager&reqType=guest_session_request`,
        { timeoutMs: 12000 },
      );
      const j = tryParseJson<{ requests?: GuestApprovalRequestRow[] }>(await r.text()) ?? {};
      const rows = Array.isArray(j.requests) ? j.requests : [];
      const match = rows.find((row) => String(row?.sessionId || "").trim() === String(activeSessionId).trim());
      setPendingGuestApprovalId(match?.id ? String(match.id) : null);
    } catch {
      setPendingGuestApprovalId(null);
    }
  }, [activeSessionId, base, sessionGuestApprovalPending]);

  const loadApprovedGuestReturns = useCallback(async () => {
    if (!activeSessionId) {
      setApprovedReturnsMap({});
      return;
    }
    try {
      const r = await fetch(`${base}/api/restaurant/guest-returns?sessionId=${encodeURIComponent(activeSessionId)}&status=approved`);
      const j = tryParseJson<{ requests?: Array<{ lines?: Array<{ orderId?: string; lineId?: string; returnQty?: number }> }> }>(await r.text()) ?? {};
      const map: Record<string, number> = {};
      for (const req of j.requests || []) {
        for (const ln of req.lines || []) {
          if (!ln) continue;
          const key = `${ln.orderId || ""}:${ln.lineId || ""}`;
          if (key === ":") continue;
          map[key] = (map[key] || 0) + (Number(ln.returnQty) || 0);
        }
      }
      setApprovedReturnsMap(map);
    } catch {
      setApprovedReturnsMap({});
    }
  }, [activeSessionId, base]);

  useEffect(() => {
    void loadSessionOrders();
    void loadApprovedGuestReturns();
    const id = window.setInterval(() => void loadSessionOrders(), 12000);
    return () => window.clearInterval(id);
  }, [loadSessionOrders, loadApprovedGuestReturns]);

  useEffect(() => {
    void loadSessionInvoices();
    if (!billingRequestedAt) return;
    const id = window.setInterval(() => void loadSessionInvoices(), 12000);
    return () => window.clearInterval(id);
  }, [billingRequestedAt, loadSessionInvoices]);

  useEffect(() => {
    void loadPendingGuestApproval();
  }, [loadPendingGuestApproval]);

  const filteredProducts = useMemo(() => {
    let list = menuEligibleProducts;
    if (displayMode === "category" && categoryKey !== "all") {
      const targetIds = new Set<string>();
      for (const g of waiterMenuGroups) {
        if ((g.DisplayCategory || "").trim() === categoryKey) targetIds.add(g.CardGuide);
      }
      list = list.filter((p) => targetIds.has(String(p.GroupGuid || "").trim()));
      if (subGroupKey !== "all") {
        list = list.filter((p) => (p.GroupGuid || "") === subGroupKey);
      }
    } else if (displayMode === "group" && categoryKey !== "all") {
      list = list.filter((p) => (p.GroupGuid || "") === categoryKey);
    }
    if (sortMode === "name") {
      list = [...list].sort((a, b) => (a.ProductName || "").localeCompare(b.ProductName || "", "ar"));
    } else if (sortMode === "price") {
      list = [...list].sort((a, b) => (a.Price || 0) - (b.Price || 0));
    }
    return list;
  }, [menuEligibleProducts, categoryKey, subGroupKey, displayMode, sortMode, waiterMenuGroups]);

  const navoptsDialogTitle =
    navoptsActiveTab === "returns"
      ? "مرتجع الطاولة"
      : navoptsActiveTab === "transfer"
        ? "تحويل الطاولة"
        : navoptsActiveTab === "merge"
          ? "دمج الجلسات بين الطاولات"
          : navoptsActiveTab === "reorder"
            ? "نقل البنود بين الضيوف"
            : navoptsActiveTab === "invoices"
              ? "شيكات الطاولة"
              : "";

  const navoptsDialogNote =
    navoptsActiveTab === "returns"
      ? "افتح المرتجع من نافذة واسعة وواضحة بدل العمود الضيق."
      : navoptsActiveTab === "transfer"
        ? "اختر الطاولة الهدف براحة بصرية، مع دعم التحديد أو الدبل كليك للتنفيذ."
        : navoptsActiveTab === "merge"
          ? "راجع الطاولة الهدف بوضوح ثم نفذ الدمج من نفس النافذة."
          : navoptsActiveTab === "reorder"
            ? "انقل البنود بين الضيوف ضمن مساحة أكبر وأسهل للمراجعة."
            : navoptsActiveTab === "invoices"
              ? "راجع شيكات الطاولة ومعاينة الطباعة من نافذة مستقلة."
              : "";

  const closeNavoptsDialog = useCallback(() => {
    setNavoptsActiveTab(null);
  }, []);

  const openGuestSeatDialog = useCallback(async () => {
    const sid = await ensureGuestSession();
    if (!sid) return;
    if (useCaptainMobileUi) setCaptainTab("guests");
    setGuestSeatDialogOpen(true);
  }, [ensureGuestSession, useCaptainMobileUi]);

  const openMinimumChargeFlow = useCallback(async () => {
    const sid = await ensureGuestSession();
    if (!sid) return;
    setAssignmentMode("per_seat");
    setGuestCountDraft(String(activeGuestSeatCount || 1));
    setMinimumChargeFlowStep("count");
    setMinimumChargeFlowOpen(true);
  }, [activeGuestSeatCount, ensureGuestSession]);

  const confirmMinimumChargeFlow = useCallback(async () => {
    const ok = await saveGuestCount(Number(guestCountDraft) || activeGuestSeatCount);
    if (!ok) return;
    setMinimumChargeFlowStep("naming");
    setMinimumChargeFlowOpen(true);
  }, [activeGuestSeatCount, guestCountDraft, saveGuestCount]);

  const answerMinimumChargeNaming = useCallback(
    async (wantsNaming: boolean) => {
      setMinimumChargeFlowOpen(false);
      if (!wantsNaming) return;
      await openGuestSeatDialog();
    },
    [openGuestSeatDialog],
  );

  const closeGuestSeatDialog = useCallback(() => {
    setGuestSeatDialogOpen(false);
    setSeatNameEditorSeat(null);
  }, []);

  const openNavoptsDialog = useCallback(
    (tab: "returns" | "transfer" | "merge" | "reorder" | "invoices") => {
      if ((tab === "transfer" || tab === "merge") && Boolean(billingRequestedAt)) {
        setMsg("تم طلب الحساب — لا يمكن تحويل أو دمج الطاولة الآن.");
        return;
      }
      setNavoptsActiveTab(tab);
    },
    [billingRequestedAt],
  );

  useEffect(() => {
    if (!navoptsActiveTab && !guestSeatDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (guestSeatDialogOpen) {
        closeGuestSeatDialog();
        return;
      }
      closeNavoptsDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navoptsActiveTab, guestSeatDialogOpen, closeGuestSeatDialog, closeNavoptsDialog]);

  useEffect(() => {
    if (categoryKey === "all") return;
    if (displayMode === "group" && waiterMenuGroups.some((g) => g.CardGuide === categoryKey)) return;
    if (displayMode === "category" && displayCategories.includes(categoryKey)) return;
    setCategoryKey("all");
  }, [categoryKey, waiterMenuGroups, displayMode, displayCategories]);

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
  const effectiveMinimumChargePerSeat = useMemo(() => {
    if (isDeliveryEmbedded) return 0;
    const sessionValue = Math.max(0, toNum(sessionMinimumChargePerSeat, 0));
    if (sessionValue > 0) return sessionValue;
    const tableValue = Math.max(0, toNum(selectedTable?.minimumCharge, 0));
    if (tableValue > 0) return tableValue;
    return Math.max(0, tableMinDefaultOps);
  }, [isDeliveryEmbedded, selectedTable, sessionMinimumChargePerSeat, tableMinDefaultOps]);

  const effectiveTableMinimum = useMemo(
    () => effectiveMinimumChargePerSeat * activeGuestSeatCount,
    [effectiveMinimumChargePerSeat, activeGuestSeatCount],
  );

  const buildSeatMinimumSummary = useCallback(
    (rows: Array<{ lineTotal: number; seatNo?: number | null }>) => {
      const seatMap = new Map<number, number>();
      for (const seatNo of visibleSeatNumbers) seatMap.set(seatNo, 0);
      const distributionTargets = visibleSeatNumbers.length > 0 ? visibleSeatNumbers : [1];
      for (const row of rows) {
        const lineTotal = Math.max(0, Number(row.lineTotal || 0));
        if (lineTotal <= 0) continue;
        const rawSeat = row.seatNo != null ? Number(row.seatNo) : null;
        if (
          rawSeat != null &&
          Number.isFinite(rawSeat) &&
          rawSeat >= 1 &&
          rawSeat <= SEAT_SLOT_COUNT &&
          rawSeat !== SHARED_SEAT_NO &&
          seatMap.has(Math.floor(rawSeat))
        ) {
          const seatNo = Math.floor(rawSeat);
          seatMap.set(seatNo, (seatMap.get(seatNo) || 0) + lineTotal);
          continue;
        }
        const share = lineTotal / distributionTargets.length;
        for (const seatNo of distributionTargets) {
          seatMap.set(seatNo, (seatMap.get(seatNo) || 0) + share);
        }
      }
      const sbp = sessionBillingProfile;
      const billActive = !!(sbp && typeof sbp === "object" && sbp.active !== false);
      const vipPct = billActive ? Math.max(0, Math.min(100, toNum(sbp?.discountPct, 0))) : 0;
      const seats = visibleSeatNumbers.map((seatNo) => {
        const subtotal = Math.max(0, Number(seatMap.get(seatNo) || 0));
        const netAfterOwner = billActive ? Math.max(0, subtotal * (1 - vipPct / 100)) : subtotal;
        const serviceCharge = billActive && sbp?.noService ? 0 : (netAfterOwner * policy.servicePercent) / 100;
        const vatValue =
          billActive && sbp?.noVat
            ? 0
            : policy.serviceBeforeVat
              ? ((netAfterOwner + serviceCharge) * policy.vatPercent) / 100
              : (netAfterOwner * policy.vatPercent) / 100;
        const grossBeforeMinimum = netAfterOwner + serviceCharge + vatValue;
        const minimumGap =
          !isDeliveryEmbedded && effectiveMinimumChargePerSeat > 0
            ? Math.max(0, effectiveMinimumChargePerSeat - grossBeforeMinimum)
            : 0;
        return { seatNo, subtotal, serviceCharge, vatValue, grossBeforeMinimum, minimumGap };
      });
      return {
        seats,
        subtotal: seats.reduce((sum, row) => sum + row.subtotal, 0),
        serviceCharge: seats.reduce((sum, row) => sum + row.serviceCharge, 0),
        vatValue: seats.reduce((sum, row) => sum + row.vatValue, 0),
        grossBeforeMinimum: seats.reduce((sum, row) => sum + row.grossBeforeMinimum, 0),
        minimumGap: seats.reduce((sum, row) => sum + row.minimumGap, 0),
      };
    },
    [
      visibleSeatNumbers,
      sessionBillingProfile,
      policy.servicePercent,
      policy.serviceBeforeVat,
      policy.vatPercent,
      effectiveMinimumChargePerSeat,
      isDeliveryEmbedded,
    ],
  );

  const liveMinimumChargeLines = useMemo(
    () => [
      ...billReviewLines.map((line) => ({ lineTotal: Number(line.lineTotal || 0), seatNo: line.seatNo ?? null })),
      ...cart
        .filter((line) => Number(line.qty || 0) > 0)
        .map((line) => ({
          lineTotal: Math.max(0, Number(line.qty || 0)) * Math.max(0, Number(line.unitPrice || 0)),
          seatNo: seatNoFromLine(line),
        })),
    ],
    [billReviewLines, cart],
  );

  const currentSeatMinimumSummary = useMemo(
    () => buildSeatMinimumSummary(liveMinimumChargeLines),
    [buildSeatMinimumSummary, liveMinimumChargeLines],
  );

  const netAfterMinimum = netBeforeTax;
  const minimumChargeDelta = currentSeatMinimumSummary.minimumGap;

  const reviewSeatMinimumSummary = useMemo(
    () => buildSeatMinimumSummary(billReviewLines.map((line) => ({ lineTotal: Number(line.lineTotal || 0), seatNo: line.seatNo ?? null }))),
    [buildSeatMinimumSummary, billReviewLines],
  );

  const reviewMinimumChargeDelta = reviewSeatMinimumSummary.minimumGap;

  const reviewBillingTotals = useMemo(() => {
    const sbp = sessionBillingProfile;
    const billActive = !!(sbp && typeof sbp === "object" && sbp.active !== false);
    const ownerTpl = billActive && String(sbp?.source || "") === "vip_owner_template";
    return {
      netPortion: reviewSeatMinimumSummary.subtotal,
      serviceCharge: reviewSeatMinimumSummary.serviceCharge,
      vatValue: reviewSeatMinimumSummary.vatValue,
      ownerTpl,
    };
  }, [
    sessionBillingProfile,
    reviewSeatMinimumSummary,
  ]);

  const reviewTotal = Math.max(
    0,
    reviewSeatMinimumSummary.grossBeforeMinimum +
    reviewMinimumChargeDelta +
    Math.max(0, tipAmount || 0),
  );

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
  const sessionSummarySubtotal = Math.max(0, reviewBillingTotals.netPortion + billingTotals.netPortion);
  const sessionSummaryService = Math.max(0, reviewBillingTotals.serviceCharge + billingTotals.serviceCharge);
  const sessionSummaryVat = Math.max(0, reviewBillingTotals.vatValue + billingTotals.vatValue);
  const sessionSummaryMinimumGap = Math.max(0, reviewMinimumChargeDelta + minimumChargeDelta);
  const sessionSummaryTotal = Math.max(
    0,
    sessionSummarySubtotal +
      sessionSummaryService +
      sessionSummaryVat +
      sessionSummaryMinimumGap +
      Math.max(0, tipAmount || 0),
  );
  const itemCount = cart.reduce((a, l) => a + l.qty, 0);
  const billingLocked = Boolean(billingRequestedAt);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CAPTAIN_BILL_PRINTER_STORAGE_KEY, captainPrinterHint.trim());
    } catch {
      /* ignore */
    }
  }, [captainPrinterHint]);

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

  async function handleProductClick(p: Product) {
    if (!(await requireSeatFlowBeforeOrder())) return;
    if (captainItemSelectionMode !== "wizard") {
      pushCartLineForProduct(p, [], "", 1);
      return;
    }
    try {
      const [groupsR, linksR] = await Promise.all([
        fetch(`${base}/api/restaurant/modifier-groups`),
        fetch(`${base}/api/restaurant/product-modifiers/${encodeURIComponent(p.CardGuide)}`),
      ]);
      const gj = await groupsR.json().catch(() => ({ groups: [] }));
      const lj = await linksR.json().catch(() => ({ groupIds: [], entries: [] }));
      const allGroups: ModifierGroup[] = Array.isArray(gj?.groups) ? gj.groups : [];
      const profileEntries: ProductModifierProfileEntry[] = Array.isArray(lj?.entries) ? lj.entries : [];
      const linkedIds: string[] = Array.isArray(lj?.groupIds) ? lj.groupIds : [];
      const normalizedEntries = profileEntries
        .filter((entry) => !!entry && typeof entry === "object" && String(entry.groupId || "").trim())
        .filter((entry) => entry.isEnabled !== false);
      const productGroups: ModifierGroup[] = normalizedEntries.length
        ? normalizedEntries.reduce<ModifierGroup[]>((acc, entry, idx) => {
          const baseGroup = allGroups.find((g) => g.groupId === entry.groupId);
          if (!baseGroup) return acc;
          const minSelect = entry.minSelect != null ? Math.max(0, Number(entry.minSelect) || 0) : baseGroup.minSelect;
          const maxSelectRaw = entry.maxSelect != null ? Math.max(0, Number(entry.maxSelect) || 0) : baseGroup.maxSelect;
          const maxSelect = Math.max(minSelect, maxSelectRaw);
          acc.push({
            ...baseGroup,
            sortOrder: entry.sortOrder != null ? Number(entry.sortOrder) || idx : baseGroup.sortOrder,
            isRequired: entry.isRequired == null ? baseGroup.isRequired : Boolean(entry.isRequired),
            minSelect,
            maxSelect,
            allowFreeText: entry.allowFreeText == null ? Boolean(baseGroup.allowFreeText) : Boolean(entry.allowFreeText),
            freeTextRequired: entry.freeTextRequired == null ? Boolean(baseGroup.freeTextRequired) : Boolean(entry.freeTextRequired),
            freeTextLabel: String(entry.freeTextLabel || baseGroup.freeTextLabel || ""),
            freeTextPlaceholder: String(entry.freeTextPlaceholder || baseGroup.freeTextPlaceholder || ""),
          });
          return acc;
        }, [])
        : (linkedIds.length === 0
          ? []
          : linkedIds
            .map((id) => allGroups.find((g) => g.groupId === id))
            .filter((g): g is ModifierGroup => !!g));
      productGroups.sort((a, b) => a.sortOrder - b.sortOrder);
      if (productGroups.length === 0) {
        pushCartLineForProduct(p, [], "", 1);
        return;
      }
      setWizardProduct({ guide: p.CardGuide, name: p.ProductName || p.CardGuide, price: Number(p.Price ?? 0) });
      setWizardGroups(productGroups);
    } catch (e) {
      setMsg(briefNetworkHint(e));
      pushCartLineForProduct(p, [], "", 1);
    }
  }

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

  /** نقطة دخول موحدة من البحث/الأزرار: في وضع wizard يجب المرور أولاً على مجموعات السواء/الصوص/الاختيارات المرتبطة بالصنف. */
  async function beginAddProduct(p: Product) {
    if (!(await requireSeatFlowBeforeOrder())) return;
    if (captainItemSelectionMode === "wizard") {
      await handleProductClick(p);
      return;
    }
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

  function moveCartLineSeat(lineIdStr: string, seatNum: number) {
    if (billingLocked || orderTakingLocked) return;
    if (!Number.isFinite(seatNum) || seatNum < 1 || seatNum > SHARED_SEAT_NO) return;
    setCart((prev) => prev.map((l) => (l.id === lineIdStr ? { ...l, seatNo: seatNum, seatLabel: null } : l)));
  }

  async function moveServerOrderLineSeat(orderId: string, lineIdStr: string, seatNum: number) {
    if (billingLocked) {
      setMsg("بعد طلب الحساب لا يمكن إعادة توزيع البنود.");
      return;
    }
    if (!Number.isFinite(seatNum) || seatNum < 1 || seatNum > SHARED_SEAT_NO) return;
    const busyKey = `order:${orderId}:${lineIdStr}`;
    setReorderBusyKey(busyKey);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(lineIdStr)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatNo: seatNum }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg(`تم نقل البند إلى ${seatGuestDisplay(seatNum)}.`);
      void loadSessionOrders();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setReorderBusyKey("");
    }
  }

  async function applySeatMove(row: ReviewSeatMoveRow) {
    const target = Number(reorderSeatTargets[row.key] ?? row.seatNo ?? 0);
    if (!Number.isFinite(target) || target < 1 || target > SHARED_SEAT_NO) {
      setMsg("اختر المقعد الهدف أولًا.");
      return;
    }
    if (row.seatNo === target) {
      setMsg("المقعد الهدف هو نفسه المقعد الحالي.");
      return;
    }
    if (row.source === "cart") {
      moveCartLineSeat(row.lineId, target);
      setMsg(`تم نقل البند إلى ${seatGuestDisplay(target)} قبل الإرسال.`);
      return;
    }
    if (!row.orderId) return;
    await moveServerOrderLineSeat(row.orderId, row.lineId, target);
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
    if (isDeliveryEmbedded) {
      setLoading(true);
      try {
        const agentGuide = await ensureDeliveryCustomerSaved();
        const items = cart.map((l) => {
          const kn = String(l.kitchenNotes || "").trim();
          let nm = l.name;
          if (kn) nm += ` — ${kn.slice(0, 160)}`;
          return {
            productGuide: l.productGuide,
            menuItemId: l.productGuide,
            name: nm,
            quantity: l.qty,
            unitPrice: l.unitPrice,
            excludeServiceCharge: true,
          };
        });
        const body = {
          orderType: "delivery",
          agentGuide,
          paymentMethod: "cash",
          orderFinalized: false,
          postToSqlInvoice: true,
          items,
          subtotal: billingTotals.netPortion,
          discountValue,
          serviceCharge: 0,
          tax: deliveryNoVat ? 0 : vatValue,
          tipAmount: 0,
          total: deliveryNoVat ? billingTotals.netPortion + Math.max(0, deliveryShippingFee || 0) : total,
          delivery: {
            phone: deliveryPhone,
            name: deliveryName,
            address: deliveryAddress,
            shippingFee: deliveryShippingFee,
            shippingMode: deliveryShippingProductGuide ? "service_item" : deliveryShippingFee > 0 ? "service_item" : "fee",
            shippingProductGuide: deliveryShippingProductGuide || undefined,
            shippingProductName: deliveryShippingProductName || undefined,
            noVat: deliveryNoVat,
            deliveryTicketId: deliveryTicketId || undefined,
          },
          mat3amActor: buildMat3amActor(user),
        };
        const r = await safeFetch(`${base}/api/restaurant/invoices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          timeoutMs: 20000,
        });
        const t = await r.text();
        if (!r.ok) {
          const detail = String(t || "").trim();
          if (r.status === 0) throw new Error(briefNetworkHint("failed to fetch"));
          throw new Error(detail || `HTTP ${r.status}`);
        }
        setCart([]);
        setCouponCode("");
        setMsg("تم إرسال طلب الدليفري للمطبخ وتسجيل الفاتورة.");
        try {
          terminalLock.triggerLock("send");
        } catch {
          /* صامت */
        }
      } catch (e) {
        setMsg(`فشل الإرسال: ${briefNetworkHint(e)}`);
      } finally {
        setLoading(false);
      }
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
    if (sessionGuestApprovalPending) {
      setMsg("الجلسة حالياً ضيف مؤقت. يمكنك تجهيز السلة فقط، لكن لا يمكن إرسال الطلب قبل اعتماد أو رفض المدير.");
      return;
    }
    const accumulatedTotal = reviewTotal + total;
    if (sessionMaxInvoiceLimit != null && sessionMaxInvoiceLimit > 0 && accumulatedTotal > sessionMaxInvoiceLimit) {
      setMsg(`تجاوز الحد الأقصى للفاتورة (${sessionMaxInvoiceLimit.toFixed(2)}). يتطلب الأمر اعتماد مدير إضافي.`);
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
        // صافي قبل خصم المالك — الخصم يُطبَّق مرة واحدة عند طلب الحساب (تجنّب المضاعفة)
        subtotal: netAfterMinimum,
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
        timeoutMs: 15000,
      });
      const t = await r.text();
      if (!r.ok) {
        const detail = String(t || "").trim();
        if (r.status === 0) throw new Error(briefNetworkHint("failed to fetch"));
        throw new Error(detail || `HTTP ${r.status}`);
      }
      setCart([]);
      // نبقي كود الكوبون حتى طلب الحساب ليُخصم من إجمالي الفاتورة
      setMsg("تم إرسال الطلب للمطبخ (الفاتورة تُنشأ عند «طلب الحساب» فقط).");
      // لا ننتظر إعادة جلب الطلبات — تخفيف ثقل «جاري الإرسال» بعد رد الخادم
      void loadSessionOrders();
      // Shared Terminal: إقفال تلقائي بعد كل إرسال للمطبخ (إن كان الإعداد مفعَّلاً)
      try { terminalLock.triggerLock("send"); } catch { /* صامت */ }
    } catch (e) {
      setMsg(`فشل الإرسال: ${briefNetworkHint(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function openBillReview() {
    setMsg("");
    if (!activeSessionId) {
      setMsg("لا توجد جلسة نشطة.");
      return;
    }
    if (sessionGuestApprovalPending) {
      setMsg("الجلسة ضيف مؤقت بانتظار قرار المدير. لا يمكن طلب الحساب قبل اعتماد أو رفض المدير.");
      return;
    }
    if (mergedIntoSessionId) {
      const target = activeSessionsRef.current.find((row) => String(row.id || "") === mergedIntoSessionId);
      setMsg(
        `هذه الطاولة مدموجة مع ${target?.tableDisplayName || "الطاولة الرئيسية"}. اطلب الحساب النهائي من الطاولة الهدف فقط.`,
      );
      return;
    }
    if (sessionMaxInvoiceLimit != null && sessionMaxInvoiceLimit > 0 && reviewTotal > sessionMaxInvoiceLimit) {
      setMsg(`تجاوز الحد الأقصى للفاتورة (${sessionMaxInvoiceLimit.toFixed(2)}). يتطلب الأمر اعتماد مدير إضافي.`);
      return;
    }
    if (cart.some((line) => Number(line.qty || 0) > 0)) {
      setMsg("يوجد بنود في السلة لم تُرسل للمطبخ بعد.");
      return;
    }
    if (billingLocked) {
      setMsg("طُلِب الحساب مسبقاً — انتظر تسديد الكاشير.");
      return;
    }
    setBillReviewOpen(true);
  }

  async function requestBill(opts?: { autoPrint?: boolean }) {
    if (mergedIntoSessionId) {
      setMsg("طلب الحساب مغلق على الطاولة المصدر بعد الدمج. افتح الطاولة الهدف لطلب الحساب المشترك.");
      return;
    }
    if (sessionGuestApprovalPending) {
      setMsg("الجلسة ضيف مؤقت بانتظار قرار المدير. لا يمكن طلب الحساب قبل اعتماد أو رفض المدير.");
      return;
    }
    if (sessionMaxInvoiceLimit != null && sessionMaxInvoiceLimit > 0 && reviewTotal > sessionMaxInvoiceLimit) {
      setMsg(`تجاوز الحد الأقصى للفاتورة (${sessionMaxInvoiceLimit.toFixed(2)}). يتطلب الأمر اعتماد مدير إضافي.`);
      return;
    }
    const autoPrint = Boolean(opts?.autoPrint);
    setRequestBillBusy(true);
    try {
      let splitGroups: Array<{ id: string; name: string; seats: number[] }> = [];
      const selectedBillSeats = billSeatNos.filter((n) => n >= 1 && n <= 12);
      const wantSplit = splitBySeat || selectedBillSeats.length > 0;
      if (wantSplit) {
        const openOrders = sessionOrders.filter((o) => String(o.status || "").toLowerCase() !== "cancelled");
        const seatsWithItems = new Set<number>();
        for (const o of openOrders) {
          for (const it of o.items || []) {
            if (String((it as { finalInvoiceId?: string }).finalInvoiceId || "").trim()) continue;
            const sx = extractSeatFromOrderItem(it as { name?: string; seatNo?: number });
            if (sx != null) seatsWithItems.add(sx);
          }
        }
        const groupsBuild: typeof splitGroups = [];
        const seatLoop = selectedBillSeats.length > 0 ? selectedBillSeats : visibleSeatNumbers;
        for (const seatNo of seatLoop) {
          if (selectedBillSeats.length === 0 && !seatsWithItems.has(seatNo)) continue;
          const label = String(seatGuestLabels[seatNo] ?? "").trim() || String(seatNo);
          groupsBuild.push({ id: `check-${seatNo}`, name: label, seats: [seatNo] });
        }
        if (selectedBillSeats.length === 0) {
          const orphanSeats = [...seatsWithItems]
            .filter((i) => i !== SHARED_SEAT_NO && !visibleSeatNumbers.includes(i))
            .sort((a, b) => a - b);
          if (orphanSeats.length > 0) {
            groupsBuild.push({ id: "check-rest", name: "بدون تسمية مقعد / باقي الطاولة", seats: orphanSeats });
          }
        }
        splitGroups = groupsBuild;
      }
      const r = await fetch(`${base}/api/restaurant/sessions/request-bill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          splitBySeat: wantSplit,
          seatGroups: splitGroups,
          billSeatNos: selectedBillSeats.length > 0 ? selectedBillSeats : undefined,
          partialBill: selectedBillSeats.length > 0,
          pendingCartCount: cart.filter((line) => Number(line.qty || 0) > 0).length,
          tipAmount: Math.max(0, tipAmount || 0),
          agentGuid: selectedAgentGuid || undefined,
          billDate: billDate || undefined,
          couponCode: String(couponCode || "").trim() || undefined,
          mat3amActor: buildMat3amActor(user),
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{
        splitApplied?: boolean;
        partialBill?: boolean;
        sessionStillOpen?: boolean;
        billedSeats?: number[];
        invoiceId?: string;
        billNumber?: number;
        invoices?: Array<{
          invoiceId?: string;
          name?: string;
          total?: number;
          billNumber?: number;
          subtotal?: number;
          tax?: number;
          serviceCharge?: number;
          discount?: number;
          lines?: unknown;
        }>;
      }>(t) ?? {};
      if (!r.ok) throw new Error(t);
      const createdInvoices = Array.isArray(j.invoices) ? j.invoices : [];
      const firstInvoice = createdInvoices[0];
      const stillOpen = Boolean(j.sessionStillOpen || j.partialBill);
      if (stillOpen && Array.isArray(j.billedSeats) && j.billedSeats.length) {
        setMsg(
          `تم إصدار فاتورة للمقاعد ${j.billedSeats.join("، ")} — باقي الطاولة ما زال مفتوحاً للطلب/الحساب.`,
        );
      } else if (j.splitApplied && Array.isArray(j.invoices) && j.invoices.length > 1) {
        setMsg(
          autoPrint
            ? `تم طلب الحساب وتقسيمه إلى ${j.invoices.length} شيكات. فُتح أول شيك للطباعة المباشرة، وبقية الشيكات متاحة من قائمة الجلسة.`
            : `تم طلب الحساب وتقسيمه إلى ${j.invoices.length} شيكات حسب الكراسي.`,
        );
      } else {
        setMsg(autoPrint ? "تم طلب الحساب وفتح طباعة الشيك مباشرة." : "تم طلب الحساب — الفاتورة جاهزة عند الكاشير للتسديد.");
      }
      if (autoPrint && firstInvoice?.invoiceId) {
        const invoiceId = String(firstInvoice.invoiceId || "").trim();
        if (invoiceId) {
          setCaptainInitialInvoiceRow({
            sessionId: activeSessionId || undefined,
            invoiceId,
            total: Number(firstInvoice.total ?? total) || total,
            requestedAt: new Date().toISOString(),
            awaitingPayment: true,
            splitName: String(firstInvoice.name || "").trim() || null,
            billNumber: firstInvoice.billNumber != null ? Number(firstInvoice.billNumber) : j.billNumber,
            subtotal: Number(firstInvoice.subtotal ?? billingTotals.netPortion) || billingTotals.netPortion,
            tax: Number(firstInvoice.tax ?? vatValue) || vatValue,
            serviceCharge: Number(firstInvoice.serviceCharge ?? serviceCharge) || serviceCharge,
            discount: Number(firstInvoice.discount ?? discountValue) || discountValue,
            lines: Array.isArray(firstInvoice.lines) ? (firstInvoice.lines as CashierInvoiceRow["lines"]) : [],
            tableLabel: selectedTable?.name || selectedTableId,
            tableName: selectedTable?.name || null,
          });
          setCaptainInvoiceId(invoiceId);
          setCaptainInvoiceAutoPrint(true);
          setCaptainInvoiceOpen(true);
        }
      }
      setBillReviewOpen(false);
      setBillSeatNos([]);
      if (stillOpen) {
        setBillingRequestedAt(null);
      } else {
        setBillingRequestedAt(new Date().toISOString());
        setCouponCode("");
      }
      void loadSessionOrders();
      void loadSessionInvoices();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setRequestBillBusy(false);
    }
  }

  async function reviewPendingGuestRequest(action: "approve" | "reject") {
    if (!pendingGuestApprovalId) {
      setMsg("لم أجد طلب ضيف معلقاً لهذه الجلسة.");
      return;
    }
    let managerNote = "";
    if (action === "approve") {
      if (!window.confirm("اعتماد هذه الجلسة كضيف صالة الآن؟")) return;
    } else {
      const note = window.prompt("اكتب سبب رفض جلسة الضيف", "");
      if (note === null) return;
      if (!String(note).trim()) {
        setMsg("سبب رفض جلسة الضيف إلزامي.");
        return;
      }
      managerNote = String(note).trim();
    }
    setGuestDecisionBusy(true);
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/restaurant/manager-approvals/${encodeURIComponent(pendingGuestApprovalId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          decisionId: action === "approve" ? "approve_guest_session" : undefined,
          managerNote: managerNote || undefined,
          reviewedBy: {
            userId: user?.id != null ? String(user.id) : "",
            name: sessionDisplayName(user) || "مدير",
            role: user?.role || "manager",
          },
        }),
        timeoutMs: 15000,
      });
      const txt = await r.text();
      const js = tryParseJson<{ detail?: string }>(txt) ?? {};
      if (!r.ok) throw new Error(js.detail || txt || `HTTP ${r.status}`);
      setPendingGuestApprovalId(null);
      setMsg(action === "approve" ? "تم اعتماد جلسة الضيف." : "تم رفض جلسة الضيف وإعادتها إلى عميل نقدي.");
      await loadAll(true);
      await loadSessionOrders();
      await loadSessionInvoices();
    } catch (e) {
      setMsg(`تعذر حسم جلسة الضيف: ${briefNetworkHint(e)}`);
    } finally {
      setGuestDecisionBusy(false);
    }
  }

  async function transferTableTo(targetTableId: string) {
    setTransferTargetTableId(targetTableId);
    if (!targetTableId) return;
    if (targetTableId === selectedTableId) {
      setMsg("اختر طاولة مختلفة للتحويل.");
      return;
    }
    await transferTableByTarget(targetTableId);
  }

  async function transferTableByTarget(targetTableId: string) {
    setMsg("");
    if (!activeSessionId || !targetTableId) return;
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`تحويل الجلسة ضمن مسند الطاولة (${captainGate.name}) أو المدير.`);
      return;
    }
    if (targetTableId === selectedTableId) {
      setMsg("اختر طاولة مختلفة للتحويل.");
      return;
    }
    const targetSession = sessionByTableRef[tableRefKey(targetTableId)];
    const targetWasOccupied = Boolean(targetSession?.id);
    if (
      targetWasOccupied &&
      !window.confirm(
        "الطاولة الهدف مشغولة بالفعل.\n\nسيتم إغلاق جلسة الطاولة الحالية ونقل جميع طلباتها وضيوفها إلى حساب الطاولة الهدف. هل تريد المتابعة؟",
      )
    ) {
      return;
    }
    setSessionMoveBusy(true);
    try {
      const r = await safeFetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: targetTableId,
          confirmOccupiedTarget: targetWasOccupied,
          actor: "waiter",
          mat3amActor: buildMat3amActor(user),
        }),
        timeoutMs: 15000,
      });
      const t = await r.text();
      if (!r.ok) {
        const j = tryParseJson<{ detail?: unknown; message?: unknown }>(t);
        const detail =
          (typeof j?.detail === "string" && j.detail.trim()) ||
          (typeof j?.message === "string" && j.message.trim()) ||
          t ||
          `HTTP ${r.status}`;
        throw new Error(detail);
      }
      const parsed = tryParseJson<{ session?: { id?: string; tableId?: string } }>(t);
      const patchedSession = parsed?.session;
      const nextTableId = String(patchedSession?.tableId || targetTableId).trim() || targetTableId;
      if (patchedSession?.id) setActiveSessionId(String(patchedSession.id));
      setSelectedTableId(nextTableId);
      activeSessionsRef.current = [];
      setTransferTargetTableId("");
      setTransferPickQuery("");
      setTransferSearchResults(null);
      closeNavoptsDialog();
      setMsg(
        targetWasOccupied
          ? "تم ضم الطلبات والضيوف إلى الطاولة الهدف، وتحولت الطاولة المصدر إلى دورة التنظيف."
          : "تم تحويل الجلسة إلى الطاولة الجديدة، وتحولت الطاولة المصدر إلى دورة التنظيف.",
      );
      void loadSessionOrders();
      void loadAll(true);
    } catch (e) {
      const errMsg = e instanceof Error && e.message ? e.message : "";
      setMsg(errMsg || briefNetworkHint(e));
    } finally {
      setSessionMoveBusy(false);
    }
  }

  async function mergeIntoTableTo(targetTableId: string) {
    setMergeTargetTableId(targetTableId);
    if (!targetTableId) return;
    if (targetTableId === selectedTableId) {
      setMsg("اختر طاولة مختلفة للدمج.");
      return;
    }
    await mergeIntoTableTarget(targetTableId);
  }

  async function mergeIntoTableTarget(targetTableId: string) {
    setMsg("");
    if (!activeSessionId || !targetTableId) return;
    if (orderTakingLocked && captainGate?.name) {
      setMsg(`دمج الجلسات ضمن مسند الطاولة (${captainGate.name}) أو المدير.`);
      return;
    }
    if (targetTableId === selectedTableId) {
      setMsg("اختر طاولة مختلفة للدمج.");
      return;
    }
    if (mergedIntoSessionId || mergedSourceSessionIds.length > 0) {
      setMsg("هذه الطاولة ضمن دمج نشط. فك الدمج الحالي أولاً.");
      return;
    }
    const targetSession = sessionByTableRef[tableRefKey(targetTableId)];
    const targetWasOccupied = Boolean(targetSession?.id);
    if (
      targetWasOccupied &&
      !window.confirm(
        "تنبيه: الطاولة الهدف مشغولة ولها حساب وطلبات حالية.\n\nبعد الدمج سيشمل حساب الطاولة الهدف جميع طلباتها الحالية وجميع طلبات الطاولة المصدر، ولن يمكن طلب الحساب من الطاولة المصدر. هل أنت متأكد من تنفيذ الدمج؟",
      )
    ) {
      return;
    }
    setSessionMoveBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetTableId,
          confirmOccupiedTarget: targetWasOccupied,
          actor: "waiter",
          mat3amActor: buildMat3amActor(user),
        }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      const parsed = tryParseJson<{
        sourceSession?: { mergedIntoSessionId?: string; mergeId?: string };
        targetSession?: { id?: string };
      }>(t);
      const targetSessionId = String(parsed?.targetSession?.id || parsed?.sourceSession?.mergedIntoSessionId || "").trim();
      if (targetSessionId) setMergedIntoSessionId(targetSessionId);
      setMergedSourceSessionIds([]);
      setMergeTargetTableId("");
      setMergePickQuery("");
      setMergeSearchResults(null);
      closeNavoptsDialog();
      setMsg(
        targetWasOccupied
          ? "تم دمج الحسابين. يستمر الطلب من الطاولتين، ويُطلب الحساب النهائي من الطاولة الهدف فقط."
          : "تم تشغيل الطاولة الهدف ودمج الحساب معها. يستمر الطلب من الطاولتين، ويُطلب الحساب النهائي من الطاولة الهدف فقط.",
      );
      void loadSessionOrders();
      void loadAll(true);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSessionMoveBusy(false);
    }
  }

  async function loadUnmergePreview(sourceSessionId?: string) {
    if (!activeSessionId) return;
    setUnmergeBusy(true);
    setMsg("");
    try {
      const sourceId = String(sourceSessionId || mergedIntoSessionId || mergedSourceSessionIds[0] || "").trim();
      const query = sourceId && !mergedIntoSessionId ? `?sourceSessionId=${encodeURIComponent(sourceId)}` : "";
      const r = await safeFetch(
        `${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}/merge-preview${query}`,
        { timeoutMs: 12000 },
      );
      const text = await r.text();
      const j = tryParseJson<{
        sourceSession?: { id?: string };
        lines?: Array<{
          orderId?: string;
          lineId?: string;
          name?: string;
          quantity?: number;
          seatNo?: number | null;
          origin?: "source" | "target";
          tableId?: string;
        }>;
        detail?: string;
      }>(text) ?? {};
      if (!r.ok) throw new Error(j.detail || text);
      const lines = (Array.isArray(j.lines) ? j.lines : [])
        .map((line) => ({
          orderId: String(line.orderId || ""),
          lineId: String(line.lineId || ""),
          name: String(line.name || "صنف"),
          quantity: Number(line.quantity || 0),
          seatNo: line.seatNo,
          origin: line.origin === "target" ? "target" as const : "source" as const,
          tableId: String(line.tableId || ""),
        }))
        .filter((line) => line.orderId && line.lineId);
      setUnmergeSourceSessionId(String(j.sourceSession?.id || sourceId));
      setUnmergePreviewLines(lines);
      setUnmergeSeatTargets(
        Object.fromEntries(lines.map((line) => [`${line.orderId}:${line.lineId}`, Number(line.seatNo || 0)])),
      );
      setUnmergeSeatEnabled(
        Object.fromEntries(lines.map((line) => [`${line.orderId}:${line.lineId}`, true])),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUnmergeBusy(false);
    }
  }

  async function submitUnmerge() {
    if (!activeSessionId || !unmergeSourceSessionId) return;
    if (
      !window.confirm(
        "سيتم فك الحساب المشترك وإعادة كل طاولة إلى جلستها الأصلية مع تطبيق توزيع المقاعد الظاهر. هل تريد المتابعة؟",
      )
    ) {
      return;
    }
    setUnmergeBusy(true);
    setMsg("");
    try {
      const assignments = unmergePreviewLines
        .filter((line) => unmergeSeatEnabled[`${line.orderId}:${line.lineId}`] !== false)
        .map((line) => ({
          orderId: line.orderId,
          lineId: line.lineId,
          seatNo: unmergeSeatTargets[`${line.orderId}:${line.lineId}`] || null,
        }));
      const r = await safeFetch(
        `${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}/unmerge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceSessionId: unmergeSourceSessionId,
            assignments,
            actor: "waiter",
            mat3amActor: buildMat3amActor(user),
          }),
          timeoutMs: 15000,
        },
      );
      const text = await r.text();
      const j = tryParseJson<{ detail?: string }>(text) ?? {};
      if (!r.ok) throw new Error(j.detail || text);
      setUnmergePreviewLines([]);
      setUnmergeSourceSessionId("");
      setUnmergeSeatTargets({});
      setUnmergeSeatEnabled({});
      setMergedIntoSessionId("");
      setMergedSourceSessionIds((prev) => prev.filter((id) => id !== unmergeSourceSessionId));
      setMsg("تم فك الدمج وإعادة كل طاولة إلى جلستها الأصلية.");
      void loadSessionOrders();
      void loadAll(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUnmergeBusy(false);
    }
  }

  async function submitPartialMove() {
    if (!roleHasManagerOpsAccess(user?.role)) {
      setMsg("نقل الأصناف بين الطاولات متاح للمدير فقط.");
      return;
    }
    if (!activeSessionId || !partialMoveTargetTableId) {
      setMsg("اختر البنود والطاولة الهدف أولاً.");
      return;
    }
    const rows = reviewSeatMoveRows.filter(
      (row) => row.source === "order" && partialMoveSelected[row.key] && row.orderId,
    );
    if (!rows.length) {
      setMsg("اختر بنداً مرسلاً واحداً على الأقل للنقل.");
      return;
    }
    const targetWasOccupied = Boolean(sessionByTableRef[tableRefKey(partialMoveTargetTableId)]?.id);
    if (
      targetWasOccupied &&
      !window.confirm(
        "الطاولة الهدف مشغولة. ستُضاف البنود المحددة إلى جلستها وحسابها الحالي. هل تريد المتابعة؟",
      )
    ) {
      return;
    }
    setPartialMoveBusy(true);
    setMsg("");
    try {
      const r = await safeFetch(
        `${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}/move-items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetTableId: partialMoveTargetTableId,
            confirmOccupiedTarget: targetWasOccupied,
            guestCount: partialMoveIncludesGuest ? 1 : 0,
            items: rows.map((row) => ({
              orderId: row.orderId,
              lineId: row.lineId,
              quantity: row.qty,
              seatNo: partialMoveSeatTargets[row.key] || row.seatNo || 1,
            })),
            actor: "waiter",
            mat3amActor: buildMat3amActor(user),
          }),
          timeoutMs: 15000,
        },
      );
      const text = await r.text();
      const j = tryParseJson<{ detail?: string }>(text) ?? {};
      if (!r.ok) throw new Error(j.detail || text);
      setPartialMoveSelected({});
      setPartialMoveSeatTargets({});
      setPartialMoveIncludesGuest(false);
      setMsg(
        targetWasOccupied
          ? "تم نقل البنود المحددة وإضافتها إلى حساب الطاولة الهدف."
          : "تم تشغيل الطاولة الهدف ونقل البنود المحددة إليها.",
      );
      void loadSessionOrders();
      void loadAll(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPartialMoveBusy(false);
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
    setGuestSeatDialogOpen(true);
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
      setGuestSeatDialogOpen(false);
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

  function openCaptainInvoice(inv: CashierInvoiceRow) {
    const id = String(inv.invoiceId || "").trim();
    if (!id) return;
    closeNavoptsDialog();
    setCaptainInitialInvoiceRow(inv);
    setCaptainInvoiceId(id);
    setCaptainInvoiceAutoPrint(false);
    setCaptainInvoiceOpen(true);
  }

  const showBootstrapOverlay = loading && products.length === 0 && groups.length === 0;
  const useDesktopOrderWorkspace = !useCaptainMobileUi;
  const desktopTableLabel = isDeliveryEmbedded
    ? "توصيل"
    : selectedTable
      ? tableDisplayName(selectedTable)
      : selectedTableId || "بدون طاولة";
  const desktopSessionLabel = isDeliveryEmbedded
    ? deliveryName || deliveryPhone || "عميل توصيل"
    : activeSessionId
      ? `#${activeSessionId.slice(0, 8)}`
      : "لا توجد جلسة";
  const desktopBillingLabel = isDeliveryEmbedded
    ? deliveryNoVat
      ? "دليفري · بدون ضريبة"
      : "دليفري"
    : billingLocked
      ? "قيد طلب الحساب"
      : mergedIntoSessionId
        ? "الحساب من الطاولة الهدف"
        : mergedSourceSessionIds.length > 0
          ? "الحساب المشترك هنا"
          : "جلسة مفتوحة";
  const operationalSidebarContent = useMemo(
    () => (
      <div className="app-shell__op-section">
        <div className="app-shell__op-heading">عمليات الجلسة الحالية</div>
        <button
          type="button"
          className="app-shell__op-link app-shell__op-link--primary"
          onClick={() => {
            void openMinimumChargeFlow();
          }}
          disabled={!selectedTableId || selectedTableBlocked || billingLocked || sessionBusy}
        >
          <span className="app-shell__op-link-label">منيموم شارج</span>
          {effectiveMinimumChargePerSeat > 0 ? (
            <span className="app-shell__op-link-meta">
              {effectiveMinimumChargePerSeat.toFixed(0)} ج.م / {activeGuestSeatCount} ضيف
            </span>
          ) : null}
        </button>
        {minimumChargeFlowOpen ? (
          <div className="app-shell__op-flow">
            {minimumChargeFlowStep === "count" ? (
              <>
                <div className="app-shell__op-flow-title">أدخل عدد الضيوف</div>
                <div className="app-shell__op-editor">
                  <input
                    type="number"
                    min={1}
                    max={SEAT_SLOT_COUNT}
                    value={guestCountDraft}
                    onChange={(e) => setGuestCountDraft(e.target.value)}
                    disabled={billingLocked || sessionBusy}
                  />
                  <button
                    type="button"
                    className="app-shell__op-cta"
                    disabled={billingLocked || sessionBusy}
                    onClick={() => void confirmMinimumChargeFlow()}
                    aria-label="اعتماد عدد الضيوف"
                  >
                    {sessionBusy ? "..." : "✓"}
                  </button>
                </div>
                <div className="app-shell__op-flow-note">
                  عند اعتماد العدد سيتم إنشاء المقاعد تلقائيًا من 1 إلى {clampSeatGuestCount(guestCountDraft || activeGuestSeatCount, activeGuestSeatCount)}.
                </div>
              </>
            ) : (
              <>
                <div className="app-shell__op-flow-title">هل ترغب في تسمية الضيوف؟</div>
                <div className="app-shell__op-flow-note">
                  اختر <strong>نعم</strong> لفتح المقاعد بالعدد المعتمد مع مقعد 13 المشترك، ثم اكتب اسم كل ضيف على مقعده.
                </div>
                <div className="app-shell__op-flow-actions">
                  <button type="button" className="app-shell__op-cta" onClick={() => void answerMinimumChargeNaming(true)}>
                    نعم
                  </button>
                  <button type="button" className="app-shell__op-link app-shell__op-link--ghost" onClick={() => void answerMinimumChargeNaming(false)}>
                    لا
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        <div className="app-shell__op-subhead">عمليات الطاولة</div>
        <div className="app-shell__op-grid">
          <button
            type="button"
            className="app-shell__op-link app-shell__op-link--soft-red"
            onClick={() => openNavoptsDialog("returns")}
            disabled={!activeSessionId || returnableLines.length === 0}
          >
            مرتجع
          </button>
          <button
            type="button"
            className="app-shell__op-link app-shell__op-link--soft-blue"
            onClick={() => openNavoptsDialog("transfer")}
            disabled={!activeSessionId || sessionMoveBusy}
          >
            تحويل
          </button>
          <button
            type="button"
            className="app-shell__op-link app-shell__op-link--soft-violet"
            onClick={() => openNavoptsDialog("merge")}
            disabled={!activeSessionId || sessionMoveBusy}
          >
            دمج
          </button>
          <button
            type="button"
            className="app-shell__op-link app-shell__op-link--soft-teal"
            onClick={() => openNavoptsDialog("reorder")}
          >
            نقل
          </button>
          <button
            type="button"
            className="app-shell__op-link app-shell__op-link--soft-amber"
            onClick={() => openNavoptsDialog("invoices")}
          >
            شيكات
          </button>
        </div>
      </div>
    ),
    [
      activeGuestSeatCount,
      activeSessionId,
      billingLocked,
      confirmMinimumChargeFlow,
      effectiveMinimumChargePerSeat,
      minimumChargeFlowOpen,
      minimumChargeFlowStep,
      guestCountDraft,
      openMinimumChargeFlow,
      answerMinimumChargeNaming,
      returnableLines.length,
      selectedTableBlocked,
      selectedTableId,
      sessionBusy,
      sessionMoveBusy,
    ],
  );

  useEffect(() => {
    if (!appMenu?.setAsideSupplement) return;
    if (!useDesktopOrderWorkspace || isDeliveryEmbedded) {
      appMenu.setAsideSupplement(null);
      return;
    }
    appMenu.setAsideSupplement(operationalSidebarContent);
    return () => appMenu.setAsideSupplement(null);
  }, [appMenu, operationalSidebarContent, useDesktopOrderWorkspace, isDeliveryEmbedded]);

  return (
    <div
      className={`role-op waiter-pos waiter-pos--order-taker${narrowOtViewport && assignmentMode === "per_seat" ? " waiter-pos--ot-rail-guests" : ""}${useCaptainMobileUi ? " waiter-pos--ot-ui-captain" : ""
        }${showCaptainGuestDock ? " waiter-pos--captain-guest-dock-on" : ""}${isDeliveryEmbedded ? " waiter-pos--delivery" : ""}`}
      {...(useCaptainMobileUi ? { "data-ot-captain-tab": captainTab } : {})}
    >
      {showBootstrapOverlay ? (
        <div className="waiter-pos__bootstrap-overlay">
          <div className="waiter-pos__bootstrap-spinner" />
          <div className="waiter-pos__bootstrap-label">جاري تحميل بيانات الطلب…</div>
        </div>
      ) : null}

      {isDeliveryEmbedded ? (
        <div className="dop-customer-search" style={{ margin: "0.5rem 0.65rem 0.35rem" }}>
          <div className="dop-customer-search__bar">
            <span className="dop-customer-search__icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
                <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="dop-customer-search__input"
              value={deliverySearchQ}
              onChange={(e) => setDeliverySearchQ(e.target.value)}
              placeholder="بحث عميل التوصيل: الاسم · الهاتف · العنوان"
              autoFocus
              aria-label="بحث عملاء التوصيل"
            />
            {deliverySearching ? <span className="dop-customer-search__busy">بحث…</span> : null}
          </div>
          {deliveryHits.length > 0 ? (
            <ul className="dop-customer-search__hits">
              {deliveryHits.map((a) => (
                <li key={a.CardGuide}>
                  <button type="button" onClick={() => pickDeliveryAgent(a)}>
                    <strong>{a.AgentName}</strong>
                    <span>
                      {a.Phone || a.Mobile || "—"} · {(a.FullAdress || a.Address || "").slice(0, 70)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
              gap: "0.4rem",
              marginTop: "0.55rem",
            }}
          >
            <input value={deliveryName} onChange={(e) => setDeliveryName(e.target.value)} placeholder="الاسم *" />
            <input value={deliveryPhone} onChange={(e) => setDeliveryPhone(e.target.value)} placeholder="الهاتف *" inputMode="tel" />
            <input
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="العنوان"
              style={{ gridColumn: "span 2" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 700 }}>
              <input type="checkbox" checked={deliveryNoVat} onChange={(e) => setDeliveryNoVat(e.target.checked)} />
              بدون ضريبة
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={deliveryShippingFee}
              onChange={(e) => setDeliveryShippingFee(Number(e.target.value) || 0)}
              placeholder="مصروف الشحن"
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className={`waiter-pos__btn${deliveryCatalogTab === "menu" ? " waiter-pos__btn--primary" : ""}`}
              onClick={() => setDeliveryCatalogTab("menu")}
            >
              الأصناف
            </button>
            <button
              type="button"
              className={`waiter-pos__btn${deliveryCatalogTab === "favorites" ? " waiter-pos__btn--primary" : ""}`}
              onClick={() => setDeliveryCatalogTab("favorites")}
            >
              الأصناف المحببة
            </button>
            <button
              type="button"
              className="waiter-pos__btn"
              onClick={() => void ensureDeliveryCustomerSaved().then(() => setMsg("تم حفظ العميل")).catch((e) => setMsg(String(e)))}
            >
              حفظ العميل
            </button>
          </div>
          {deliveryCatalogTab === "favorites" ? (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 120, overflow: "auto" }}>
              {!selectedAgentGuid ? (
                <span className="dop-customer-search__hint">اختر عميلاً أولاً</span>
              ) : deliveryFavorites.length === 0 ? (
                <span className="dop-customer-search__hint">{deliveryFavHint || "لا محببات بعد"}</span>
              ) : (
                deliveryFavorites.map((f) => (
                  <button
                    key={f.CardGuide}
                    type="button"
                    className="waiter-pos__btn"
                    style={{ fontSize: "0.78rem" }}
                    onClick={() =>
                      pushCartLineForProduct(
                        {
                          CardGuide: f.CardGuide,
                          ProductName: f.ProductName,
                          Price: Number(f.Price) || 0,
                        } as Product,
                        [],
                        "",
                        1,
                      )
                    }
                  >
                    {f.ProductName}
                    {f.invoiceCount ? ` ·×${f.invoiceCount}` : ""}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <OperationalRoleHeader
        roleTitle={pageTitle?.trim() ? pageTitle : "SIR RESTO"}
        backTo={orderTakerExitPath}
        hideUser
        titleSub={
          <span className="waiter-pos__title-subtle">
            {isDeliveryEmbedded ? "مطاعم XTRA · جرسون التوصيل (بدون طاولات)" : "مطاعم XTRA · شاشة الطلب الحالية للجرسون"}
          </span>
        }
        titleStyle={{
          fontSize: "1.02rem",
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "0.02em",
          color: "#f8fafc",
          whiteSpace: "nowrap",
        }}
        rightSlot={
          <div className="waiter-pos__hdr-shell">
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
            <div className="waiter-pos__hdr-status">
              <span className="waiter-pos__hdr-status-chip">{desktopTableLabel}</span>
              <span className="waiter-pos__hdr-status-chip">{desktopSessionLabel}</span>
              {!isDeliveryEmbedded && sessionMaxInvoiceLimit != null && sessionMaxInvoiceLimit > 0 ? (
                <span className="waiter-pos__hdr-status-chip" style={{ color: "#fbbf24", fontWeight: 800 }}>
                  حد: {sessionMaxInvoiceLimit.toFixed(2)}
                </span>
              ) : null}
              <span className="waiter-pos__hdr-status-chip">{desktopBillingLabel}</span>
            </div>
            {!isDeliveryEmbedded ? (
            <div className="waiter-pos__hdr-primary-actions">
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-action-btn waiter-pos__hdr-action-btn--report" onClick={() => setShowSummary((prev) => !prev)}>
                {showSummary ? "إخفاء التقرير" : "تقرير الطاولة"}
              </button>
              <button type="button" className="waiter-pos__btn waiter-pos__hdr-action-btn waiter-pos__hdr-action-btn--cashier" disabled={summonBusy || !activeSessionId} onClick={() => void summonCashier()}>
                {summonBusy ? "…" : "استدعاء كاشير"}
              </button>
              <button
                type="button"
                className="waiter-pos__btn waiter-pos__hdr-action-btn waiter-pos__hdr-action-btn--bill"
                disabled={requestBillBusy || !activeSessionId || billingLocked || sessionGuestApprovalPending || Boolean(mergedIntoSessionId)}
                onClick={openBillReview}
              >
                {requestBillBusy ? "…" : mergedIntoSessionId ? "الحساب من الهدف" : "طلب الحساب"}
              </button>
            </div>
            ) : null}
            <div className="waiter-pos__hdr-fields">
              <select
                className="waiter-pos__select"
                value={selectedAgentGuid}
                onChange={(e) => setSelectedAgentGuid(e.target.value)}
                aria-label="اسم العميل"
                disabled={billingLocked || sessionGuestApprovalPending || customerTypeLocked}
                style={{ width: "100%", fontSize: "0.78rem", fontWeight: 700, padding: "0.32rem 0.45rem", textAlign: "right", height: 34 }}
              >
                {agents.length === 0 ? (
                  <option value="">اسم العميل</option>
                ) : (
                  agents
                    .filter((a) => {
                      const n = String(a?.AgentName || "").toLowerCase();
                      const isGuest = n.includes("guest") || n.includes("ضيف");
                      // نخفي عملاء الضيوف من القائمة المنسدلة إلا إذا كان العميل محدد بالفعل (ليظهر الاسم)
                      return !isGuest || selectedAgentGuid === a.CardGuide;
                    })
                    .map((a) => (
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
                style={{ width: "100%", fontSize: "0.78rem", fontWeight: 700, padding: "0.32rem 0.45rem", borderRadius: 8, border: "1px solid #1e40af", background: "#fff", color: "#0f172a", height: 34 }}
              />
              {!isDeliveryEmbedded ? (
              <select
                className="waiter-pos__select"
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                aria-label="اختيار الطاولة"
                style={{ width: "100%", maxWidth: "100%", fontSize: "0.9rem", fontWeight: 800, padding: "0.35rem 0.55rem", textAlign: "center", flexShrink: 0, height: 34 }}
              >
                {tables.length === 0 ? (
                  <option value="" disabled>لا توجد طاولات — تحقق من TBL005 أو مزامنة المخطط</option>
                ) : (
                  tables.map((t) => (
                    <option key={t.id} value={t.id} disabled={["dirty", "cleaning"].includes(normalizeTableStatus(String((t as any).status || "")))}>
                      {tableDisplayName(t)}{["dirty", "cleaning"].includes(normalizeTableStatus(String((t as any).status || ""))) ? " (غير جاهزة)" : ""}
                    </option>
                  ))
                )}
              </select>
              ) : (
                <span className="waiter-pos__hdr-status-chip" style={{ height: 34, display: "grid", placeItems: "center" }}>
                  بدون طاولة — توصيل
                </span>
              )}
              <input
                className="waiter-pos__coupon waiter-pos__hdr-coupon"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="كود الكوبون"
                title="كود ترويجي (مثل WELCOME10) — يُخصم من إجمالي الفاتورة عند طلب الحساب"
                disabled={billingLocked}
              />
            </div>
            <div className="waiter-pos__hdr-close-wrap">
              <button
                type="button"
                className="waiter-pos__close"
                onClick={() => navigate(orderTakerExitPath)}
                aria-label="إغلاق"
                style={{ background: "#dc2626", color: "#fff", border: "1px solid #b91c1c", height: 36, width: 36, fontSize: "1.2rem", borderRadius: 10 }}
              >
                ×
              </button>
            </div>
          </div>
        }
      />

      {unauthorizedAccessTable ? (
        <div
          role="alert"
          style={{
            margin: "0 1rem 0.5rem",
            padding: "10px 14px",
            borderRadius: 12,
            background: "rgba(127, 29, 29, 0.15)",
            border: "1px solid rgba(185, 28, 28, 0.5)",
            color: "#991b1b",
            fontWeight: 800,
            fontSize: "0.92rem",
            lineHeight: 1.5,
            textAlign: "right",
          }}
        >
          <strong>
            ⚠️ {unauthorizedAccessKind === "assignment"
              ? `هذه الطاولة (${unauthorizedAccessTable}) ليست ضمن الطاولات المخصصة لك.`
              : `هذه الطاولة (${unauthorizedAccessTable}) تخص كابتن آخر.`}
          </strong>
          <br />
          {unauthorizedAccessKind === "assignment"
            ? "تم توجيهك إلى أول طاولة مسموح بها لك في هذه الفترة. راجع المدير إذا احتجت تعديل التوزيع."
            : "تم توجيهك لطاولتك المسجلة. لا يمكنك الوصول لهذه الطاولة — تواصل مع الكابتن أو المدير لتحويل الجلسة."}
        </div>
      ) : orderTakingLocked && captainGate?.name ? (
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
        <div
          className="card waiter-pos__summary-panel"
          style={{ margin: "0.75rem 1rem", padding: "1rem 1.1rem", maxHeight: "85vh", overflowY: "auto", overflowX: "hidden" }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", borderBottom: "1px solid #e2e8f0", paddingBottom: 10 }}>
            <div style={{ fontWeight: 900, fontSize: "1.1rem" }}>
              {selectedTable?.name ?? "طاولة"} — ملخص الجلسة
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ fontSize: "0.78rem" }} onClick={() => window.print()}>
                🖨️ طباعة
              </button>
              <button type="button" className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={() => setShowSummary(false)}>
                إغلاق
              </button>
            </div>
          </div>

          {/* Session Meta */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12 }}>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f1f5f9" }}>
              <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>الكابتن</div>
              <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a" }}>{captainGate?.name || "—"}</div>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f1f5f9" }}>
              <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>بدأت الجلسة</div>
              <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a" }}>
                {(() => {
                  const st = findCachedActiveSession(activeSessionId)?.startTime;
                  if (!st) return "—";
                  const d = new Date(st);
                  return Number.isNaN(d.getTime()) ? st : d.toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
                })()}
              </div>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f1f5f9" }}>
              <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>الضيوف ({activeGuestSeatCount})</div>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0f172a", lineHeight: 1.4 }}>
                {Array.from({ length: activeGuestSeatCount }, (_, i) => i + 1)
                  .map((n) => seatGuestLabels[n] || String(n))
                  .join(" · ")}
              </div>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f1f5f9" }}>
              <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>مينيموم شارج</div>
              <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a" }}>
                {effectiveMinimumChargePerSeat > 0 ? `${effectiveMinimumChargePerSeat.toFixed(0)} ج.م/ضيف = ${effectiveTableMinimum.toFixed(0)} ج.م` : "غير مفعّل"}
              </div>
            </div>
          </div>

          {/* Orders Status Grid */}
          {(() => {
            const all = sessionOrders.length;
            const cancelled = sessionOrders.filter((o) => String(o.status || "").toLowerCase() === "cancelled").length;
            const inKitchen = sessionKitchenStats.pending + sessionKitchenStats.preparing + sessionKitchenStats.ready;
            const delivered = sessionOrders.filter((o) => ["served", "paid"].includes(String(o.status || "").toLowerCase())).length;
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginTop: 12 }}>
                <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#1e40af" }}>{all}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#3b82f6" }}>إجمالي الطلبات</div>
                </div>
                <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#92400e" }}>{inKitchen}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b45309" }}>في المطبخ</div>
                  <div style={{ fontSize: "0.65rem", color: "#78716c" }}>انتظار {sessionKitchenStats.pending} · تحضير {sessionKitchenStats.preparing} · جاهز {sessionKitchenStats.ready}</div>
                </div>
                <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #86efac" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#15803d" }}>{delivered}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#16a34a" }}>واصل للطاولة</div>
                </div>
                <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#991b1b" }}>{cancelled}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#dc2626" }}>ملغى</div>
                </div>
                <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#f5f3ff", border: "1px solid #ddd6fe" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#5b21b6" }}>{sessionInvoices.length}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#7c3aed" }}>شيكات</div>
                </div>
                <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fdba74" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#9a3412" }}>{returnableLines.length}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#c2410c" }}>مرتجعات</div>
                </div>
              </div>
            );
          })()}

          {/* Financial Summary */}
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 8, color: "#0f172a" }}>التكلفة</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, fontSize: "0.86rem" }}>
              <div><span style={{ color: "#64748b" }}>السلة:</span> <strong>{sessionSummarySubtotal.toFixed(2)} ج.م</strong></div>
              <div><span style={{ color: "#64748b" }}>الخدمة ({policy.servicePercent}%):</span> <strong>{sessionSummaryService.toFixed(2)}</strong></div>
              <div><span style={{ color: "#64748b" }}>VAT ({policy.vatPercent}%):</span> <strong>{sessionSummaryVat.toFixed(2)}</strong></div>
              <div><span style={{ color: "#64748b" }}>بقشيش:</span> <strong>{(tipAmount || 0).toFixed(2)}</strong></div>
              {sessionSummaryMinimumGap > 0 ? (
                <div><span style={{ color: "#92400e" }}>فرق المينيموم:</span> <strong style={{ color: "#92400e" }}>{sessionSummaryMinimumGap.toFixed(2)}</strong></div>
              ) : null}
              {billingTotals.ownerTpl ? (
                <div><span style={{ color: "#b45309" }}>سياسة مالك/VIP:</span> <strong style={{ color: "#b45309" }}>{String(sessionBillingProfile?.vipOwnerLabel || "").trim() || "نشطة"}</strong></div>
              ) : null}
              {billingTotals.ownerDiscountPct > 0 ? (
                <div><span style={{ color: "#b45309" }}>خصم مالك:</span> <strong style={{ color: "#b45309" }}>{billingTotals.ownerDiscountPct}%</strong></div>
              ) : null}
              <div><span style={{ color: "#0f172a" }}>الإجمالي:</span> <strong style={{ fontSize: "1rem", color: "#059669" }}>{sessionSummaryTotal.toFixed(2)} ج.م</strong></div>
            </div>
          </div>

          {/* Alerts */}
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {billingLocked ? (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fee2e2", color: "#991b1b", fontSize: "0.82rem", fontWeight: 800 }}>
                ⚠️ طلب حساب معلق — لا يمكن إضافة أصناف جديدة
              </div>
            ) : null}
            {orderTakingLocked ? (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef3c7", color: "#92400e", fontSize: "0.82rem", fontWeight: 800 }}>
                🔒 الطلب مقفل — مسند لكابتن آخر
              </div>
            ) : null}
            {sessionGuestApprovalPending ? (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef3c7", color: "#92400e", fontSize: "0.82rem", fontWeight: 800 }}>
                ⏳ الجلسة الآن `ضيف مؤقت` بانتظار قرار المدير. يمكنك تجهيز السلة فقط، لكن لا يمكن إرسال الطلب أو طلب الحساب الآن.
              </div>
            ) : null}
            {customerTypeLocked && !sessionGuestApprovalPending ? (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#e0f2fe", color: "#075985", fontSize: "0.82rem", fontWeight: 800 }}>
                🔐 نوع العميل مقفول لهذه الجلسة بعد أول طلب: {sessionCustomerType === "guest" ? "ضيف صالة" : sessionCustomerType === "vip_owner" ? "Owner / VIP" : "عميل نقدي"}
              </div>
            ) : null}
            {canManagerResolveGuest ? (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void reviewPendingGuestRequest("approve")}
                  disabled={guestDecisionBusy || !pendingGuestApprovalId}
                >
                  {guestDecisionBusy ? "…" : "اعتماد الضيف"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void reviewPendingGuestRequest("reject")}
                  disabled={guestDecisionBusy || !pendingGuestApprovalId}
                  style={{ borderColor: "rgba(220,38,38,0.35)", color: "#991b1b" }}
                >
                  {guestDecisionBusy ? "…" : "رفض الضيف"}
                </button>
              </div>
            ) : null}
            {!sessionGuestApprovalPending && sessionCustomerType !== "guest" ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void requestGuestSessionApproval()}
                  disabled={billingLocked || sessionBusy || customerTypeLocked || orderTakingLocked}
                  style={{
                    borderColor: "rgba(245,158,11,0.45)",
                    background: "rgba(245,158,11,0.1)",
                    color: "#92400e",
                    fontWeight: 900,
                  }}
                >
                  تعيين ضيف مؤقت
                </button>
              </div>
            ) : null}
            {sessionKitchenStats.ready > 0 ? (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#dcfce7", color: "#14532d", fontSize: "0.82rem", fontWeight: 800 }}>
                ✅ {sessionKitchenStats.ready} طلب/أصناف جاهزة بالمطبخ — استدعِ الرنر
              </div>
            ) : null}
            {billingTotals.costPricingNote ? (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#e0e7ff", color: "#3730a3", fontSize: "0.82rem", fontWeight: 700 }}>
                📋 تسعير تكلفة + هامش مفعّل على الأصناف الجديدة
              </div>
            ) : null}
            {msg ? (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#e0f2fe", color: "#075985", fontSize: "0.82rem", fontWeight: 700 }}>
                ℹ️ {msg}
              </div>
            ) : null}
          </div>

          {/* Recent Orders */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 8, fontSize: "0.9rem", color: "#0f172a" }}>الطلبات المرسلة</div>
            {sessionOrders.filter((o) => String(o.status || "").toLowerCase() !== "cancelled").length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>لا توجد طلبات مرسلة بعد.</div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: 10,
                }}
              >
                {sessionOrders
                  .filter((o) => String(o.status || "").toLowerCase() !== "cancelled")
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
                          border: "1px solid #dbeafe",
                          borderRadius: 12,
                          padding: "10px 12px",
                          background: "#f8fbff",
                        }}
                      >
                        <div style={{ fontSize: "0.82rem", fontWeight: 800, marginBottom: 6, color: "#0f172a", display: "flex", justifyContent: "space-between", gap: 6 }}>
                          <span>طلب #{o.id.slice(0, 8)} · {orderStatusLabelAr(st)} {o.generalOrder ? "· عام" : ""}</span>
                          {canCancel ? (
                            <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ fontSize: "0.7rem", padding: "2px 6px" }} onClick={() => void cancelServerOrder(o.id)}>إلغاء</button>
                          ) : null}
                        </div>
                        <ul style={{ margin: 0, paddingInlineStart: 16, fontSize: "0.84rem", color: "#334155", lineHeight: 1.5 }}>
                          {lines.length ? lines.map((ln, idx) => <li key={`${o.id}-${idx}`}>{ln}</li>) : <li>بدون بنود</li>}
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
          {useDesktopOrderWorkspace ? (
            <div className="waiter-pos__workspace">
              <section className="waiter-pos__menu-column">
                <div className="waiter-pos__seat-pills-bar waiter-pos__workspace-block">
                  {activeSessionId && desktopSeatPills.length > 0 ? (
                    <>
                      <div className="waiter-pos__seat-pills-bar__head">
                        <span>المقعد الحالي للتسجيل</span>
                        <button type="button" className="waiter-pos__seat-pills-bar__launch" onClick={() => void openMinimumChargeFlow()}>
                          تعديل العدد
                        </button>
                      </div>
                      <div className="waiter-pos__seat-pills">
                        {desktopSeatPills.map((n) => {
                          const stats = seatCartStats.get(n);
                          const active = selectedSeat === n;
                          const shared = n === SHARED_SEAT_NO;
                          return (
                            <button
                              key={`desk-seat-pill-${n}`}
                              type="button"
                              className={`waiter-pos__seat-pill${active ? " waiter-pos__seat-pill--active" : ""}${shared ? " waiter-pos__seat-pill--shared" : ""}`}
                              onClick={() => {
                                setAssignmentMode("per_seat");
                                setSelectedSeat(n);
                              }}
                              title={seatGuestDisplay(n)}
                            >
                              <span className="waiter-pos__seat-pill__label">{truncateRailGuestLabel(seatGuestDisplay(n))}</span>
                              {stats?.qty ? <span className="waiter-pos__seat-pill__meta">{stats.qty}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <button type="button" className="waiter-pos__seat-pills-bar__prompt" onClick={() => void openMinimumChargeFlow()}>
                      ابدأ من زر منيموم شارج ثم حدّد عدد الأفراد لتظهر المقاعد هنا
                    </button>
                  )}
                </div>
                <div className="waiter-pos__workspace-block" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 700 }}>عرض:</span>
                    <button type="button" className={`waiter-pos__mini-toggle ${displayMode === "group" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => { setDisplayMode("group"); setCategoryKey("all"); }}>مجموعة</button>
                    <button type="button" className={`waiter-pos__mini-toggle ${displayMode === "category" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => { setDisplayMode("category"); setCategoryKey("all"); }}>تصنيف</button>
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 700 }}>ترتيب:</span>
                    <button type="button" className={`waiter-pos__mini-toggle ${sortMode === "default" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => setSortMode("default")}>افتراضي</button>
                    <button type="button" className={`waiter-pos__mini-toggle ${sortMode === "name" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => setSortMode("name")}>الاسم</button>
                    <button type="button" className={`waiter-pos__mini-toggle ${sortMode === "price" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => setSortMode("price")}>السعر</button>
                  </div>
                </div>
                <div
                  id="waiter-ot-sec-categories"
                  className="waiter-pos__cat-strip waiter-pos__workspace-block"
                  style={{
                    width: "100%",
                    minHeight: 52,
                    maxHeight: 120,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    padding: "6px 0",
                  }}
                >
                  {loading && groups.length === 0 ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", overflow: "hidden", paddingBottom: 4 }}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span key={`skel-${i}`} className="waiter-pos__cat" style={{ flexShrink: 0, width: 72, height: 32, background: "#e2e8f0", borderColor: "transparent", color: "transparent", cursor: "default" }}>
                          &nbsp;
                        </span>
                      ))}
                    </div>
                  ) : displayMode === "category" && categoryKey !== "all" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", overflow: "hidden", paddingBottom: 4 }}>
                      <button
                        type="button"
                        className="waiter-pos__cat"
                        onClick={() => { setCategoryKey("all"); setSubGroupKey("all"); }}
                        title="رجوع للتصنيفات"
                        style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                      >
                        🔙 رجوع
                      </button>
                      {groupsInSelectedCategory.map((g) => (
                        <button
                          key={`sub-${g.CardGuide}`}
                          type="button"
                          className={`waiter-pos__cat ${subGroupKey === g.CardGuide ? "waiter-pos__cat--active" : ""}`}
                          style={{ background: "#dbeafe", borderColor: "#3b82f6", color: "#1e40af", flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                          onClick={() => setSubGroupKey(subGroupKey === g.CardGuide ? "all" : g.CardGuide)}
                          title={g.GroupName}
                        >
                          {g.GroupName}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", overflow: "hidden", paddingBottom: 4 }}>
                      <button
                        type="button"
                        className={`waiter-pos__cat ${categoryKey === "all" ? "waiter-pos__cat--active" : ""}`}
                        onClick={() => setCategoryKey("all")}
                        title={displayMode === "category" ? "كل التصنيفات" : "كل المجموعات"}
                        style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                      >
                        {displayMode === "category" ? "كل التصنيفات" : "كل المجموعات"}
                      </button>
                      {displayMode === "category"
                        ? displayCategories.map((cat) => (
                          <button
                            key={`cat-${cat}`}
                            type="button"
                            className={`waiter-pos__cat ${categoryKey === cat ? "waiter-pos__cat--active" : ""}`}
                            onClick={() => setCategoryKey(cat)}
                            title={cat}
                            style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                          >
                            {cat}
                          </button>
                        ))
                        : waiterMenuGroups.map((g) => (
                          <button
                            key={`side-${g.CardGuide}`}
                            type="button"
                            className={`waiter-pos__cat ${categoryKey === g.CardGuide ? "waiter-pos__cat--active" : ""}`}
                            onClick={() => setCategoryKey(g.CardGuide)}
                            title={g.GroupName}
                            style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                          >
                            {g.GroupName}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                {!wizardProduct ? (
                  <div id="waiter-ot-sec-search" className="waiter-pos__search-wrap waiter-pos__ot-scroll-target waiter-pos__workspace-block" style={{ marginBottom: "0.5rem" }}>
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
                ) : null}

                {wizardProduct ? (
                  <div
                    id="waiter-ot-sec-grid"
                    className="waiter-pos__workspace-block"
                    style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
                  >
                    <ModifierWizard
                      baseProduct={wizardProduct}
                      groups={wizardGroups}
                      onResult={(result) => {
                        const selectionNames: string[] = [];
                        const kitchenNotesParts: string[] = [];
                        const cartModifiers: CartModifier[] = [];
                        let totalPriceDelta = 0;
                        for (const sel of result.selections) {
                          const g = wizardGroups.find((x) => x.groupId === sel.groupId);
                          if (!g) continue;
                          for (const itemId of sel.selectedItemIds) {
                            const it = g.items.find((x) => x.itemId === itemId);
                            if (!it) continue;
                            totalPriceDelta += it.priceDelta;
                            cartModifiers.push({ groupId: g.groupId, groupName: g.nameAr, itemName: it.nameAr, priceDelta: it.priceDelta });
                            if (g.type === "exclusion") {
                              kitchenNotesParts.push(`بدون ${it.nameAr}`);
                            } else if (g.type === "kitchen_note") {
                              kitchenNotesParts.push(it.nameAr);
                            } else {
                              selectionNames.push(it.nameAr);
                            }
                          }
                          const freeText = String(sel.note || "").trim();
                          if (freeText) {
                            cartModifiers.push({ groupId: g.groupId, groupName: g.nameAr, itemName: freeText, priceDelta: 0, source: "free_text" });
                            if (g.type === "kitchen_note" || g.type === "exclusion") {
                              kitchenNotesParts.push(freeText);
                            } else {
                              selectionNames.push(`${g.nameAr}: ${freeText}`);
                            }
                          }
                        }
                        const lineName = selectionNames.length ? `${result.baseProduct.name} (${selectionNames.join("، ")})` : result.baseProduct.name;
                        const kn = kitchenNotesParts.join("؛ ");
                        const sn = assignmentMode === "general" ? null : selectedSeat;
                        const line: CartLine = {
                          id: lineId(),
                          productGuide: result.baseProduct.guide,
                          name: lineName,
                          qty: 1,
                          unitPrice: result.baseProduct.price + totalPriceDelta,
                          seatNo: sn,
                          seatLabel: null,
                          kitchenNotes: kn || undefined,
                          addonIdsKey: "",
                          modifiers: cartModifiers.length ? cartModifiers : undefined,
                        };
                        setCart((prev) => [...prev, line]);
                        setWizardProduct(null);
                        setWizardGroups([]);
                        setWizardStepInfo(null);
                      }}
                      onCancel={() => {
                        setWizardProduct(null);
                        setWizardGroups([]);
                        setWizardStepInfo(null);
                      }}
                    />
                  </div>
                ) : (
                  <div id="waiter-ot-sec-grid" className="waiter-pos__grid waiter-pos__ot-scroll-target waiter-pos__workspace-block">
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
                          onClick={() => void handleProductClick(p)}
                          style={{ opacity: stopped ? 0.55 : 1, position: "relative" }}
                          title={stopped ? stopNote : undefined}
                        >
                          {stopped ? (
                            <div style={{ position: "absolute", top: 6, left: 6, zIndex: 3, background: "#b91c1c", color: "#fff", borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 800 }}>
                              Out of Stock
                            </div>
                          ) : null}
                          <div className="waiter-pos__ribbon">{Math.round((p.Price || 0) * (1 + SERVICE_RATE_FOR_CARD_PRICE))} ج.م</div>
                          {captainItemSelectionMode === "classic" && (
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
                                  void handleProductClick(p);
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
                          )}
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
                )}
              </section>

              <aside className="waiter-pos__cart-column">
                <div id="waiter-ot-sec-pending" className="waiter-pos__desk-card waiter-pos__ot-scroll-target">
                  <div className="waiter-pos__desk-card__head">
                    <div>
                      <div className="waiter-pos__desk-card__title">السلة — قيد الإرسال</div>
                      <div className="waiter-pos__desk-card__sub">
                        {itemCount} صنف · تقدير أولي {gross.toFixed(2)} ج.م
                      </div>
                      <div className="waiter-pos__cart-seat-indicator">
                        <span className="waiter-pos__cart-seat-indicator__label">التسجيل الآن:</span>
                        <span className="waiter-pos__cart-seat-indicator__value">
                          {activeSessionId && assignmentMode === "per_seat"
                            ? seatGuestDisplay(selectedSeat)
                            : "حدّد الأفراد أولًا"}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost waiter-pos__summary-toggle" onClick={() => setShowCostDrawer((prev) => !prev)}>
                        تفاصيل التكلفة
                      </button>
                      <button
                        type="button"
                        className="waiter-pos__btn waiter-pos__cart-submit"
                        disabled={loading || billingLocked || sessionGuestApprovalPending || cart.length === 0}
                        onClick={() => void submitSale()}
                      >
                        {loading ? "جاري الإرسال…" : sessionGuestApprovalPending ? "بانتظار قرار المدير" : "إرسال الطلب"}
                      </button>
                    </div>
                  </div>
                  <div className="waiter-pos__order-box">
                    {cart.length === 0 ? <div style={{ color: "var(--wp-muted)", fontSize: "0.9rem" }}>لا توجد عناصر</div> : cart.map((l) => (
                      <div key={`desk-line-${l.id}`} className="waiter-pos__order-line">
                        <div style={{ flex: 1 }}>
                          {(() => {
                            const xn = seatNoFromLine(l);
                            const tag = xn != null ? seatGuestDisplay(xn) : null;
                            return tag ? `${l.name} · ${tag}` : l.name;
                          })()}
                          {l.modifiers && l.modifiers.length > 0 ? (
                            <div style={{ marginTop: 3, paddingInlineStart: 12 }}>
                              {l.modifiers.map((m, idx) => (
                                <div key={idx} style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                                  {m.groupName}: {m.itemName} {m.priceDelta > 0 ? `(+${m.priceDelta.toFixed(0)})` : ""}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {l.kitchenNotes?.trim() ? (
                            <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>ملاحظة: {l.kitchenNotes.trim()}</div>
                          ) : null}
                        </div>
                        <input type="number" min={1} value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value) || 0)} disabled={billingLocked} />
                        <span>{Math.max(0, l.qty * l.unitPrice - (promoResult.lineDiscounts[l.id] || 0)).toFixed(0)} ج.م</span>
                        {l.modifiers && l.modifiers.length > 0 && !billingLocked ? (
                          <button
                            type="button"
                            className="waiter-pos__line-remove"
                            style={{ background: "#0ea5e9", color: "#fff", marginInlineEnd: 4 }}
                            onClick={() => {
                              const p = products.find((x: Product) => x.CardGuide === l.productGuide);
                              if (p) void handleProductClick(p);
                            }}
                            title="تعديل الإضافات"
                          >
                            ✎
                          </button>
                        ) : null}
                        <button type="button" className="waiter-pos__line-remove" onClick={() => removeLine(l.id)} disabled={billingLocked}>×</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="waiter-pos__desk-card waiter-pos__desk-card--summary">
                  <div className="waiter-pos__desk-card__head">
                    <div>
                      <div className="waiter-pos__desk-card__title">مرسل / جاهز بالمطبخ</div>
                      <div className="waiter-pos__desk-card__sub">متابعة الطلبات المرسلة من الجلسة الحالية.</div>
                    </div>
                  </div>

                  <div id="waiter-ot-sec-sent" className="waiter-pos__sent waiter-pos__sent--compact waiter-pos__ot-scroll-target">
                    {ordersBusy && !sessionOrders.length ? (
                      <div className="waiter-pos__summary-empty">جاري التحميل…</div>
                    ) : sessionOrders.filter((o) => (o.status || "").toLowerCase() !== "cancelled").length === 0 ? (
                      <div className="waiter-pos__summary-empty">لا توجد بعد.</div>
                    ) : (
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {sessionOrders.filter((o) => (o.status || "").toLowerCase() !== "cancelled").slice().reverse().map((o) => {
                          const st = (o.status || "").toLowerCase();
                          const canCancel = st === "pending";
                          const lines = activeOrderItems(o).map(formatOrderItemLine);
                          return (
                            <li key={`sent-desk-${o.id}`} style={{ borderBottom: "1px solid rgba(15,23,42,0.08)", padding: "8px 0", fontSize: "0.82rem", color: "#e2e8f0" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                                <span><strong style={{ color: "#fff" }}>طلب #{o.id.slice(0, 8)}</strong> · {orderStatusLabelAr(st)}</span>
                                {canCancel ? <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ fontSize: "0.72rem", padding: "3px 7px", color: "#f87171", borderColor: "#7f1d1d" }} onClick={() => void cancelServerOrder(o.id)}>إلغاء</button> : null}
                              </div>
                              <ul style={{ margin: 0, paddingInlineStart: 16, color: "#cbd5e1", lineHeight: 1.45 }}>
                                {lines.length ? lines.map((ln, idx) => <li key={`${o.id}-desk-ln-${idx}`}>{ln}</li>) : <li>بدون بنود</li>}
                              </ul>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {showCostDrawer ? (
                    <div id="waiter-ot-sec-totals" className="waiter-pos__footer-totals waiter-pos__cost-drawer waiter-pos__ot-scroll-target">
                      <div style={{ color: "#0f172a", fontSize: "0.92rem", fontWeight: 900, marginBottom: 4 }}>تفاصيل التكلفة</div>
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
                          الحدّ الأدنى {effectiveMinimumChargePerSeat.toFixed(0)} ج.م/ضيف × {activeGuestSeatCount} = {effectiveTableMinimum.toFixed(0)} ج.م — الفرق {minimumChargeDelta.toFixed(0)} ج.م.
                        </div>
                      ) : null}
                      {effectiveTableMinimum > 0 && minimumChargeDelta > 0 && !billingLocked && !orderTakingLocked ? (
                        <div style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            className="waiter-pos__btn waiter-pos__btn--ghost"
                            onClick={() => setShowGapPicks((prev) => !prev)}
                            style={{ fontSize: "0.8rem", fontWeight: 800, color: "#92400e", borderColor: "rgba(217,119,6,0.45)", background: "rgba(251,191,36,0.1)", padding: "6px 10px" }}
                          >
                            {showGapPicks ? "▼" : "▶"} {gapPickHits.length} بدائل ضمن فرق {minimumChargeDelta.toFixed(0)} ج.م
                          </button>
                          {showGapPicks ? (
                            <div
                              style={{
                                marginTop: 6,
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid rgba(217,119,6,0.35)",
                                background: "rgba(251,191,36,0.08)",
                              }}
                            >
                              <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 8, lineHeight: 1.35 }}>
                                أصناف بسعر الوحدة ≤ {minimumChargeDelta.toFixed(2)} ج.م لتقليل الفرق.
                              </div>
                              {gapPickBusy ? (
                                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>جاري التحميل…</div>
                              ) : gapPickHits.length === 0 ? (
                                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>لا توجد أصناف ضمن هذا السقف.</div>
                              ) : (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {gapPickHits.slice(0, 14).map((p) => (
                                    <button
                                      key={`desk-gap-${p.CardGuide}`}
                                      type="button"
                                      className="waiter-pos__btn waiter-pos__btn--ghost"
                                      style={{ fontSize: "0.76rem", padding: "5px 10px", maxWidth: "100%" }}
                                      title={`إضافة ${p.ProductName} إلى السلة`}
                                      onClick={() => void handleProductClick(p)}
                                    >
                                      {p.ProductName.slice(0, 42)}
                                      {p.ProductName.length > 42 ? "…" : ""} <span style={{ opacity: 0.85 }}>({p.Price.toFixed(0)})</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {billingTotals.ownerDiscountPct > 0 ? (
                        <div style={{ color: "#0f172a", fontSize: "0.88rem", fontWeight: 700 }}>
                          خصم مالك بعد العروض {billingTotals.ownerDiscountPct}%: صافي قبل الضرائب {netAfterMinimum.toFixed(2)} ← {billingTotals.netPortion.toFixed(2)}
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
                  ) : null}
                </div>
              </aside>
            </div>
          ) : (
            <>
              <div className="waiter-pos__topbar">
                {useCaptainMobileUi && captainTab === "menu" && assignmentMode === "per_seat" && captainDockSeats.length > 0 ? (
                  <div className="waiter-pos__captain-guest-strip" role="tablist" aria-label="اختصار أسماء الضيوف أعلى المنيو">
                    {captainDockSeats.map((n) => (
                      <button
                        key={`cap-seat-${n}`}
                        type="button"
                        role="tab"
                        aria-selected={selectedSeat === n}
                        className={`waiter-pos__captain-guest-strip__btn${selectedSeat === n ? " waiter-pos__captain-guest-strip__btn--active" : ""}${n === SHARED_SEAT_NO ? " waiter-pos__captain-guest-strip__btn--shared" : ""
                          }`}
                        onClick={() => pickCaptainSeatForOrder(n)}
                      >
                        {truncateRailGuestLabel(seatGuestDisplay(n))}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div
                  id="waiter-ot-sec-navopts"
                  className="waiter-pos__top-card waiter-pos__top-card--navopts waiter-pos__ot-scroll-target"
                  style={{ order: 90 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <h3 style={{ marginTop: 0 }}>عمليات الطاولة</h3>
                    <div style={{ color: "#94a3b8", fontSize: "0.76rem", fontWeight: 700 }}>
                      اضغط على العملية لفتح شريحة كبيرة مستقلة.
                    </div>
                  </div>
                  <div className="waiter-pos__ops-launcher">
                    {[
                      { key: "returns" as const, label: "🔄 مرتجع", subtitle: "مرتجعات الجلسة الحالية", color: "#f59e0b", disabled: !activeSessionId || returnableLines.length === 0 },
                      { key: "transfer" as const, label: "🔀 تحويل", subtitle: "نقل الجلسة إلى طاولة أخرى", color: "#3b82f6", disabled: !activeSessionId || sessionMoveBusy },
                      { key: "merge" as const, label: "➕ دمج", subtitle: "دمج الجلسة مع طاولة نشطة", color: "#22c55e", disabled: !activeSessionId || sessionMoveBusy },
                      { key: "reorder" as const, label: "🪑 نقل", subtitle: "تغيير مقاعد البنود والضيوف", color: "#8b5cf6", disabled: false },
                      { key: "invoices" as const, label: "🧾 شيكات", subtitle: "معاينة وطباعة الشيكات", color: "#ec4899", disabled: false },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className="waiter-pos__ops-launcher-btn"
                        disabled={tab.disabled}
                        onClick={() => openNavoptsDialog(tab.key)}
                        style={{
                          borderColor: `${tab.color}55`,
                          background: `${tab.color}14`,
                          color: tab.disabled ? "#64748b" : tab.color,
                          opacity: tab.disabled ? 0.5 : 1,
                        }}
                      >
                        <span className="waiter-pos__ops-launcher-btn__title">{tab.label}</span>
                        <span className="waiter-pos__ops-launcher-btn__sub">{tab.subtitle}</span>
                      </button>
                    ))}
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
                  id="waiter-ot-sec-pending"
                  className="waiter-pos__top-card waiter-pos__top-card--flexcol waiter-pos__ot-scroll-target"
                  style={{ order: 30 }}
                >
                  <>
                    <h3 style={{ marginTop: 0 }}>السلة — قيد الإرسال</h3>
                    <div className="waiter-pos__order-box">
                      {cart.length === 0 ? <div style={{ color: "var(--wp-muted)", fontSize: "0.9rem" }}>لا توجد عناصر</div> : cart.map((l) => (
                        <div key={`top-line-${l.id}`} className="waiter-pos__order-line">
                          <div style={{ flex: 1 }}>
                            {(() => {
                              const xn = seatNoFromLine(l);
                              const tag = xn != null ? seatGuestDisplay(xn) : null;
                              return tag ? `${l.name} · ${tag}` : l.name;
                            })()}
                            {l.modifiers && l.modifiers.length > 0 ? (
                              <div style={{ marginTop: 3, paddingInlineStart: 12 }}>
                                {l.modifiers.map((m, idx) => (
                                  <div key={idx} style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                                    {m.groupName}: {m.itemName} {m.priceDelta > 0 ? `(+${m.priceDelta.toFixed(0)})` : ""}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {l.kitchenNotes?.trim() ? (
                              <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>ملاحظة: {l.kitchenNotes.trim()}</div>
                            ) : null}
                          </div>
                          <input type="number" min={1} value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value) || 0)} disabled={billingLocked} />
                          <span>{Math.max(0, l.qty * l.unitPrice - (promoResult.lineDiscounts[l.id] || 0)).toFixed(0)} ج.م</span>
                          {l.modifiers && l.modifiers.length > 0 && !billingLocked ? (
                            <button
                              type="button"
                              className="waiter-pos__line-remove"
                              style={{ background: "#0ea5e9", color: "#fff", marginInlineEnd: 4 }}
                              onClick={() => {
                                // إعادة فتح المعالج لتعديل الاختيارات (بدون استعادة — نسخة أولية)
                                const p = products.find((x: Product) => x.CardGuide === l.productGuide);
                                if (p) void handleProductClick(p);
                              }}
                              title="تعديل الإضافات"
                            >
                              ✎
                            </button>
                          ) : null}
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
                  </>
                </div>

                {!useDesktopOrderWorkspace ? (
                  <div
                    id="waiter-ot-sec-distribute"
                    className="waiter-pos__top-card waiter-pos__top-card--flexcol waiter-pos__top-card--seatpanel waiter-pos__top-card--seatlauncher waiter-pos__ot-scroll-target"
                    style={{ order: 20 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ marginTop: 0, marginBottom: 4 }}>{assignmentMode === "per_seat" ? "إدارة الضيوف والكراسي" : "توزيع الطلب"}</h3>
                        <div style={{ color: "#94a3b8", fontSize: "0.8rem", fontWeight: 700 }}>
                          افتح شريحة كبيرة مستقلة بدل العمل داخل المساحة الضيقة.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="waiter-pos__btn waiter-pos__btn--ghost waiter-pos__table-move-action"
                        style={{ width: "auto", minWidth: 180 }}
                        onClick={openGuestSeatDialog}
                      >
                        {assignmentMode === "per_seat" ? "فتح شريحة الضيوف" : "فتح شريحة التوزيع"}
                      </button>
                    </div>
                    <div className="waiter-pos__toggle-row">
                      <button
                        type="button"
                        className={`waiter-pos__toggle waiter-pos__toggle--seat-mode ${assignmentMode === "per_seat" ? "waiter-pos__toggle--on" : ""}`}
                        onClick={() => setAssignmentMode("per_seat")}
                      >
                        حسب المقعد (١–{activeGuestSeatCount})
                      </button>
                      <button
                        type="button"
                        className="waiter-pos__toggle waiter-pos__toggle--guestcount waiter-pos__toggle--on"
                        onClick={() => {
                          void openMinimumChargeFlow();
                        }}
                        disabled={billingLocked || sessionBusy}
                      >
                        ضع عدد الضيوف: {activeGuestSeatCount}
                      </button>
                      <button
                        type="button"
                        className={`waiter-pos__toggle waiter-pos__toggle--general-mode ${assignmentMode === "general" ? "waiter-pos__toggle--on" : ""}`}
                        onClick={() => setAssignmentMode("general")}
                      >
                        طلب عام (بدون مقعد)
                      </button>
                    </div>
                  </div>
                ) : null}

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
                        الحدّ الأدنى {effectiveMinimumChargePerSeat.toFixed(0)} ج.م/ضيف × {activeGuestSeatCount} = {effectiveTableMinimum.toFixed(0)} ج.م — الفرق {minimumChargeDelta.toFixed(0)} ج.م.
                      </div>
                    ) : null}
                    {effectiveTableMinimum > 0 && minimumChargeDelta > 0 && !billingLocked && !orderTakingLocked ? (
                      <div style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="waiter-pos__btn waiter-pos__btn--ghost"
                          onClick={() => setShowGapPicks((prev) => !prev)}
                          style={{ fontSize: "0.8rem", fontWeight: 800, color: "#92400e", borderColor: "rgba(217,119,6,0.45)", background: "rgba(251,191,36,0.1)", padding: "6px 10px" }}
                        >
                          {showGapPicks ? "▼" : "▶"} {gapPickHits.length} بدائل ضمن فرق {minimumChargeDelta.toFixed(0)} ج.م
                        </button>
                        {showGapPicks ? (
                          <div
                            style={{
                              marginTop: 6,
                              padding: "10px 12px",
                              borderRadius: 10,
                              border: "1px solid rgba(217,119,6,0.35)",
                              background: "rgba(251,191,36,0.08)",
                            }}
                          >
                            <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 8, lineHeight: 1.35 }}>
                              أصناف بسعر الوحدة ≤ {minimumChargeDelta.toFixed(2)} ج.م لتقليل الفرق.
                            </div>
                            {gapPickBusy ? (
                              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>جاري التحميل…</div>
                            ) : gapPickHits.length === 0 ? (
                              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>لا توجد أصناف ضمن هذا السقف.</div>
                            ) : (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {gapPickHits.slice(0, 14).map((p) => (
                                  <button
                                    key={`gap-${p.CardGuide}`}
                                    type="button"
                                    className="waiter-pos__btn waiter-pos__btn--ghost"
                                    style={{ fontSize: "0.76rem", padding: "5px 10px", maxWidth: "100%" }}
                                    title={`إضافة ${p.ProductName} إلى السلة`}
                                    onClick={() => void handleProductClick(p)}
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

              <div className="waiter-pos__workspace-block" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4, padding: "0 12px" }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 700 }}>عرض:</span>
                  <button type="button" className={`waiter-pos__mini-toggle ${displayMode === "group" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => { setDisplayMode("group"); setCategoryKey("all"); }}>مجموعة</button>
                  <button type="button" className={`waiter-pos__mini-toggle ${displayMode === "category" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => { setDisplayMode("category"); setCategoryKey("all"); }}>تصنيف</button>
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 700 }}>ترتيب:</span>
                  <button type="button" className={`waiter-pos__mini-toggle ${sortMode === "default" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => setSortMode("default")}>افتراضي</button>
                  <button type="button" className={`waiter-pos__mini-toggle ${sortMode === "name" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => setSortMode("name")}>الاسم</button>
                  <button type="button" className={`waiter-pos__mini-toggle ${sortMode === "price" ? "waiter-pos__mini-toggle--on" : ""}`} onClick={() => setSortMode("price")}>السعر</button>
                </div>
              </div>

              {/* Categories Strip - Full Width */}
              <div
                id="waiter-ot-sec-categories"
                className="waiter-pos__cat-strip"
                style={{
                  width: "100%",
                  minHeight: 52,
                  maxHeight: 120,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  padding: "6px 0",
                }}
              >
                {displayMode === "category" && categoryKey !== "all" ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", overflow: "hidden", paddingBottom: 4 }}>
                    <button
                      type="button"
                      className="waiter-pos__cat"
                      onClick={() => { setCategoryKey("all"); setSubGroupKey("all"); }}
                      title="رجوع للتصنيفات"
                      style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                    >
                      🔙 رجوع
                    </button>
                    {groupsInSelectedCategory.map((g) => (
                      <button
                        key={`sub-${g.CardGuide}`}
                        type="button"
                        className={`waiter-pos__cat ${subGroupKey === g.CardGuide ? "waiter-pos__cat--active" : ""}`}
                        style={{ background: "#dbeafe", borderColor: "#3b82f6", color: "#1e40af", flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                        onClick={() => setSubGroupKey(subGroupKey === g.CardGuide ? "all" : g.CardGuide)}
                        title={g.GroupName}
                      >
                        {g.GroupName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", overflow: "hidden", paddingBottom: 4 }}>
                    <button
                      type="button"
                      className={`waiter-pos__cat ${categoryKey === "all" ? "waiter-pos__cat--active" : ""}`}
                      onClick={() => setCategoryKey("all")}
                      title={displayMode === "category" ? "كل التصنيفات" : "كل المجموعات"}
                      style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                    >
                      {displayMode === "category" ? "كل التصنيفات" : "كل المجموعات"}
                    </button>
                    {displayMode === "category"
                      ? displayCategories.map((cat) => (
                        <button
                          key={`cat-${cat}`}
                          type="button"
                          className={`waiter-pos__cat ${categoryKey === cat ? "waiter-pos__cat--active" : ""}`}
                          onClick={() => setCategoryKey(cat)}
                          title={cat}
                          style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                        >
                          {cat}
                        </button>
                      ))
                      : waiterMenuGroups.map((g) => (
                        <button
                          key={`side-${g.CardGuide}`}
                          type="button"
                          className={`waiter-pos__cat ${categoryKey === g.CardGuide ? "waiter-pos__cat--active" : ""}`}
                          onClick={() => setCategoryKey(g.CardGuide)}
                          title={g.GroupName}
                          style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
                        >
                          {g.GroupName}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {!wizardProduct ? (
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
              ) : null}
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
              {!wizardProduct && (
                <>
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
                      disabled={loading || billingLocked || sessionGuestApprovalPending || cart.length === 0}
                      onClick={() => void submitSale()}
                    >
                      {loading ? "جاري الإرسال…" : "إرسال الطلب"}
                    </button>
                  </div>
                  <div className="waiter-pos__section-divider" />
                </>
              )}

              {wizardProduct ? (
                <div
                  id="waiter-ot-sec-grid"
                  className="waiter-pos__ot-scroll-target"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    maxHeight: "calc(100vh - 340px)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  <ModifierWizard
                    baseProduct={wizardProduct}
                    groups={wizardGroups}
                    onResult={(result) => {
                      const selectionNames: string[] = [];
                      const kitchenNotesParts: string[] = [];
                      const cartModifiers: CartModifier[] = [];
                      let totalPriceDelta = 0;
                      for (const sel of result.selections) {
                        const g = wizardGroups.find((x) => x.groupId === sel.groupId);
                        if (!g) continue;
                        for (const itemId of sel.selectedItemIds) {
                          const it = g.items.find((x) => x.itemId === itemId);
                          if (!it) continue;
                          totalPriceDelta += it.priceDelta;
                          cartModifiers.push({ groupId: g.groupId, groupName: g.nameAr, itemName: it.nameAr, priceDelta: it.priceDelta });
                          if (g.type === "exclusion") {
                            kitchenNotesParts.push(`بدون ${it.nameAr}`);
                          } else if (g.type === "kitchen_note") {
                            kitchenNotesParts.push(it.nameAr);
                          } else {
                            selectionNames.push(it.nameAr);
                          }
                        }
                        const freeText = String(sel.note || "").trim();
                        if (freeText) {
                          cartModifiers.push({ groupId: g.groupId, groupName: g.nameAr, itemName: freeText, priceDelta: 0, source: "free_text" });
                          if (g.type === "kitchen_note" || g.type === "exclusion") {
                            kitchenNotesParts.push(freeText);
                          } else {
                            selectionNames.push(`${g.nameAr}: ${freeText}`);
                          }
                        }
                      }
                      const lineName = selectionNames.length
                        ? `${result.baseProduct.name} (${selectionNames.join("، ")})`
                        : result.baseProduct.name;
                      const kn = kitchenNotesParts.join("؛ ");
                      const sn = assignmentMode === "general" ? null : selectedSeat;
                      const line: CartLine = {
                        id: lineId(),
                        productGuide: result.baseProduct.guide,
                        name: lineName,
                        qty: 1,
                        unitPrice: result.baseProduct.price + totalPriceDelta,
                        seatNo: sn,
                        seatLabel: null,
                        kitchenNotes: kn || undefined,
                        addonIdsKey: "",
                        modifiers: cartModifiers.length ? cartModifiers : undefined,
                      };
                      setCart((prev) => [...prev, line]);
                      setWizardProduct(null);
                      setWizardGroups([]);
                      setWizardStepInfo(null);
                    }}
                    onCancel={() => {
                      setWizardProduct(null);
                      setWizardGroups([]);
                      setWizardStepInfo(null);
                    }}
                  />
                </div>
              ) : (
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
                        onClick={() => void handleProductClick(p)}
                        style={{ opacity: stopped ? 0.55 : 1, position: "relative" }}
                        title={stopped ? stopNote : undefined}
                      >
                        {stopped ? (
                          <div style={{ position: "absolute", top: 6, left: 6, zIndex: 3, background: "#b91c1c", color: "#fff", borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 800 }}>
                            Out of Stock
                          </div>
                        ) : null}
                        <div className="waiter-pos__ribbon">{Math.round((p.Price || 0) * (1 + SERVICE_RATE_FOR_CARD_PRICE))} ج.م</div>
                        {captainItemSelectionMode === "classic" && (
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
                                void handleProductClick(p);
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
                        )}
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
              )}
            </>
          )}
        </main>
      </div>

      {navoptsActiveTab ? (
        <div className="waiter-pos__ops-modal-overlay" role="presentation" onClick={closeNavoptsDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="waiter-ops-dialog-title"
            className="waiter-pos__ops-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="waiter-pos__ops-modal__head">
              <div className="waiter-pos__ops-modal__head-copy">
                <h3 id="waiter-ops-dialog-title" className="waiter-pos__ops-modal__title">
                  {navoptsDialogTitle}
                </h3>
                <div className="waiter-pos__ops-modal__note">{navoptsDialogNote}</div>
              </div>
              <button type="button" className="waiter-pos__ops-modal__close" onClick={closeNavoptsDialog} aria-label="إغلاق">
                ×
              </button>
            </div>
            <div className="waiter-pos__ops-modal__body">
              {navoptsActiveTab === "returns" && (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>اختر طلبًا مرسلًا للمطبخ لطلب مرتجع من الجلسة الحالية فقط.</div>
                  <button
                    type="button"
                    className="waiter-pos__btn waiter-pos__btn--ghost waiter-pos__table-move-action"
                    disabled={!activeSessionId || returnableLines.length === 0}
                    onClick={() => {
                      closeNavoptsDialog();
                      setReturnModalLines(returnableLines);
                      setReturnModalOpen(true);
                    }}
                  >
                    فتح قائمة المرتجعات
                  </button>
                </div>
              )}
              {navoptsActiveTab === "transfer" && (
                <div style={{ display: "grid", gap: 12 }}>
                  <div className="waiter-pos__table-move-block">
                    <div className="waiter-pos__table-move-block__title waiter-pos__table-move-block__title--dialog" style={{ color: "#3b82f6" }}>تحويل الطاولة كاملة</div>
                    <div className="waiter-pos__table-pick-hint">إلى طاولة فارغة: تنتقل الجلسة. إلى طاولة مشغولة: تُضم الطلبات والضيوف إلى حسابها بعد تأكيد واضح.</div>
                    <div className="waiter-pos__table-pick-search-row">
                      <input type="search" enterKeyHint="search" className="waiter-pos__table-pick-search" value={transferPickQuery} onChange={(e) => setTransferPickQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (transferSearchResults?.length === 1) { void transferTableTo(transferSearchResults[0]!.id); return; } runTransferTableSearch(); } }} placeholder="ابحث عن طاولة فارغة…" autoComplete="off" aria-label="بحث طاولة للتحويل" />
                      <button type="button" className="waiter-pos__btn waiter-pos__btn--primary waiter-pos__table-pick-search-btn" onClick={() => runTransferTableSearch()}>بحث</button>
                    </div>
                    {transferSearchResults === null ? null : transferSearchResults.length === 0 ? (
                      <div className="waiter-pos__table-pick-empty">لا توجد نتائج.</div>
                    ) : (
                      <>
                        <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: 6 }}>اضغط على طاولة لاختيارها:</div>
                        <div className="waiter-pos__table-pick-list waiter-pos__table-pick-list--dialog" role="listbox" aria-label="طاولات للتحويل">
                          {transferSearchResults.map((t) => (
                            <button key={`tr-pick-${t.id}`} type="button" role="option" aria-selected={String(transferTargetTableId) === String(t.id)} className={`waiter-pos__table-pick-row${String(transferTargetTableId) === String(t.id) ? " is-selected" : ""}`} onClick={() => setTransferTargetTableId(String(t.id))} onDoubleClick={() => void transferTableTo(String(t.id))} title="انقر للتحديد أو دبل كليك لتنفيذ التحويل مباشرة">{tableDisplayName(t)} {sessionByTableRef[tableRefKey(t.id)]?.id ? "— مشغولة" : "— فارغة"}</button>
                          ))}
                        </div>
                      </>
                    )}
                    {transferTargetTableId ? (
                      <div className="waiter-pos__table-pick-selected waiter-pos__table-pick-selected--dialog" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.4)", padding: "10px 12px", borderRadius: 10 }}><span style={{ color: "#60a5fa" }}>المختار: <strong style={{ color: "#fff" }}>{tableDisplayName(tablesMoveCatalog.find((x) => String(x.id) === String(transferTargetTableId))) || transferTargetTableId}</strong></span><button type="button" className="waiter-pos__table-pick-clear" style={{ color: "#f87171" }} onClick={() => setTransferTargetTableId("")}>مسح</button></div>
                    ) : null}
                    <button type="button" className="waiter-pos__btn waiter-pos__btn--primary waiter-pos__table-move-action" style={{ background: transferTargetTableId ? "#3b82f6" : undefined, opacity: transferTargetTableId ? 1 : 0.4 }} disabled={!activeSessionId || sessionMoveBusy || !transferTargetTableId} onClick={() => void transferTableByTarget(transferTargetTableId)}>⮕ تنفيذ التحويل</button>
                  </div>
                </div>
              )}
              {navoptsActiveTab === "merge" && (
                <div style={{ display: "grid", gap: 12 }}>
                  {mergedIntoSessionId || mergedSourceSessionIds.length > 0 ? (
                    <div className="waiter-pos__table-move-block" style={{ borderColor: "rgba(245,158,11,0.55)" }}>
                      <div className="waiter-pos__table-move-block__title waiter-pos__table-move-block__title--dialog" style={{ color: "#fbbf24" }}>دمج نشط</div>
                      <div style={{ color: "#cbd5e1", marginBottom: 10 }}>
                        {mergedIntoSessionId
                          ? "هذه هي الطاولة المصدر. يستمر الطلب منها، لكن طلب الحساب النهائي متاح من الطاولة الهدف فقط."
                          : `هذه هي الطاولة الهدف للحساب المشترك${mergedSourceSessionIds.length > 1 ? ` (${mergedSourceSessionIds.length} طاولات مصدر)` : ""}.`}
                      </div>
                      {mergedSourceSessionIds.length > 1 && !mergedIntoSessionId ? (
                        <select value={unmergeSourceSessionId || mergedSourceSessionIds[0] || ""} onChange={(e) => { setUnmergeSourceSessionId(e.target.value); setUnmergePreviewLines([]); }} style={{ width: "100%", marginBottom: 8 }}>
                          {mergedSourceSessionIds.map((sid, idx) => <option key={sid} value={sid}>الطاولة المصدر {idx + 1}</option>)}
                        </select>
                      ) : null}
                      <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" disabled={unmergeBusy} onClick={() => void loadUnmergePreview(unmergeSourceSessionId || undefined)}>
                        {unmergeBusy ? "جارٍ التحميل…" : "مراجعة وإلغاء الدمج"}
                      </button>
                      {unmergePreviewLines.length > 0 ? (
                        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                          <div style={{ color: "#fbbf24", fontWeight: 800 }}>راجع كل الأصناف وأعد تحديد المقاعد قبل الفصل</div>
                          {unmergePreviewLines.map((line) => {
                            const key = `${line.orderId}:${line.lineId}`;
                            return (
                              <div key={key} className="waiter-pos__ops-modal__grid-row">
                                <div style={{ minWidth: 0 }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#fbbf24", fontSize: "0.78rem" }}>
                                    <input
                                      type="checkbox"
                                      checked={unmergeSeatEnabled[key] !== false}
                                      onChange={(e) => setUnmergeSeatEnabled((prev) => ({ ...prev, [key]: e.target.checked }))}
                                    />
                                    تطبيق توزيع المقعد
                                  </label>
                                  <div style={{ color: "#fff", fontWeight: 800 }}>{line.name} ×{line.quantity}</div>
                                  <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>{line.origin === "source" ? "الطاولة المصدر" : "الطاولة الهدف"} · {line.tableId}</div>
                                </div>
                                <span style={{ color: "#cbd5e1" }}>المقعد</span>
                                <select disabled={unmergeSeatEnabled[key] === false} value={unmergeSeatTargets[key] || ""} onChange={(e) => setUnmergeSeatTargets((prev) => ({ ...prev, [key]: Number(e.target.value || 0) }))}>
                                  <option value="">بدون مقعد</option>
                                  {[...Array.from({ length: SEAT_SLOT_COUNT }, (_, idx) => idx + 1), SHARED_SEAT_NO].map((seat) => <option key={`${key}-${seat}`} value={seat}>{seatGuestDisplay(seat)}</option>)}
                                </select>
                              </div>
                            );
                          })}
                          <button type="button" className="waiter-pos__btn waiter-pos__btn--primary" disabled={unmergeBusy} onClick={() => void submitUnmerge()}>
                            {unmergeBusy ? "جارٍ فك الدمج…" : "تأكيد فك الدمج وإعادة التوزيع"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="waiter-pos__table-move-block">
                    <div className="waiter-pos__table-move-block__title waiter-pos__table-move-block__title--dialog" style={{ color: "#22c55e" }}>دمج مع طاولة أخرى</div>
                    <div className="waiter-pos__table-pick-hint">الطاولة الفارغة ستُشغّل تلقائيًا. الطاولة المشغولة تعرض تحذيرًا لأن حسابها الحالي سيصبح الحساب المشترك.</div>
                    <div className="waiter-pos__table-pick-search-row">
                      <input type="search" enterKeyHint="search" className="waiter-pos__table-pick-search" value={mergePickQuery} onChange={(e) => setMergePickQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (mergeSearchResults?.length === 1) { void mergeIntoTableTo(mergeSearchResults[0]!.id); return; } runMergeTableSearch(); } }} placeholder="ابحث عن طاولة للدمج…" autoComplete="off" aria-label="بحث طاولة للدمج" />
                      <button type="button" className="waiter-pos__btn waiter-pos__btn--primary waiter-pos__table-pick-search-btn" onClick={() => runMergeTableSearch()}>بحث</button>
                    </div>
                    {mergeSearchResults === null ? null : mergeSearchResults.length === 0 ? (
                      <div className="waiter-pos__table-pick-empty">لا توجد نتائج.</div>
                    ) : (
                      <div className="waiter-pos__table-pick-list waiter-pos__table-pick-list--dialog" role="listbox" aria-label="طاولات للدمج">
                        {mergeSearchResults.map((t) => (
                          <button key={`mg-pick-${t.id}`} type="button" role="option" aria-selected={String(mergeTargetTableId) === String(t.id)} className={`waiter-pos__table-pick-row${String(mergeTargetTableId) === String(t.id) ? " is-selected" : ""}`} onClick={() => setMergeTargetTableId(String(t.id))} onDoubleClick={() => void mergeIntoTableTo(String(t.id))} title="انقر للتحديد أو دبل كليك لتنفيذ الدمج مباشرة">{tableDisplayName(t)} {sessionByTableRef[tableRefKey(t.id)]?.id ? "— مشغولة" : "— فارغة"}</button>
                        ))}
                      </div>
                    )}
                    {mergeTargetTableId ? (
                      <div className="waiter-pos__table-pick-selected waiter-pos__table-pick-selected--dialog" style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.4)", padding: "10px 12px", borderRadius: 10 }}><span style={{ color: "#4ade80" }}>المختار: <strong style={{ color: "#fff" }}>{tableDisplayName(tablesMoveCatalog.find((x) => String(x.id) === String(mergeTargetTableId))) || mergeTargetTableId}</strong></span><button type="button" className="waiter-pos__table-pick-clear" style={{ color: "#f87171" }} onClick={() => setMergeTargetTableId("")}>مسح</button></div>
                    ) : null}
                    <button type="button" className="waiter-pos__btn waiter-pos__btn--primary waiter-pos__table-move-action" style={{ background: mergeTargetTableId ? "#22c55e" : undefined, opacity: mergeTargetTableId ? 1 : 0.4 }} disabled={!activeSessionId || sessionMoveBusy || !mergeTargetTableId || Boolean(mergedIntoSessionId) || mergedSourceSessionIds.length > 0} onClick={() => void mergeIntoTableTarget(mergeTargetTableId)}>⮕ تنفيذ الدمج</button>
                  </div>
                </div>
              )}
              {navoptsActiveTab === "reorder" && (
                <div style={{ display: "grid", gap: 12 }}>
                  <div className="waiter-pos__table-move-block">
                    <div className="waiter-pos__table-move-block__title waiter-pos__table-move-block__title--dialog" style={{ color: "#8b5cf6" }}>نقل بين الضيوف</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: 8 }}>مراجعة بنود الطاولة وتغيير المقعد ضمن نافذة أوضح.</div>
                    {billingLocked ? (
                      <div className="waiter-pos__table-pick-empty">تم طلب الحساب؛ الترتيب متوقف.</div>
                    ) : null}
                    {reviewSeatMoveRows.length === 0 ? (
                      <div className="waiter-pos__table-pick-empty">لا توجد بنود للمراجعة.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {reviewSeatMoveRows.map((row) => {
                          const targetValue = Number(reorderSeatTargets[row.key] ?? row.seatNo ?? 0) || "";
                          const busy = reorderBusyKey === row.key;
                          return (
                            <div key={row.key} className="waiter-pos__ops-modal__grid-row">
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: "#fff", fontWeight: 800, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3, fontSize: "0.8rem" }}>
                                  <span style={{ color: row.statusTone === "cart" ? "#86efac" : "#93c5fd", fontWeight: 700 }}>{row.statusText}</span>
                                  <span style={{ color: "#94a3b8" }}>×{row.qty}</span>
                                </div>
                              </div>
                              <div style={{ color: "#cbd5e1", fontSize: "0.82rem", fontWeight: 700 }}>{row.seatNo != null ? seatGuestDisplay(row.seatNo) : "بدون مقعد"}</div>
                              <select value={targetValue} disabled={billingLocked || busy} onChange={(e) => { const n = Number(e.target.value || 0); setReorderSeatTargets((prev) => ({ ...prev, [row.key]: n })); }} style={{ width: "100%" }} aria-label={`اختر المقعد الجديد للبند ${row.name}`}>
                                <option value="">اختر المقعد</option>
                                {[...Array.from({ length: SEAT_SLOT_COUNT }, (_, idx) => idx + 1), SHARED_SEAT_NO].map((n) => (
                                  <option key={`${row.key}-seat-${n}`} value={n}>{seatGuestDisplay(n)}</option>
                                ))}
                              </select>
                              <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost waiter-pos__table-move-action" disabled={billingLocked || busy} onClick={() => void applySeatMove(row)}>{busy ? "..." : "نقل"}</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="waiter-pos__table-move-block" style={{ borderColor: "rgba(14,165,233,0.45)" }}>
                    <div className="waiter-pos__table-move-block__title waiter-pos__table-move-block__title--dialog" style={{ color: "#38bdf8" }}>فصل ضيف أو بنود إلى طاولة أخرى</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: 10 }}>
                      {roleHasManagerOpsAccess(user?.role)
                        ? "اختر البنود المرسلة، ثم الطاولة والمقعد الهدف. الطاولة الفارغة ستُشغّل تلقائيًا، والمشغولة ستطلب تأكيدًا قبل إضافة البنود إلى حسابها."
                        : "نقل الأصناف بين الطاولات اختصاص المدير فقط."}
                    </div>
                    {!roleHasManagerOpsAccess(user?.role) ? (
                      <div style={{ color: "#fca5a5", fontWeight: 700, marginBottom: 10 }}>غير متاح لدور الكابتن/الجرسون — اطلب المدير.</div>
                    ) : null}
                    <select value={partialMoveTargetTableId} onChange={(e) => setPartialMoveTargetTableId(e.target.value)} disabled={!roleHasManagerOpsAccess(user?.role) || billingLocked || partialMoveBusy} style={{ width: "100%", marginBottom: 10 }}>
                      <option value="">اختر الطاولة الهدف</option>
                      {transferPickBase.map((table) => (
                        <option key={`partial-target-${table.id}`} value={table.id}>
                          {tableDisplayName(table)} — {sessionByTableRef[tableRefKey(table.id)]?.id ? "مشغولة" : "فارغة"}
                        </option>
                      ))}
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#cbd5e1", marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={partialMoveIncludesGuest}
                        disabled={billingLocked || partialMoveBusy}
                        onChange={(e) => setPartialMoveIncludesGuest(e.target.checked)}
                      />
                      فصل ضيف كامل مع البنود المحددة (ينقص عدد ضيوف المصدر ويزيد عدد ضيوف الهدف)
                    </label>
                    <div style={{ display: "grid", gap: 8 }}>
                      {reviewSeatMoveRows.filter((row) => row.source === "order").map((row) => (
                        <label key={`partial-${row.key}`} className="waiter-pos__ops-modal__grid-row" style={{ cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(partialMoveSelected[row.key])}
                            disabled={billingLocked || partialMoveBusy}
                            onChange={(e) => setPartialMoveSelected((prev) => ({ ...prev, [row.key]: e.target.checked }))}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#fff", fontWeight: 800 }}>{row.name} ×{row.qty}</div>
                            <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>حاليًا: {row.seatNo ? seatGuestDisplay(row.seatNo) : "بدون مقعد"}</div>
                          </div>
                          <select
                            value={partialMoveSeatTargets[row.key] || row.seatNo || 1}
                            disabled={!partialMoveSelected[row.key] || partialMoveBusy}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setPartialMoveSeatTargets((prev) => ({ ...prev, [row.key]: Number(e.target.value || 1) }))}
                            aria-label={`مقعد ${row.name} في الطاولة الهدف`}
                          >
                            {[...Array.from({ length: SEAT_SLOT_COUNT }, (_, idx) => idx + 1), SHARED_SEAT_NO].map((seat) => (
                              <option key={`partial-${row.key}-${seat}`} value={seat}>{seatGuestDisplay(seat)}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="waiter-pos__btn waiter-pos__btn--primary waiter-pos__table-move-action"
                      disabled={
                        !roleHasManagerOpsAccess(user?.role) ||
                        billingLocked ||
                        partialMoveBusy ||
                        !partialMoveTargetTableId ||
                        !Object.values(partialMoveSelected).some(Boolean)
                      }
                      onClick={() => void submitPartialMove()}
                      style={{ marginTop: 10 }}
                    >
                      {partialMoveBusy ? "جارٍ النقل…" : "نقل البنود المحددة"}
                    </button>
                  </div>
                </div>
              )}
              {navoptsActiveTab === "invoices" && (
                <div style={{ display: "grid", gap: 12 }}>
                  <div className="waiter-pos__table-move-block">
                    <div className="waiter-pos__table-move-block__title waiter-pos__table-move-block__title--dialog" style={{ color: "#ec4899" }}>شيكات الطاولة</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: 8 }}>معاينة وطباعة الشيكات من نافذة كبيرة.</div>
                    {!billingLocked ? (
                      <div className="waiter-pos__table-pick-empty">بعد طلب الحساب ستظهر الشيكات هنا.</div>
                    ) : sessionInvoices.length === 0 ? (
                      <div className="waiter-pos__table-pick-empty">لا توجد شيكات مسجلة.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {sessionInvoices.map((inv, idx) => {
                          const id = String(inv.invoiceId || "").trim();
                          const isWaiterLocked = String(user?.role || "").trim().toLowerCase() === "waiter" && Number(inv.printCount || 0) >= 1;
                          return (
                            <div key={`session-invoice-${id || idx}`} className="waiter-pos__ops-modal__grid-row waiter-pos__ops-modal__grid-row--invoice">
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: "#fff", fontWeight: 800, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{String(inv.splitName || "").trim() || `شيك ${idx + 1}`}</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3, fontSize: "0.8rem", color: "#94a3b8" }}>
                                  <span>فاتورة: {inv.billNumber != null ? String(inv.billNumber) : "—"}</span>
                                  <span>طباعة: {Number(inv.printCount || 0)}</span>
                                </div>
                              </div>
                              <div style={{ color: "#cbd5e1", fontSize: "0.82rem", fontWeight: 700 }}>{inv.total != null ? `${Number(inv.total).toFixed(2)} ج.م` : "—"}</div>
                              <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost waiter-pos__table-move-action" disabled={!id || isWaiterLocked} onClick={() => openCaptainInvoice(inv)} title={isWaiterLocked ? "تمت طباعة الشيك مرة." : "معاينة وطباعة"}>{isWaiterLocked ? "طبع الكابتن" : "معاينة / طباعة"}</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {guestSeatDialogOpen ? (
        <div className="waiter-pos__ops-modal-overlay" role="presentation" onClick={closeGuestSeatDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="waiter-guest-dialog-title"
            className="waiter-pos__ops-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="waiter-pos__ops-modal__head">
              <div className="waiter-pos__ops-modal__head-copy">
                <h3 id="waiter-guest-dialog-title" className="waiter-pos__ops-modal__title">
                  تسمية الضيوف والمقاعد
                </h3>
                <div className="waiter-pos__ops-modal__note">
                  بعد اعتماد عدد الضيوف من زر المنيموم شارج، اكتب اسم كل ضيف على مقعده عند الحاجة.
                </div>
              </div>
              <button type="button" className="waiter-pos__ops-modal__close" onClick={closeGuestSeatDialog} aria-label="إغلاق">
                ×
              </button>
            </div>
            <div className="waiter-pos__ops-modal__body">
              <div style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    background: "rgba(15,23,42,0.42)",
                    border: "1px solid rgba(56,189,248,0.22)",
                    color: "#e2e8f0",
                    fontSize: "0.84rem",
                    fontWeight: 700,
                    lineHeight: 1.55,
                  }}
                >
                  العدد المعتمد: {activeGuestSeatCount} ضيف
                  {effectiveMinimumChargePerSeat > 0 ? ` · ${effectiveMinimumChargePerSeat.toFixed(2)} ج.م لكل كرسي` : ""}
                  {" · "}اضغط على أي مقعد لكتابة اسم الضيف، ويظل المقعد 13 متاحًا كطلب مشترك.
                </div>
                <>
                  {effectiveMinimumChargePerSeat > 0 ? (
                    <div style={{ color: "#e2e8f0", fontSize: "0.84rem", fontWeight: 700, lineHeight: 1.5 }}>
                      الحد الأدنى على مستوى الكرسي: {effectiveMinimumChargePerSeat.toFixed(2)} ج.م شامل الضريبة والخدمة
                      {" · "}
                      المطلوب للطاولة: {effectiveTableMinimum.toFixed(2)} ج.م
                    </div>
                  ) : null}
                  <div className="waiter-pos__seat-list-scroll waiter-pos__dropdown-wrap" style={{ marginTop: 4 }}>
                    <div className="waiter-pos__seats waiter-pos__seats--twelve waiter-pos__seats--twelve-list">
                      {guestSeatNumbers.map((n) => {
                        const qty = seatCartStats.get(n)?.qty ?? 0;
                        const dn = seatGuestDisplay(n);
                        const sharedRow = n === SHARED_SEAT_NO;
                        return (
                          <div
                            key={`guest-dialog-seat-${n}`}
                            className={`waiter-pos__seat-slot waiter-pos__seat-slot--compact-row ${sharedRow ? "waiter-pos__seat-slot--shared" : ""} ${selectedSeat === n ? "waiter-pos__seat-slot--active-order" : ""}`}
                            onClick={() => {
                              if (billingLocked) return;
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
                    <div style={{ marginTop: 8, color: "#e5e7eb" }}>
                      <div style={{ fontWeight: 800, fontSize: "0.8rem", marginBottom: 4 }}>
                        حساب مقاعد محددة (بدون انتظار الباقي)
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {visibleSeatNumbers.map((sn) => {
                          const on = billSeatNos.includes(sn);
                          return (
                            <button
                              key={`bill-seat-${sn}`}
                              type="button"
                              className="waiter-pos__btn waiter-pos__btn--ghost"
                              disabled={billingLocked}
                              style={{
                                padding: "4px 8px",
                                fontWeight: 800,
                                background: on ? "#fef3c7" : "transparent",
                                color: on ? "#92400e" : "#e5e7eb",
                                borderColor: on ? "#b45309" : undefined,
                              }}
                              onClick={() =>
                                setBillSeatNos((prev) =>
                                  prev.includes(sn) ? prev.filter((x) => x !== sn) : [...prev, sn].sort((a, b) => a - b),
                                )
                              }
                            >
                              {sn}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: "0.72rem", opacity: 0.85, marginTop: 4 }}>
                        فارغ = كل المقاعد غير المفوترة. محدّد = فاتورة لهؤلاء فقط والطاولة تبقى مفتوحة.
                      </div>
                    </div>
                  </div>
                </>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
                  if (t.id === "guests") {
                    setGuestSeatDialogOpen(true);
                  } else if (guestSeatDialogOpen) {
                    setGuestSeatDialogOpen(false);
                  }
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
            <div className="waiter-addon-modal__body">
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
              <div className="waiter-addon-modal__footer-fields">
                <label className="waiter-addon-modal__notes-wrap">
                  <span>مواصفات وحرّة (نص للمطبخ)</span>
                  <textarea
                    value={addonPickerNotes}
                    onChange={(e) => setAddonPickerNotes(e.target.value)}
                    placeholder="مثال: بدون زيتون — صوص حار على الجانب"
                    rows={2}
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
              </div>
            </div>
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
      <CaptainBillReviewModal
        open={billReviewOpen}
        tableLabel={selectedTable?.name || selectedTableId || "—"}
        ordersCount={sessionOrders.filter((o) => String(o.status || "").toLowerCase() !== "cancelled").length}
        splitBySeat={splitBySeat}
        returnableCount={returnableLines.length}
        printerHint={captainPrinterHint}
        lines={billReviewLines}
        returnedLines={returnedReviewLines}
        totals={{
          subtotal: reviewBillingTotals.netPortion,
          serviceCharge: reviewBillingTotals.serviceCharge,
          vatValue: reviewBillingTotals.vatValue,
          tipAmount: Math.max(0, tipAmount || 0),
          total: reviewTotal,
          minimumGap: reviewMinimumChargeDelta,
          ownerLabel: reviewBillingTotals.ownerTpl ? "Owner / VIP" : undefined,
        }}
        confirmBusy={requestBillBusy}
        onClose={() => setBillReviewOpen(false)}
        onPrinterHintChange={setCaptainPrinterHint}
        onOpenGuestReturn={() => {
          setReturnModalLines(returnableLines);
          setReturnModalOpen(true);
        }}
        onConfirm={() => void requestBill({ autoPrint: true })}
      />
      <CashierPayInvoiceModal
        open={captainInvoiceOpen}
        invoiceId={captainInvoiceId}
        initialRow={captainInitialInvoiceRow}
        allowPayment={false}
        dialogTitle="شيك الكابتن قبل التسديد"
        printerHint={captainPrinterHint}
        autoPrintOnOpen={captainInvoiceAutoPrint}
        onClose={() => {
          setCaptainInvoiceOpen(false);
          setCaptainInvoiceId(null);
          setCaptainInitialInvoiceRow(null);
          setCaptainInvoiceAutoPrint(false);
        }}
        onPaid={() => {
          /* no-op in captain mode */
        }}
        onChanged={() => {
          void loadSessionInvoices();
        }}
      />
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
