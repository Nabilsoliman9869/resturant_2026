import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import {
  fetchDailyMenuFromApi,
  fetchDailyMenuSchedule,
  isProductOnDailyMenu,
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

type Product = {
  CardGuide: string;
  ProductName: string;
  Price: number;
  PrepMinutes?: number;
  Hieght3?: number;
  GroupGuid?: string | null;
  image?: string;
  imageUrl?: string;
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
};

type CartLine = {
  id: string;
  productGuide: string;
  name: string;
  qty: number;
  unitPrice: number;
  seatLabel: string | null;
};

type ServerOrderItem = {
  lineId?: string;
  name?: string;
  quantity?: number;
  unitPrice?: number;
  cancelled?: boolean;
  prepared?: boolean;
  sent?: boolean;
  lineStatus?: string;
};

type ServerOrder = {
  id: string;
  sessionId?: string;
  tableId?: string;
  status?: string;
  items?: ServerOrderItem[];
  generalOrder?: boolean;
  createdAt?: string;
};

type PosPolicy = {
  servicePercent: number;
  vatPercent: number;
  applyDiscountBeforeTax: boolean;
  serviceBeforeVat: boolean;
};

type WorkflowSettings = {
  receiveGuestBy?: string;
  takeOrderBy?: string;
  deliverFromKitchenBy?: string;
};

function lineId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
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

export default function WaiterOrderPage() {
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
  const [dailyMenuSchedule, setDailyMenuSchedule] = useState<DailyMenuScheduleEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionOrders, setSessionOrders] = useState<ServerOrder[]>([]);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings>({});
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [billingRequestedAt, setBillingRequestedAt] = useState<string | null>(null);
  const [requestBillBusy, setRequestBillBusy] = useState(false);
  const [summonBusy, setSummonBusy] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [splitBySeat, setSplitBySeat] = useState(false);
  const [seatCheckMap, setSeatCheckMap] = useState<Record<number, number>>({});
  const [transferTargetTableId, setTransferTargetTableId] = useState("");
  const [mergeTargetTableId, setMergeTargetTableId] = useState("");
  const [sessionMoveBusy, setSessionMoveBusy] = useState(false);
  const [seatPanelOpen, setSeatPanelOpen] = useState(false);
  const seatPanelRef = useRef<HTMLDivElement | null>(null);

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
  const selectedTableStatus = normalizeTableStatus(String((selectedTable as any)?.status || ""));
  const selectedTableBlocked = selectedTableStatus === "dirty" || selectedTableStatus === "cleaning";

  const seatCount = Math.max(1, selectedTable?.seats ?? 2);
  const seatDisplayCount = Math.min(6, seatCount);

  const loadAll = useCallback(async () => {
    setMsg("");
    try {
      const [pr, gr, fp, tb, pol, promo, dmRemote, sched, ar, ks, wf] = await Promise.all([
        fetch(`${base}/api/products`),
        fetch(`${base}/api/product-groups`),
        fetch(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
        fetch(`${base}/api/restaurant/tables`),
        fetch(`${base}/api/pos/policy`),
        fetch(`${base}/api/pos/promotions?active_only=true`),
        fetchDailyMenuFromApi(),
        fetchDailyMenuSchedule(),
        fetch(`${base}/api/agents`),
        fetch(`${base}/api/restaurant/kitchen/item-stops?active_only=true`),
        fetch(`${base}/api/restaurant/workflow-settings`),
      ]);
      const pj = tryParseJson<{ products?: unknown }>(await pr.text()) ?? {};
      const gj = tryParseJson<{ groups?: unknown }>(await gr.text()) ?? {};
      const fpj = tryParseJson<{ plan?: unknown }>(await fp.text()) ?? {};
      const tj = tryParseJson<{ tables?: unknown }>(await tb.text()) ?? {};
      const polj = tryParseJson<Record<string, unknown>>(await pol.text()) ?? {};
      const promoj = tryParseJson<{ promotions?: unknown }>(await promo.text()) ?? {};
      const aj = tryParseJson<{ agents?: unknown }>(await ar.text()) ?? {};
      const ksj = tryParseJson<{ items?: unknown }>(await ks.text()) ?? {};
      const wj = tryParseJson<WorkflowSettings>(await wf.text()) ?? {};

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
      const fromUrl = searchParams.get("tableId");
      setTables(outList);

      setSelectedTableId((prev) => {
        const arr = outList;
        if (fromUrl && arr.some((x) => x.id === fromUrl)) return fromUrl;
        if (prev && arr.some((x) => x.id === prev)) return prev;
        return arr.length ? arr[0].id : "";
      });

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
        sm.set(String(s.productGuide), String(s.note || "نفد من المطبخ"));
      }
      setKitchenStoppedMap(sm);
      setAgents(alist);
      setWorkflowSettings(wj || {});
      setSelectedAgentGuid((prev) => {
        if (prev && alist.some((a) => a.CardGuide === prev)) return prev;
        const pick = alist.find((a) => {
          const n = String(a?.AgentName || "").toLowerCase();
          return n.includes("cash") || n.includes("عميل نقدي") || n.includes("نقدا") || n.includes("نقدي");
        });
        return pick?.CardGuide || alist[0]?.CardGuide || "";
      });
      setDailyMenuState(dmRemote ?? loadDailyMenuState());
      setDailyMenuSchedule(Array.isArray(sched) ? sched : []);
    } catch (e) {
      setMsg(`تعذر تحميل البيانات: ${String(e)}`);
    }
  }, [base, searchParams]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const applyToday = () => setBillDate(new Date().toISOString().slice(0, 10));
    applyToday();
    const id = window.setInterval(applyToday, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (selectedSeat > seatDisplayCount) setSelectedSeat(seatDisplayCount);
  }, [seatDisplayCount, selectedSeat]);

  useEffect(() => {
    setSeatCheckMap((prev) => {
      const next: Record<number, number> = {};
      for (let i = 1; i <= seatDisplayCount; i++) {
        next[i] = prev[i] || i;
      }
      return next;
    });
  }, [seatDisplayCount]);

  useEffect(() => {
    function onAnyPointerDown(ev: MouseEvent | TouchEvent) {
      const target = ev.target as Node | null;
      if (seatPanelRef.current && target && !seatPanelRef.current.contains(target)) {
        setSeatPanelOpen(false);
      }
    }
    window.addEventListener("mousedown", onAnyPointerDown);
    window.addEventListener("touchstart", onAnyPointerDown);
    return () => {
      window.removeEventListener("mousedown", onAnyPointerDown);
      window.removeEventListener("touchstart", onAnyPointerDown);
    };
  }, []);

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
      const receiveBy = String(workflowSettings.receiveGuestBy || "host").toLowerCase();
      if (receiveBy === "customer_self") {
        return null;
      }
      const cr = await fetch(`${base}/api/restaurant/table-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId,
          guestCount: 2,
          startedByRole: receiveBy || "host",
          startReason: "seat_assignment",
        }),
      });
      if (!cr.ok) return null;
      const rec = tryParseJson<{ id?: string }>(await cr.text());
      return rec?.id ? String(rec.id) : null;
    },
    [base, urlSessionId, workflowSettings.receiveGuestBy]
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
      return;
    }
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions?status=active`);
      const j = tryParseJson<{ sessions?: unknown }>(await r.text()) ?? {};
      const sessions = Array.isArray(j.sessions) ? j.sessions : [];
      const s = sessions.find(
        (x: { id?: string; billingRequestedAt?: string }) => String(x.id) === String(activeSessionId)
      ) as { billingRequestedAt?: string } | undefined;
      setBillingRequestedAt(s?.billingRequestedAt ? String(s.billingRequestedAt) : null);
    } catch {
      setBillingRequestedAt(null);
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
    let list = products;
    if (categoryKey !== "all") {
      list = list.filter((p) => (p.GroupGuid || "") === categoryKey);
    }
    const day = todayYmd();
    const sch = scheduleRestrictionForDate(dailyMenuSchedule, day);
    if (sch.limited && sch.allowedGuides.size > 0) {
      list = list.filter((p) => sch.allowedGuides.has(String(p.CardGuide || "").toUpperCase()));
    } else {
      const dm = dailyMenuState;
      if (dm && dm.allowedTokens.map((t) => t.trim()).filter(Boolean).length > 0) {
        list = list.filter((p) => isProductOnDailyMenu(p.CardGuide, p.ProductName, dm));
      }
    }
    return list;
  }, [products, categoryKey, dailyMenuState, dailyMenuSchedule]);

  const menuAllowedGuides = useMemo(() => {
    const day = todayYmd();
    const sch = scheduleRestrictionForDate(dailyMenuSchedule, day);
    if (sch.limited && sch.allowedGuides.size > 0) {
      return new Set(Array.from(sch.allowedGuides).map((x) => String(x).toUpperCase()));
    }
    const dm = dailyMenuState;
    if (dm && dm.allowedTokens.map((t) => t.trim()).filter(Boolean).length > 0) {
      const set = new Set<string>();
      for (const p of products) {
        if (isProductOnDailyMenu(p.CardGuide, p.ProductName, dm)) {
          set.add(String(p.CardGuide || "").toUpperCase());
        }
      }
      return set;
    }
    return null;
  }, [dailyMenuSchedule, dailyMenuState, products]);

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

  const serviceCharge = useMemo(() => {
    const baseAmount = policy.applyDiscountBeforeTax ? netBeforeTax : gross;
    return (baseAmount * policy.servicePercent) / 100;
  }, [policy.applyDiscountBeforeTax, netBeforeTax, gross, policy.servicePercent]);

  const vatValue = useMemo(() => {
    if (policy.serviceBeforeVat) {
      return ((netBeforeTax + serviceCharge) * policy.vatPercent) / 100;
    }
    return (netBeforeTax * policy.vatPercent) / 100;
  }, [policy.serviceBeforeVat, netBeforeTax, serviceCharge, policy.vatPercent]);

  const total = Math.max(0, netBeforeTax + serviceCharge + vatValue + Math.max(0, tipAmount || 0));
  const itemCount = cart.reduce((a, l) => a + l.qty, 0);
  const billingLocked = Boolean(billingRequestedAt);
  const visibleTableOrders = useMemo(
    () =>
      sessionOrders
        .filter((o) => {
          const st = String(o.status || "").toLowerCase();
          return st !== "cancelled" && st !== "paid" && st !== "served";
        })
        .slice()
        .reverse(),
    [sessionOrders]
  );
  const provisionalTableTotal = useMemo(
    () =>
      visibleTableOrders.reduce((sum, o) => {
        const orderSum = (o.items || []).reduce(
          (a, it) =>
            (it as ServerOrderItem).cancelled
              ? a
              : a + Number(it.quantity || 0) * Number(it.unitPrice || 0),
          0
        );
        return sum + orderSum;
      }, 0),
    [visibleTableOrders]
  );

  /** نفس مصدر «طلبات مُرسلة» — جلسة التسكين الحالية فقط (sessionId). */
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

  function addProduct(p: Product) {
    if (selectedTableBlocked) {
      setMsg("الطاولة غير جاهزة للطلبات (متسخة/قيد التنظيف).");
      return;
    }
    const stopNote = kitchenStoppedMap.get(p.CardGuide);
    if (stopNote) {
      setMsg(`الصنف غير متاح الآن من المطبخ: ${p.ProductName}${stopNote ? ` — ${stopNote}` : ""}`);
      return;
    }
    if (billingLocked) {
      setMsg("تم طلب الحساب — لا يمكن إضافة بنود حتى يُسدّد الكاشير.");
      return;
    }
    const seatLabel = assignmentMode === "general" ? null : `كرسي ${selectedSeat}`;
    setCart((prev) => {
      const ex = prev.find((x) => x.productGuide === p.CardGuide && x.seatLabel === seatLabel);
      if (ex) {
        return prev.map((x) =>
          x.productGuide === p.CardGuide && x.seatLabel === seatLabel ? { ...x, qty: x.qty + 1 } : x
        );
      }
      return [
        ...prev,
        {
          id: lineId(),
          productGuide: p.CardGuide,
          name: p.ProductName,
          qty: 1,
          unitPrice: p.Price || 0,
          seatLabel,
        },
      ];
    });
  }

  function setQty(lineIdStr: string, qty: number) {
    if (billingLocked) return;
    setCart((prev) =>
      prev
        .map((l) => (l.id === lineIdStr ? { ...l, qty: qty > 0 ? qty : 0 } : l))
        .filter((l) => l.qty > 0)
    );
  }

  function removeLine(lineIdStr: string) {
    if (billingLocked) return;
    setCart((prev) => prev.filter((l) => l.id !== lineIdStr));
  }

  function clearSeatLines(seatNum: number) {
    if (billingLocked) return;
    const label = `كرسي ${seatNum}`;
    setCart((prev) => prev.filter((l) => l.seatLabel !== label));
  }

  async function cancelServerLine(orderId: string, lineIdStr: string) {
    setMsg("");
    if (billingLocked) {
      setMsg("بعد طلب الحساب لا يمكن إلغاء البنود من هنا.");
      return;
    }
    if (!String(lineIdStr || "").trim()) {
      setMsg("تعذر تحديد رقم السطر — أعد التحميل.");
      return;
    }
    try {
      const r = await fetch(
        `${base}/api/restaurant/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(lineIdStr)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancelled: true }),
        }
      );
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg("تم إلغاء السطر (قبل التحضير).");
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
    if (selectedTableBlocked) {
      setMsg("الطاولة غير جاهزة للطلبات (متسخة/قيد التنظيف).");
      return;
    }
    let sessionIdForSave = activeSessionId;
    if (!sessionIdForSave) {
      if (sessionBusy) {
        setMsg("جاري تجهيز الجلسة…");
        return;
      }
      const receiveBy = String(workflowSettings.receiveGuestBy || "host").toLowerCase();
      const takeBy = String(workflowSettings.takeOrderBy || "waiter").toLowerCase();
      try {
        const cr = await fetch(`${base}/api/restaurant/table-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableId: selectedTableId,
            guestCount: 2,
            startedByRole: receiveBy === "customer_self" ? takeBy || "waiter" : receiveBy || "host",
            startReason: receiveBy === "customer_self" ? "first_order_auto_session" : "seat_assignment",
          }),
        });
        const rec = tryParseJson<{ id?: string }>(await cr.text()) ?? {};
        if (!cr.ok || !rec.id) throw new Error("تعذر إنشاء جلسة جديدة للطاولة.");
        sessionIdForSave = String(rec.id);
        setActiveSessionId(sessionIdForSave);
      } catch (e) {
        setMsg(`تعذر ربط جلسة نشطة بالطاولة: ${String(e)}`);
        return;
      }
    }
    setLoading(true);
    try {
      const items = cart.map((l) => ({
        productGuide: l.productGuide,
        menuItemId: l.productGuide,
        name: l.seatLabel ? `${l.name} (${l.seatLabel})` : l.name,
        quantity: l.qty,
        unitPrice: l.unitPrice,
      }));

      const body = {
        orderType: "table",
        sessionId: sessionIdForSave,
        tableId: selectedTableId,
        tableGuid: selectedTableId,
        tableName: selectedTable?.name || "",
        agentGuid: selectedAgentGuid || undefined,
        billDate: billDate || undefined,
        generalOrder: assignmentMode === "general",
        paymentMethod: "cash",
        postToSqlInvoice: false,
        items,
        subtotal: netBeforeTax,
        discountValue,
        serviceCharge,
        tax: vatValue,
        tipAmount: Math.max(0, tipAmount || 0),
        total,
      };

      const r = await fetch(`${base}/api/restaurant/invoices`, {
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
      const splitGroups = splitBySeat
        ? Object.entries(
          Array.from({ length: seatDisplayCount }).reduce<Record<number, number[]>>((acc, _, i) => {
            const seat = i + 1;
            const checkNo = seatCheckMap[seat] || seat;
            if (!acc[checkNo]) acc[checkNo] = [];
            acc[checkNo].push(seat);
            return acc;
          }, {})
        )
          .map(([checkNo, seats]) => ({
            id: `check-${checkNo}`,
            name: `شيك ${checkNo}`,
            seats,
          }))
          .filter((g) => g.seats.length > 0)
        : [];
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
    if (transferTargetTableId === selectedTableId) {
      setMsg("اختر طاولة مختلفة للتحويل.");
      return;
    }
    setSessionMoveBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: transferTargetTableId, actor: "waiter" }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setSelectedTableId(transferTargetTableId);
      setMsg("تم تغيير الطاولة: العميل انتقل للطاولة الجديدة (القديمة أصبحت جاهزة).");
      void loadSessionOrders();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSessionMoveBusy(false);
    }
  }

  async function mergeIntoTable() {
    setMsg("");
    if (!activeSessionId || !mergeTargetTableId) return;
    if (mergeTargetTableId === selectedTableId) {
      setMsg("اختر طاولة مختلفة للدمج.");
      return;
    }
    setSessionMoveBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(activeSessionId)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTableId: mergeTargetTableId, actor: "waiter" }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg("تم الدمج: حساب هذه الطاولة أصبح يُفوَّتر على الطاولة الهدف، مع بقاء الطاولتين مشغولتين.");
      void loadSessionOrders();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSessionMoveBusy(false);
    }
  }

  async function summonCashier() {
    setMsg("");
    if (!activeSessionId) {
      setMsg("لا توجد جلسة نشطة.");
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
    <div className="role-op waiter-pos">
      <OperationalRoleHeader
        roleTitle="✦ OYA Resturant ✦"
        hideUser
        subToolbar={
          <div className="waiter-pos__header-tools" dir="rtl">
            <span className="waiter-pos__header-tools__label">المجموعات</span>
            <button
              type="button"
              className={`waiter-pos__cat-text ${categoryKey === "all" ? "waiter-pos__cat-text--active" : ""}`}
              onClick={() => setCategoryKey("all")}
              title="كل المجموعات"
            >
              الكل
            </button>
            {normalizedGroups.map((g) => (
              <button
                key={`hdr-cat-${g.CardGuide}`}
                type="button"
                className={`waiter-pos__cat-text ${categoryKey === g.CardGuide ? "waiter-pos__cat-text--active" : ""}`}
                onClick={() => setCategoryKey(g.CardGuide)}
                title={g.GroupName}
              >
                {g.GroupName}
              </button>
            ))}
            <span className="waiter-pos__tool-sep" aria-hidden>
              |
            </span>
            <span className="waiter-pos__header-tools__label">انتقل</span>
            <button type="button" className="waiter-pos__nav-text" onClick={() => navigate("/app/waiter/dashboard")}>
              لوحة الصالة
            </button>
            <button type="button" className="waiter-pos__nav-text" onClick={() => navigate("/app/waiter/tables")}>
              الطاولات
            </button>
            <button type="button" className="waiter-pos__nav-text" onClick={() => navigate("/app/waiter/order-taker")}>
              طلب للطاولة
            </button>
            <button type="button" className="waiter-pos__nav-text" onClick={() => navigate("/app/waiter/pos")}>
              طلب سريع (بار)
            </button>
          </div>
        }
        titleStyle={{
          fontSize: "2rem",
          fontWeight: 900,
          lineHeight: 1,
          top: 8,
          position: "absolute",
          left: "47.5%",
          transform: "translate(-50%, 5mm)",
          fontStyle: "italic",
          letterSpacing: "0.03em",
          fontFamily: "'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', cursive",
          color: "#e879f9",
          textShadow: "0 0 7px rgba(232,121,249,0.95), 0 0 14px rgba(217,70,239,0.7)",
          borderBottom: "2px solid rgba(232,121,249,0.85)",
          paddingBottom: 2,
          whiteSpace: "nowrap",
          zIndex: 2,
        }}
        onBack={() => navigate("/app/waiter/tables")}
        rightSlot={
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, direction: "ltr", minWidth: 0, width: "100%", justifyContent: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 280 }}>
              <span style={{ fontSize: "0.68rem", fontWeight: 900, color: "#fb923c", textShadow: "0 0 8px rgba(251,146,60,0.7)", whiteSpace: "nowrap", lineHeight: 1 }}>
                © 2026 جميع الحقوق محفوظة لشركة Sir Consult for Information Technology
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, width: "100%", transform: "translateY(3mm)" }}>
                <select
                  className="waiter-pos__select"
                  value={selectedAgentGuid}
                  onChange={(e) => setSelectedAgentGuid(e.target.value)}
                  aria-label="اسم العميل"
                  style={{ minWidth: 140, width: "100%", fontSize: "0.9rem", fontWeight: 700, padding: "0.45rem 0.6rem", textAlign: "right" }}
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
                  style={{ minWidth: 120, width: "100%", fontSize: "0.9rem", fontWeight: 700, padding: "0.45rem 0.6rem", borderRadius: 8, border: "1px solid #1e40af", background: "#fff", color: "#0f172a" }}
                />
              </div>
              <select
                className="waiter-pos__select"
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                aria-label="اختيار الطاولة"
                style={{ minWidth: 140, width: "clamp(140px, 22vw, 320px)", maxWidth: "100%", fontSize: "1.05rem", fontWeight: 800, padding: "0.6rem 0.9rem", transform: "translateY(3mm)", textAlign: "center", flexShrink: 0 }}
              >
                {tables.length === 0 ? (
                  <option value="" disabled>لا توجد طاولات — تحقق من TBL005 أو مزامنة المخطط</option>
                ) : (
                  tables.map((t) => (
                    <option key={t.id} value={t.id} disabled={["dirty", "cleaning"].includes(normalizeTableStatus(String((t as any).status || "")))}>
                      {t.name || `طاولة ${t.number ?? ""}`}{["dirty", "cleaning"].includes(normalizeTableStatus(String((t as any).status || ""))) ? " (غير جاهزة)" : ""}
                    </option>
                  ))
                )}
              </select>
            </div>
            <button
              type="button"
              className="waiter-pos__close"
              onClick={() => navigate("/app/waiter/tables")}
              aria-label="إغلاق"
              style={{ background: "#dc2626", color: "#fff", border: "1px solid #b91c1c", height: 44, width: 44, fontSize: "1.3rem", borderRadius: 10, transform: "translateY(3mm)" }}
            >
              ×
            </button>
          </div>
        }
      />

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
              طلبات الجلسة الحالية: {visibleTableOrders.length}
            </span>
            <span style={{ padding: "6px 11px", borderRadius: 999, background: "#fef3c7", color: "#92400e", fontWeight: 700 }}>
              مطبخ قيد التجهيز: {visibleTableOrders.filter((o: any) => ["pending", "preparing"].includes(String(o?.status || "").toLowerCase())).length}
            </span>
            <span style={{ padding: "6px 11px", borderRadius: 999, background: "#ffe4e6", color: "#9f1239", fontWeight: 700 }}>
              طلب حساب: {billingLocked ? "نعم" : "لا"}
            </span>
            <span style={{ padding: "6px 11px", borderRadius: 999, background: "#e2e8f0", color: "#1e293b", fontWeight: 700 }}>
              فاتورة مرحلية للجلسة الحالية: {provisionalTableTotal.toFixed(2)} ج.م
            </span>
          </div>
          <div style={{ marginTop: "0.6rem" }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: "0.88rem" }}>طلبات الجلسة الحالية</div>
            {visibleTableOrders.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>لا توجد طلبات مرسلة بعد.</div>
            ) : (
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                {visibleTableOrders.map((o) => {
                    const st = String(o.status || "").toLowerCase();
                    const items = (o.items || []).map((i) => `${i.name || "صنف"} ×${i.quantity ?? 1}`).slice(0, 3);
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
                        <div style={{ fontSize: "0.84rem", fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>
                          {o.id.slice(0, 8)} · {st} {o.generalOrder ? "· عام" : ""}
                        </div>
                        <div style={{ fontSize: "0.9rem", color: "#334155", lineHeight: 1.6 }}>
                          {items.length ? items.join(" · ") : "بدون تفاصيل بنود"}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="waiter-pos__body">
        <main className="waiter-pos__main">
          <div className="waiter-pos__topbar">
            <div className="waiter-pos__top-card" style={{ gridColumn: "span 2" }}>
              <h3 style={{ marginTop: 0 }}>خيارات الطاولات</h3>
              <div className="waiter-pos__split-box">
                <div className="waiter-pos__dropdown-wrap" style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select className="waiter-pos__select" value={transferTargetTableId} onChange={(e) => setTransferTargetTableId(e.target.value)} style={{ flex: 1, maxWidth: "none" }}>
                      {tables.filter((t) => t.id !== selectedTableId).map((t) => (
                        <option key={`tr-top-${t.id}`} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" disabled={!activeSessionId || sessionMoveBusy || !transferTargetTableId} onClick={() => void transferTable()}>
                      تغيير الطاولة
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select className="waiter-pos__select" value={mergeTargetTableId} onChange={(e) => setMergeTargetTableId(e.target.value)} style={{ flex: 1, maxWidth: "none" }}>
                      {tables.filter((t) => t.id !== selectedTableId).map((t) => (
                        <option key={`mg-top-${t.id}`} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" disabled={!activeSessionId || sessionMoveBusy || !mergeTargetTableId} onClick={() => void mergeIntoTable()}>
                      دمج
                    </button>
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, marginTop: 2 }}>
                    <input type="checkbox" checked={splitBySeat} onChange={(e) => setSplitBySeat(e.target.checked)} disabled={billingLocked} />
                    سبليت شيك حسب الكراسي
                  </label>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  className="waiter-pos__btn waiter-pos__btn--ghost"
                  style={{ fontSize: "0.8rem", padding: "6px 8px" }}
                  onClick={() => setShowSummary((prev) => !prev)}
                >
                  {showSummary ? "إخفاء التقرير" : "تقرير الطاولة"}
                </button>
                <button
                  type="button"
                  className="waiter-pos__btn waiter-pos__btn--ghost"
                  style={{ fontSize: "0.8rem", padding: "6px 8px" }}
                  disabled={summonBusy || !activeSessionId}
                  onClick={() => void summonCashier()}
                >
                  {summonBusy ? "…" : "استدعاء كاشير"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="waiter-pos__btn"
                  style={{
                    padding: "10px 12px",
                    fontSize: "1rem",
                    fontWeight: 900,
                    background: "linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%)",
                    color: "#fff",
                    border: "1px solid #0369a1",
                  }}
                  disabled={requestBillBusy || !activeSessionId || billingLocked}
                  onClick={() => void requestBill()}
                >
                  {requestBillBusy ? "…" : "طلب الحساب"}
                </button>
                <input
                  className="waiter-pos__coupon"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="قيمة الكوبون"
                  disabled={billingLocked}
                  style={{ marginTop: 0, background: "#fff", color: "#0f172a", borderColor: "#94a3b8", padding: "10px 12px", fontSize: "0.95rem", fontWeight: 700 }}
                />
              </div>
            </div>

            <div className="waiter-pos__top-card" style={{ order: 99 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontWeight: 900 }}>{selectedTable?.name ?? "طاولة"}</div>
              </div>
              <div style={{ color: "var(--wp-muted)", marginTop: 2, fontSize: "0.78rem", lineHeight: 1.25 }}>عنصر {itemCount}</div>
              {activeSessionId ? (
                <div style={{ color: "var(--wp-muted)", marginTop: 0, fontSize: "0.72rem", lineHeight: 1.25 }} title={activeSessionId}>
                  جلسة: {activeSessionId.slice(0, 8)}…
                </div>
              ) : null}
              {activeSessionId ? (
                <div className="waiter-pos__table-kitchen-strip">
                  <div className="waiter-pos__table-kitchen-strip__title">موقف الطلبات بالمطبخ (جلسة التسكين الحالية)</div>
                  <div
                    className="waiter-pos__table-kitchen-strip__counts"
                    title="نفس طلبات الجلسة الحالية المرسلة للمطبخ — حسب حالة التذكرة"
                  >
                    انتظار {sessionKitchenStats.pending} · تحضير {sessionKitchenStats.preparing} · جاهز {sessionKitchenStats.ready}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="waiter-pos__top-card">
              <h3 style={{ marginTop: 0 }}>قيد الإرسال</h3>
              <div className="waiter-pos__order-box">
                {cart.length === 0 ? <div style={{ color: "var(--wp-muted)", fontSize: "0.9rem" }}>لا توجد عناصر</div> : cart.map((l) => (
                  <div key={`top-line-${l.id}`} className="waiter-pos__order-line">
                    <div>{l.name}</div>
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
                  background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                  color: "#fff",
                  border: "1px solid #15803d",
                }}
                disabled={loading || billingLocked}
                onClick={() => void submitSale()}
              >
                {loading ? "..." : "إرسال الطلب"}
              </button>
            </div>

            <div className="waiter-pos__top-card">
              <h3 style={{ marginTop: 0 }}>توزيع الطلب</h3>
              <div className="waiter-pos__toggle-row">
                <button type="button" className={`waiter-pos__toggle ${assignmentMode === "per_seat" ? "waiter-pos__toggle--on" : ""}`} onClick={() => setAssignmentMode("per_seat")}>
                  لكل كرسي
                </button>
                <button type="button" className={`waiter-pos__toggle ${assignmentMode === "general" ? "waiter-pos__toggle--on" : ""}`} onClick={() => setAssignmentMode("general")}>
                  طلب عام (للجميع)
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" onClick={() => setSeatPanelOpen((v) => !v)} style={{ flex: 1 }}>
                  {seatPanelOpen ? "إخفاء الكراسي" : "إظهار الكراسي"}
                </button>
              </div>
              {assignmentMode === "per_seat" && (
                <div ref={seatPanelRef} className="waiter-pos__dropdown-wrap" style={{ display: seatPanelOpen ? "block" : "none" }}>
                  <div className="waiter-pos__seats">
                    {Array.from({ length: seatDisplayCount }).map((_, i) => {
                      const n = i + 1;
                      const seatLines = cart.filter((l) => l.seatLabel === `كرسي ${n}`);
                      return (
                        <div key={`top-seat-${n}`} className="waiter-pos__seat-wrap">
                          <button type="button" className={`waiter-pos__seat ${selectedSeat === n ? "waiter-pos__seat--sel" : ""}`} onClick={() => setSelectedSeat(n)}>
                            <span aria-hidden>🪑</span> كرسي {n}
                            {seatLines.length > 0 ? <span className="waiter-pos__seat-badge">{seatLines.reduce((a, l) => a + l.qty, 0)}</span> : null}
                          </button>
                          {seatLines.length > 0 ? (
                            <button type="button" className="waiter-pos__seat-clear" onClick={() => clearSeatLines(n)}>×</button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="waiter-pos__top-card">
              <div className="waiter-pos__sent">
                <h4
                  style={{ margin: 0, fontSize: "0.88rem", fontWeight: 800, flexShrink: 0, lineHeight: 1.3 }}
                  title="ما أُرسل فعليًا للمطبخ في هذه الجلسة — مرّر للأعلى/للأسفل عند كثرة الأصناف"
                >
                  طلبات مُرسلة <span style={{ fontWeight: 600, color: "var(--wp-muted, #94a3b8)", fontSize: "0.8rem" }}>(فاتورة مرحلية — الجلسة الحالية)</span>
                </h4>
                {ordersBusy && !sessionOrders.length ? (
                  <div style={{ color: "var(--wp-muted)", fontSize: "0.85rem" }}>جاري التحميل…</div>
                ) : visibleTableOrders.length === 0 ? (
                  <div style={{ color: "var(--wp-muted)", fontSize: "0.85rem" }}>لا توجد بعد.</div>
                ) : (
                  <div className="waiter-pos__sent-scroll">
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {visibleTableOrders.map((o) => {
                        const st = (o.status || "").toLowerCase();
                        const orderTotal = (o.items || []).reduce(
                          (a, it) => ((it as ServerOrderItem).cancelled ? a : a + Number(it.quantity || 0) * Number(it.unitPrice || 0)),
                          0
                        );
                        const lines = (o.items || []).filter(
                          (it) => it && (String(it.name || "").trim() || (it.quantity ?? 0) > 0)
                        );
                        return (
                          <li
                            key={`sent-top-${o.id}`}
                            style={{
                              borderBottom: "1px solid rgba(15,23,42,0.12)",
                              padding: "6px 0 8px",
                              fontSize: "0.82rem",
                              color: "#cbd5e1",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                                <div>
                                  <strong style={{ color: "#fff" }}>{o.id.slice(0, 8)}</strong> · {st} · {orderTotal.toFixed(2)} ج.م
                                </div>
                                {lines.length > 0 ? (
                                  <ul className="waiter-pos__sent-lineitems">
                                    {lines.map((it, idx) => {
                                      const row = it as ServerOrderItem;
                                      const isCancelled = Boolean(row.cancelled);
                                      const canLineCancel =
                                        !billingLocked && !isCancelled && !row.prepared && !row.sent && String(row.lineId || "").trim() !== "";
                                      const nm = String(row.name || "صنف").trim() || "صنف";
                                      const q = Number(row.quantity || 0);
                                      const up = Number(row.unitPrice || 0);
                                      const sub = q * up;
                                      const qStr = q % 1 === 0 ? String(q) : String(parseFloat(q.toFixed(2)));
                                      const hasUnit = up > 0;
                                      const amtLabel = hasUnit
                                        ? `${(Math.abs(sub - Math.round(sub)) < 0.01 ? Math.round(sub) : parseFloat(sub.toFixed(2)))} ج.م`
                                        : "—";
                                      return (
                                        <li key={row.lineId || `${o.id}-ln-${idx}`} className="waiter-pos__sent-line">
                                          <div className="waiter-pos__sent-line__row">
                                            <div className="waiter-pos__sent-line__main" style={isCancelled ? { opacity: 0.6, textDecoration: "line-through" } : undefined}>
                                              <span className="waiter-pos__sent-line__name">
                                                <span style={{ color: "#e2e8f0" }}>{nm}{isCancelled ? " (مُلغى)" : ""}</span>
                                                <span style={{ color: "#64748b" }}> ×{qStr}</span>
                                              </span>
                                              <span
                                                className="waiter-pos__sent-line__amt"
                                                title={up > 0 ? `سعر ${up.toFixed(2)}` : "سعر غير مُسجّل في التذكرة"}
                                              >
                                                {amtLabel}
                                              </span>
                                            </div>
                                            {!isCancelled ? (
                                              <label
                                                className="waiter-pos__sent-line__cancel"
                                                style={{
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  gap: 4,
                                                  opacity: canLineCancel ? 1 : 0.55,
                                                  flex: "0 0 auto",
                                                  marginTop: 2,
                                                }}
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={false}
                                                  disabled={!canLineCancel}
                                                  onChange={() => void cancelServerLine(o.id, String(row.lineId))}
                                                />
                                                <span
                                                  style={{
                                                    fontSize: "0.7rem",
                                                    color: canLineCancel ? "#fca5a5" : "#94a3b8",
                                                    lineHeight: 1.2,
                                                    maxWidth: 120,
                                                  }}
                                                >
                                                  {canLineCancel ? "إلغاء قبل التحضير" : "لا إلغاء بعد بدء التحضير"}
                                                </span>
                                              </label>
                                            ) : null}
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : (
                                  <div style={{ fontSize: "0.74rem", color: "var(--wp-muted)", marginTop: 4 }}>— تفاصيل الأصناف غير مُحفوظة على التذكرة</div>
                                )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
              <div className="waiter-pos__footer-totals waiter-pos__footer-totals--tight">
                <div className="waiter-pos__footer-totals__stack">
                  <div style={{ color: "#0f172a", fontSize: "0.86rem", fontWeight: 700, lineHeight: 1.2, margin: 0 }}>خدمة {policy.servicePercent}%: {serviceCharge.toFixed(2)}</div>
                  <div style={{ color: "#0f172a", fontSize: "0.86rem", fontWeight: 700, lineHeight: 1.2, margin: 0 }}>VAT {policy.vatPercent}%: {vatValue.toFixed(2)}</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 0,
                      color: "#0f172a",
                      fontSize: "0.86rem",
                      fontWeight: 700,
                      lineHeight: 1.2,
                    }}
                  >
                    <span>بقشيش:</span>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={tipAmount}
                      onChange={(e) => setTipAmount(Math.max(0, Number(e.target.value) || 0))}
                      style={{ width: 80, padding: "4px 6px", borderRadius: 6, border: "1px solid #94a3b8", background: "#ffffff", color: "#0f172a", fontSize: "0.85rem", fontWeight: 800 }}
                    />
                  </div>
                  <div style={{ fontWeight: 900, marginTop: 0, color: "#0b3b2e", fontSize: "0.9rem", lineHeight: 1.2 }}>الإجمالي: {total.toFixed(2)} ج.م</div>
                </div>
                <div className="waiter-pos__actions" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  <button
                    type="button"
                    className="waiter-pos__btn"
                    style={{
                      padding: "6px 12px",
                      fontSize: "0.9rem",
                      fontWeight: 900,
                      background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                      color: "#fff",
                      border: "1px solid #15803d",
                    }}
                    onClick={() => {
                      void loadAll();
                      void loadSessionOrders();
                    }}
                  >
                    تحديث
                  </button>
                </div>
              </div>
              {msg && <div className="waiter-pos__msg" style={{ fontSize: "0.7rem", padding: "4px" }}>{msg}</div>}
            </div>
          </div>
          <div className="waiter-pos__search-wrap" style={{ marginBottom: "0.5rem" }}>
            <SmartProductSearch
              onSelect={(hit) => {
                const p = products.find((x) => String(x.CardGuide) === String(hit.CardGuide));
                if (!p) {
                  setMsg("الصنف غير متاح في قائمة الأصناف الحالية.");
                  return;
                }
                const allowedInMenu = menuAllowedGuides ? menuAllowedGuides.has(String(p.CardGuide || "").toUpperCase()) : true;
                if (!allowedInMenu) {
                  setMsg(`الصنف "${p.ProductName}" ظاهر في البحث لكنه خارج المنيو الحالي، لذلك لن يضاف للطلب.`);
                  return;
                }
                addProduct({
                  CardGuide: p.CardGuide,
                  ProductName: p.ProductName,
                  Price: Number(p.Price || 0),
                });
              }}
              getContext={(hit) => {
                const p = products.find((x) => String(x.CardGuide) === String(hit.CardGuide));
                if (!p) return null;
                const groupName = p.GroupGuid ? groupNameById.get(p.GroupGuid) || "غير مصنّف" : "غير مصنّف";
                const inMenu = menuAllowedGuides ? menuAllowedGuides.has(String(p.CardGuide || "").toUpperCase()) : true;
                const stopNote = kitchenStoppedMap.get(p.CardGuide);
                return {
                  title: `تقرير صنف: ${p.ProductName}`,
                  lines: [
                    `المجموعة: ${groupName}`,
                    `داخل المنيو الحالي: ${inMenu ? "نعم" : "لا"}`,
                    `حالة المطبخ: ${stopNote ? `موقوف الآن (${stopNote})` : "متاح"}`,
                    `سعر البيع: ${Number(p.Price || 0).toFixed(2)} ج.م`,
                    `الدليل: ${p.CardGuide}`,
                  ],
                };
              }}
              placeholder="ابحث سريعًا باسم الصنف أو جزء منه… (Enter لإضافة أول نتيجة)"
            />
          </div>
          <div className="waiter-pos__section-divider" />

          <div className="waiter-pos__grid">
            {filteredProducts.map((p) => {
              const stopped = kitchenStoppedMap.has(p.CardGuide);
              const stopNote = kitchenStoppedMap.get(p.CardGuide) || "نفد من المطبخ";
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
                  onClick={() => addProduct(p)}
                  style={{ opacity: stopped ? 0.55 : 1, position: "relative" }}
                  title={stopped ? stopNote : undefined}
                >
                  {stopped ? (
                    <div style={{ position: "absolute", top: 6, left: 6, zIndex: 3, background: "#b91c1c", color: "#fff", borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 800 }}>
                      Out of Stock
                    </div>
                  ) : null}
                  <div className="waiter-pos__ribbon">{Math.round((p.Price || 0) * (1 + SERVICE_RATE_FOR_CARD_PRICE))} ج.م</div>
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
    </div>
  );
}
