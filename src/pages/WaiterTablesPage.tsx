import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { roleHasManagerOpsAccess } from "../auth/roles";
import { repairArabicDisplayText } from "../auth/displayUser";
import { getApiBase } from "../lib/apiBase";
import { buildMat3amActor } from "../lib/mat3amActor";
import { InlinePinConfirm } from "../components/InlinePinConfirm";
import { tryParseJson } from "../lib/tryParseJson";
import { briefNetworkHint, safeFetch } from "../lib/safeFetch";
import { buildSegmentedTablesFromFloorPlan, type SegmentedTableRow } from "../lib/restaurantTableView";
import { fetchOperationalSnapshot, RESTAURANT_POLL_MS } from "../lib/restaurantOperationalSnapshot";
import {
  effectiveTableIdsForUser,
  normalizeAssignedTableId,
  normalizeTempCaptainTransfers,
  normalizeWaiterTableAssignments,
  type TempCaptainTransferRow,
  waiterTableAssignmentRestrictionApplies,
} from "../lib/waiterTableAssignments";
import "../styles/operationalRoles.css";

type RestTable = SegmentedTableRow;
type AlertPreset = { id: string; type: string; label: string };
type TableSession = {
  id?: string;
  tableId?: string;
  startTime?: string;
  status?: string;
  billingRequestedAt?: string;
  captainUserId?: string;
  captainLogin?: string;
  captainName?: string;
  captainRole?: string;
  captainClaimedAt?: string;
  guestCount?: number | string;
  minimumChargePerSeat?: number | string;
  noOrderSnoozedUntil?: string;
  noOrderSnoozeCount?: number;
  noOrderWatchStage?: string;
  noOrderEscalatedAt?: string;
  noOrderFinalAlertAt?: string;
  linkedOrderCount?: number;
  guestSession?: boolean;
  guestApprovalPending?: boolean;
  customerType?: string;
  customerTypeLocked?: boolean;
  billingProfile?: {
    active?: boolean;
    source?: string;
    vipTemplateId?: string;
    vipAgentGuid?: string;
    vipOwnerLabel?: string;
  };
};
type StaffUser = { id: string; login: string; name: string; role: string; isActive?: boolean };
type VipTemplate = { id: string; label: string; active: boolean; agentGuid: string };
type OwnersVipAgent = { CardGuide: string; AgentName: string };
type OrderItem = { name?: string; quantity?: number; unitPrice?: number };
type OrderRow = {
  id?: string;
  tableId?: string;
  sessionId?: string;
  createdAt?: string;
  status?: string;
  items?: OrderItem[];
  kitchenTotals?: { total?: number };
};
type GuestApprovalRequestRow = {
  id?: string;
  sessionId?: string;
  status?: string;
  type?: string;
};
type TableReport = {
  tableName: string;
  sessionId: string | null;
  startTime: string | null;
  captainName: string | null;
  guestCount: number;
  minimumChargePerSeat: number;
  orderCount: number;
  qtyTotal: number;
  qtyArrived: number;
  qtyKitchen: number;
  pendingCount: number;
  preparingCount: number;
  readyCount: number;
  servedCount: number;
  cancelledCount: number;
  totalCost: number;
  pendingCost: number;
  noOrderDelayMinutes?: number;
  guestSession?: boolean;
  lines: Array<{
    id: string;
    time: string;
    status: string;
    qty: number;
    total: number;
    items: Array<{ name: string; quantity: number; unitPrice: number }>;
  }>;
};

export default function WaiterTablesPage() {
  const base = getApiBase();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [tables, setTables] = useState<RestTable[]>([]);
  const [sessionByTable, setSessionByTable] = useState<Map<string, string>>(() => new Map());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [billReqIds, setBillReqIds] = useState<Set<string>>(() => new Set());
  const [msg, setMsg] = useState("");
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [report, setReport] = useState<TableReport | null>(null);
  const [policy, setPolicy] = useState({ servicePercent: 12, vatPercent: 14, serviceBeforeVat: true });
  const [exclusiveOn, setExclusiveOn] = useState(false);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [reassignSid, setReassignSid] = useState<string | null>(null);
  const [reassignPickId, setReassignPickId] = useState("");
  const [claimBusyTableId, setClaimBusyTableId] = useState<string>("");
  const [reassignBusy, setReassignBusy] = useState(false);
  const [alertPresets, setAlertPresets] = useState<AlertPreset[]>([]);
  const [alertPickByTable, setAlertPickByTable] = useState<Record<string, string>>({});
  const [alertBusyByTable, setAlertBusyByTable] = useState<Record<string, boolean>>({});
  const [minChargeDraftByTable, setMinChargeDraftByTable] = useState<Record<string, string>>({});
  const [minChargeBusyByTable, setMinChargeBusyByTable] = useState<Record<string, boolean>>({});
  const [customerTypeByTable, setCustomerTypeByTable] = useState<Record<string, string>>({});
  const [guestApprovalRequestBySession, setGuestApprovalRequestBySession] = useState<Record<string, string>>({});
  const [guestApprovalBusySessionId, setGuestApprovalBusySessionId] = useState<string>("");
  const [vipTemplates, setVipTemplates] = useState<VipTemplate[]>([]);
  const [ownersVipAgents, setOwnersVipAgents] = useState<OwnersVipAgent[]>([]);
  const [vipChoiceBySession, setVipChoiceBySession] = useState<Record<string, string>>({});
  const [vipBusySessionId, setVipBusySessionId] = useState<string>("");
  const [captainTransferBusySessionId, setCaptainTransferBusySessionId] = useState<string>("");
  const [noOrderBusySessionId, setNoOrderBusySessionId] = useState<string>("");
  const [tableResetBusyId, setTableResetBusyId] = useState<string>("");
  const [tempCaptainTransfers, setTempCaptainTransfers] = useState<TempCaptainTransferRow[]>([]);
  const [tableJumpQuery, setTableJumpQuery] = useState("");
  const [tableJumpHighlightId, setTableJumpHighlightId] = useState<string | null>(null);
  const tableCardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  /**
   * قالب صالح للعرض = مفعّل **و** عنده ما يميّزه (اسم محدد أو عميل مربوط).
   * صفوف بلا اسم وبلا agentGuid هي مسودات إعدادات لم تُكمَل، ولن يقبلها الخادم؛
   * لذا نُسقطها من الدروب داون لتفادي بنود مكرّرة بنص «Owner/VIP» العام.
   */
  const activeVipTemplates = useMemo(
    () =>
      vipTemplates.filter(
        (x) => x.active && (String(x.label || "").trim() !== "" || String(x.agentGuid || "").trim() !== ""),
      ),
    [vipTemplates],
  );

  /** أي عميل مربوط بقالب نشط لا يُعرَض ثانية تحت «عملاء ملاك» لتجنّب التكرار */
  const templateLinkedAgentGuids = useMemo(() => {
    const s = new Set<string>();
    for (const t of activeVipTemplates) {
      const g = String(t.agentGuid || "").trim().toUpperCase();
      if (g) s.add(g);
    }
    return s;
  }, [activeVipTemplates]);

  const ownersVipAgentsDeduped = useMemo(
    () => ownersVipAgents.filter((a) => !templateLinkedAgentGuids.has(a.CardGuide)),
    [ownersVipAgents, templateLinkedAgentGuids],
  );

  const tempTransferByTable = useMemo(() => {
    const out = new Map<string, TempCaptainTransferRow>();
    for (const row of tempCaptainTransfers) {
      const tid = normalizeAssignedTableId(row.tableId);
      if (!tid) continue;
      out.set(tid, row);
    }
    return out;
  }, [tempCaptainTransfers]);

  function isTodayIso(iso?: string): boolean {
    if (!iso) return false;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return false;
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }

  function diffMinutesFromIso(iso?: string): number {
    if (!iso) return 0;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  }

  function sessionRecencyValue(row: TableSession | null | undefined): string {
    return String(row?.startTime || "").trim();
  }

  function compareSessionRecencyDesc(a: TableSession, b: TableSession): number {
    return sessionRecencyValue(b).localeCompare(sessionRecencyValue(a));
  }

  const jumpToTableCard = useCallback(() => {
    const raw = tableJumpQuery.trim();
    if (!raw) {
      setMsg("اكتب رقم الطاولة أو جزءاً من اسمها للانتقال.");
      return;
    }
    const q = raw.toLowerCase();
    let found: RestTable | null = null;
    for (const row of tables) {
      if (row.isSeparator) continue;
      const name = String(row.name || "").trim().toLowerCase();
      const numStr = row.number != null ? String(row.number).trim() : "";
      if (name && (name === q || name.includes(q))) {
        found = row;
        break;
      }
      if (numStr) {
        if (q === numStr.toLowerCase()) {
          found = row;
          break;
        }
        const hash = `#${numStr}`.toLowerCase();
        if (q === hash || (raw.startsWith("#") && q.slice(1) === numStr.toLowerCase())) {
          found = row;
          break;
        }
      }
    }
    if (!found) {
      setMsg(`لا طاولة مطابقة لـ «${raw}». جرّب الرقم أو الاسم الظاهر على الشريحة.`);
      return;
    }
    setMsg("");
    const id = String(found.id);
    const el = tableCardRefs.current.get(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTableJumpHighlightId(id);
    window.setTimeout(() => {
      setTableJumpHighlightId((cur) => (cur === id ? null : cur));
    }, 1400);
  }, [tableJumpQuery, tables]);

  function normalizeTableStatus(raw: string): "ready" | "occupied" | "reserved" | "dirty" | "cleaning" {
    const s = String(raw || "").toLowerCase().trim();
    if (["available", "free", "open", "ready", "متاحة", "جاهزة"].includes(s)) return "ready";
    if (["occupied", "busy", "مشغولة"].includes(s)) return "occupied";
    if (["reserved", "محجوزة"].includes(s)) return "reserved";
    if (["dirty", "متسخة"].includes(s)) return "dirty";
    if (["cleaning", "تنظيف"].includes(s)) return "cleaning";
    return "ready";
  }

  const loadTables = useCallback(async () => {
    const needUsers = roleHasManagerOpsAccess(user?.role);

    const applyLoadedPayload = (
      fpj: Record<string, unknown>,
      jt: Record<string, unknown>,
      js: Record<string, unknown>,
      oj: Record<string, unknown>,
      wfj: Record<string, unknown>,
      opsj: Record<string, unknown>,
      assignmentRowsRaw: unknown,
      tempTransfersRaw: unknown,
      hint?: string,
    ) => {
      const ex = String((wfj as { orderTakerExclusiveTable?: string })?.orderTakerExclusiveTable || "").toLowerCase();
      const exclusiveEnabled = ex === "on" || ex === "1" || ex === "true" || ex === "yes";
      setExclusiveOn(exclusiveEnabled);

      try {
        const raw = String((opsj as { vipOwnerTemplatesJson?: unknown })?.vipOwnerTemplatesJson || "").trim();
        const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
        const rows = (Array.isArray(arr) ? arr : [])
          .filter((x) => x && typeof x === "object")
          .map((x) => {
            const row = x as Record<string, unknown>;
            const id = String(row.id || "").trim();
            const agentGuid = String(row.agentGuid || "").trim().toUpperCase();
            const label = String(row.label || "").trim();
            const active = row.isActive !== false;
            return { id, label, active, agentGuid };
          })
          .filter((x) => x.id);
        setVipTemplates(rows);
      } catch {
        setVipTemplates([]);
      }

      try {
        const raw = String((opsj as { tableCashierAlertPresetsJson?: unknown })?.tableCashierAlertPresetsJson || "").trim();
        const arr = raw ? (JSON.parse(raw) as unknown) : [];
        const out: AlertPreset[] = [];
        if (Array.isArray(arr)) {
          for (const x of arr) {
            const row = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
            const id = String(row.id || "").trim();
            const type = String(row.type || "").trim().toLowerCase();
            const label = String(row.label || "").trim();
            if (!id || !type || !label) continue;
            out.push({ id, type, label });
          }
        }
        setAlertPresets(out);
      } catch {
        setAlertPresets([]);
      }

      try {
        const svc = Number((opsj as Record<string, unknown>)["servicePercent"] ?? 12);
        const vat = Number((opsj as Record<string, unknown>)["vatPercent"] ?? 14);
        const before = Boolean((opsj as Record<string, unknown>)["serviceBeforeVat"] ?? true);
        setPolicy({ servicePercent: Number.isFinite(svc) ? svc : 12, vatPercent: Number.isFinite(vat) ? vat : 14, serviceBeforeVat: before });
      } catch {
        setPolicy({ servicePercent: 12, vatPercent: 14, serviceBeforeVat: true });
      }

      const apiTables: RestTable[] = Array.isArray(jt["tables"]) ? (jt["tables"] as RestTable[]) : [];
      const assignmentRows = normalizeWaiterTableAssignments(assignmentRowsRaw);
      const tempTransfers = normalizeTempCaptainTransfers(tempTransfersRaw);
      setTempCaptainTransfers(tempTransfers);
      const assignedIds = effectiveTableIdsForUser({
        assignmentRows,
        tempTransfers,
        userId: String(user?.id || ""),
      });
      const assignmentRestricted = waiterTableAssignmentRestrictionApplies({
        rows: assignmentRows,
        tempTransfers,
        userId: String(user?.id || ""),
        userRole: user?.role,
        exclusiveOn: exclusiveEnabled,
      });
      const visibleTables = assignmentRestricted
        ? apiTables.filter((t) => assignedIds.has(normalizeAssignedTableId(t?.id)))
        : apiTables;
      const effectiveHint =
        assignmentRestricted && visibleTables.length === 0 && apiTables.length > 0
          ? "لا توجد طاولات مخصصة لك في هذه الفترة. راجع المدير أو شاشة التوزيع."
          : hint || "";
      setMsg(effectiveHint);
      const planRaw = fpj["plan"];
      const statusById = new Map<string, string>();
      for (const t of visibleTables as any[]) statusById.set(String(t?.id || ""), normalizeTableStatus(String(t?.status || "")));
      setTables(
        buildSegmentedTablesFromFloorPlan(planRaw, visibleTables).map((t: any) => ({
          ...t,
          status: statusById.get(String(t?.id || "")) || normalizeTableStatus(String(t?.status || "")),
          noOrderOverdue: Boolean((visibleTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.noOrderOverdue),
          noOrderMinutes: Number((visibleTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.noOrderMinutes || 0),
          cleanupOverdue: Boolean((visibleTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.cleanupOverdue),
        })),
      );

      setMinChargeDraftByTable((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const t of visibleTables as any[]) {
          const tid = String(t?.id || "").trim();
          if (!tid) continue;
          const mc = Number(t?.minimumCharge ?? 0);
          next[tid] = Number.isFinite(mc) ? String(Math.max(0, mc)) : "0";
        }
        return next;
      });
      const m = new Map<string, string>();
      const sessions = ((Array.isArray(js["sessions"]) ? js["sessions"] : []).filter((s: unknown) =>
        isTodayIso(String((s as TableSession)?.startTime || "")),
      ) as TableSession[]).slice().sort(compareSessionRecencyDesc);
      setSessions(sessions);
      for (const s of sessions) {
        const st = String(s?.status || "").toLowerCase();
        const tid = s?.tableId != null ? String(s.tableId) : "";
        const sid = s?.id != null ? String(s.id) : "";
        // نحتفظ بأحدث session فقط لكل طاولة حتى لو تغيّر ترتيب الـ API.
        if (tid && sid && st === "active" && !m.has(tid)) m.set(tid, sid);
      }
      setSessionByTable(m);

      const busy = new Set<string>();
      const billreq = new Set<string>();
      for (const s of sessions) {
        const tid = String(s?.tableId || "");
        const st = String(s?.status || "").toLowerCase();
        if (tid && st === "active") busy.add(tid);
        if (tid && s?.billingRequestedAt) billreq.add(tid);
      }
      const orders = (Array.isArray(oj["orders"]) ? oj["orders"] : []).filter((o: unknown) =>
        isTodayIso(String((o as OrderRow)?.createdAt || "")),
      ) as OrderRow[];
      setOrders(orders);
      for (const o of orders) {
        const tid = String(o?.tableId || "");
        const st = String(o?.status || "").toLowerCase();
        // الطاولة تعتبر مشغولة إذا كان هناك طلب في الانتظار، قيد التحضير، أو جاهز للتسليم
        if (tid && ["pending", "preparing", "ready"].includes(st)) busy.add(tid);
      }
      setBusyIds(busy);
      setBillReqIds(billreq);
    };

    try {
      const snapRes = await fetchOperationalSnapshot(base, { includeUsers: needUsers });
      if (snapRes.ok && snapRes.data) {
        const snap = snapRes.data as Record<string, unknown>;
        const sessionsRaw = Array.isArray(snap.sessions) ? snap.sessions : [];
        const sessionsActive = sessionsRaw.filter(
          (s) =>
            s &&
            typeof s === "object" &&
            String((s as TableSession).status || "")
              .toLowerCase()
              .trim() === "active",
        );
        const ordersRaw = Array.isArray(snap.orders) ? snap.orders : [];
        const fpj =
          snap.floorPlan && typeof snap.floorPlan === "object"
            ? (snap.floorPlan as Record<string, unknown>)
            : {};
        const jt = { tables: Array.isArray(snap.tables) ? snap.tables : [] };
        const js = { sessions: sessionsActive };
        const oj = { orders: ordersRaw };
        const wfj =
          snap.workflowSettings && typeof snap.workflowSettings === "object"
            ? (snap.workflowSettings as Record<string, unknown>)
            : {};
        const opsj =
          snap.opsSettings && typeof snap.opsSettings === "object" ? (snap.opsSettings as Record<string, unknown>) : {};
        const tblDs = snap.tableDataSource as { error?: string; source?: string; fromMirror?: boolean } | undefined;
        const src = snap.sources as Record<string, string> | undefined;
        let hint = "";
        if (tblDs?.error) hint = `تحذير SQL (الطاولات): ${tblDs.error}`;
        else if (src?.tables === "sql" || tblDs?.source === "sql") hint = "";
        else if (tblDs?.fromMirror) hint = "عرض طاولات من نسخة JSON احتياطية — تحقق من اتصال SQL.";
        applyLoadedPayload(fpj, jt, js, oj, wfj, opsj, snap.waiterTableAssignments, snap.tempCaptainTransfers, hint);
        if (needUsers) {
          const u = Array.isArray(snap.users) ? (snap.users as StaffUser[]) : [];
          if (u.length) {
            setStaffUsers(
              u.filter((x) => ["waiter", "host"].includes(String(x.role || "").toLowerCase()) && x.isActive !== false),
            );
          }
        }
        return;
      }

      const [fp, rt, rs, ro, wf, ops, wa] = await Promise.all([
        safeFetch(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
        safeFetch(`${base}/api/restaurant/tables`),
        safeFetch(`${base}/api/restaurant/table-sessions?status=active`),
        safeFetch(`${base}/api/restaurant/orders`),
        safeFetch(`${base}/api/restaurant/workflow-settings`),
        safeFetch(`${base}/api/restaurant/ops-settings`),
        safeFetch(`${base}/api/restaurant/waiter-table-assignments`),
      ]);
      const fpj = (tryParseJson(await fp.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const jt = (tryParseJson(await rt.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const js = (tryParseJson(await rs.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const oj = (tryParseJson(await ro.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const wfj = (tryParseJson(await wf.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const opsj = (tryParseJson(await ops.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const waj = (tryParseJson(await wa.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const httpLabel = (r: Response, nameAr: string) =>
        `${nameAr} (${r.status === 0 ? "لا اتصال بالخادم" : `HTTP ${r.status}`})`;
      const bad: string[] = [];
      if (!fp.ok) bad.push(httpLabel(fp, "خريطة الصالة"));
      if (!rt.ok) bad.push(httpLabel(rt, "الطاولات"));
      if (!rs.ok) bad.push(httpLabel(rs, "الجلسات"));
      if (!ro.ok) bad.push(httpLabel(ro, "الطلبات"));
      if (!wf.ok) bad.push(httpLabel(wf, "إعداد المسند"));
      if (!ops.ok) bad.push(httpLabel(ops, "إعدادات Owner/VIP"));
      if (!wa.ok) bad.push(httpLabel(wa, "تخصيص الطاولات"));
      if (bad.length) {
        const allNet = [fp, rt, rs, ro, wf, ops].every((r) => r.status === 0);
        const tail = allNet
          ? "تحقق من /api/ping على نفس عنوان الموقع ثم حدّث الصفحة."
          : "راجع سجلات Railway واتصال SQL في إعدادات المطوّر.";
        setMsg(`تعذّر تحميل البيانات: ${bad.join(" · ")}. ${tail}`);
        setTables([]);
        setSessionByTable(new Map());
        setSessions([]);
        setOrders([]);
        return;
      }
      const rtDs = (jt as { dataSource?: { error?: string } }).dataSource;
      const sqlHint = rtDs?.error ? `تحذير SQL: ${rtDs.error}` : "";
      applyLoadedPayload(fpj, jt, js, oj, wfj, opsj, waj.items, [], sqlHint);
    } catch (e) {
      setMsg(briefNetworkHint(e));
    }
  }, [base, user?.id, user?.role]);

  useEffect(() => {
    if (!roleHasManagerOpsAccess(user?.role)) {
      setGuestApprovalRequestBySession({});
      return;
    }
    const pendingSessionIds = sessions
      .filter((s) => Boolean(s?.guestApprovalPending) && String(s?.id || "").trim())
      .map((s) => String(s.id || "").trim());
    if (pendingSessionIds.length === 0) {
      setGuestApprovalRequestBySession({});
      return;
    }
    let stop = false;
    void (async () => {
      try {
        const r = await safeFetch(
          `${base}/api/restaurant/manager-approvals?status=pending_manager&reqType=guest_session_request`,
        );
        const j = tryParseJson<{ requests?: GuestApprovalRequestRow[] }>(await r.text()) ?? {};
        const rows = Array.isArray(j.requests) ? j.requests : [];
        const next: Record<string, string> = {};
        for (const row of rows) {
          const sid = String(row?.sessionId || "").trim();
          const rid = String(row?.id || "").trim();
          if (!sid || !rid || !pendingSessionIds.includes(sid)) continue;
          next[sid] = rid;
        }
        if (!stop) setGuestApprovalRequestBySession(next);
      } catch {
        if (!stop) setGuestApprovalRequestBySession({});
      }
    })();
    return () => {
      stop = true;
    };
  }, [base, sessions, user?.role]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      await loadTables();
    };
    void tick();
    const id = window.setInterval(() => void tick(), RESTAURANT_POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [loadTables]);

  useEffect(() => {
    const r = user?.role;
    if (!roleHasManagerOpsAccess(r)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await safeFetch(`${base}/api/auth/users`);
        const j = tryParseJson<{ users?: StaffUser[] }>(await res.text()) ?? {};
        if (cancelled || !res.ok) return;
        const u = Array.isArray(j.users) ? j.users : [];
        setStaffUsers(
          u.filter((x) => ["waiter", "host"].includes(String(x.role || "").toLowerCase()) && x.isActive !== false),
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, user?.role]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await safeFetch(`${base}/api/agents/by-group-name?group_name=${encodeURIComponent("owners&vip")}`);
        const j = tryParseJson<{ agents?: OwnersVipAgent[] }>(await res.text()) ?? {};
        if (cancelled || !res.ok) return;
        const list = (Array.isArray(j.agents) ? j.agents : [])
          .filter((x) => x && typeof x === "object")
          .map((a) => ({
            CardGuide: String((a as OwnersVipAgent).CardGuide || "").trim().toUpperCase(),
            AgentName: String((a as OwnersVipAgent).AgentName || "").trim(),
          }))
          .filter((a) => a.CardGuide);
        setOwnersVipAgents(list);
      } catch {
        /* ignore — قائمة العملاء لا تعطّل تحميل الطاولات */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  function applyClaimedSessionLocally(session: TableSession | null | undefined, fallbackTableId: string) {
    const tableId = String(session?.tableId || fallbackTableId || "").trim();
    const sessionId = String(session?.id || "").trim();
    if (!tableId || !sessionId) return;
    const normalized: TableSession = {
      ...session,
      id: sessionId,
      tableId,
      status: String(session?.status || "active"),
    };
    setSessions((prev) => {
      const rest = prev.filter((s) => String(s?.id || "") !== sessionId);
      return [normalized, ...rest];
    });
    setSessionByTable((prev) => {
      const next = new Map(prev);
      next.set(tableId, sessionId);
      return next;
    });
    setBusyIds((prev) => {
      const next = new Set(prev);
      next.add(tableId);
      return next;
    });
    setTables((prev) =>
      prev.map((t) =>
        String(t?.id || "") === tableId
          ? {
            ...t,
            status: "occupied",
          }
          : t,
      ),
    );
  }

  function clearCompletedSessionLocally(sessionId: string | null, tableId: string, tableStatus: "ready" | "dirty") {
    const sid = String(sessionId || "").trim();
    const tid = String(tableId || "").trim();
    if (!tid) return;
    if (sid) {
      setSessions((prev) => prev.filter((s) => String(s?.id || "") !== sid));
      setVipChoiceBySession((prev) => {
        const next = { ...prev };
        delete next[sid];
        return next;
      });
    }
    setSessionByTable((prev) => {
      const next = new Map(prev);
      const mapped = String(next.get(tid) || "").trim();
      if (!sid || mapped === sid) next.delete(tid);
      return next;
    });
    setBusyIds((prev) => {
      const next = new Set(prev);
      next.delete(tid);
      return next;
    });
    setBillReqIds((prev) => {
      const next = new Set(prev);
      next.delete(tid);
      return next;
    });
    setOrders((prev) => prev.filter((o) => String(o?.tableId || "") !== tid));
    setReport((prev) => {
      if (!prev) return prev;
      const targetName = tables.find((t) => String(t?.id || "") === tid)?.name || "";
      if (targetName && prev.tableName === targetName) return null;
      return prev;
    });
    setMinChargeDraftByTable((prev) => {
      const next = { ...prev };
      delete next[tid];
      return next;
    });
    setAlertPickByTable((prev) => {
      const next = { ...prev };
      delete next[tid];
      return next;
    });
    setAlertBusyByTable((prev) => {
      const next = { ...prev };
      delete next[tid];
      return next;
    });
    setTables((prev) =>
      prev.map((t) =>
        String(t?.id || "") === tid
          ? {
            ...t,
            status: tableStatus,
          }
          : t,
      ),
    );
  }

  /**
   * تسكين كابتن من شريحة الطاولة:
   * - بدون جلسة نشطة → ننشئها بـ POST؛ الخادم يُسكِّن المُرسِل تلقائياً (waiter/host/manager/developer)
   *   عبر `_restaurant_assign_captain_from_actor_if_needed` (api_server.py).
   * - بجلسة نشطة بلا كابتن (أو لتأكيد الكابتن) → نستخدم مسار `/claim-order-taker` كما كان.
   * بهذا السلوك يصبح زر «تسكين» في الشريحة هو الفعل الأول الذي يحجز الطاولة على المُسكِّن.
   */
  async function claimCaptain(args: { tableId: string; sessionId?: string | null }) {
    const { tableId, sessionId } = args;
    const claimTimeoutMs = 12000;
    setMsg("");
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    setClaimBusyTableId(String(tableId));
    try {
      let r: Response;
      let okMessage = "";
      if (sessionId && String(sessionId).trim()) {
        r = await safeFetch(
          `${base}/api/restaurant/table-sessions/${encodeURIComponent(String(sessionId))}/claim-order-taker`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mat3amActor: actor }),
            timeoutMs: claimTimeoutMs,
          },
        );
        okMessage = "تم تسكينك كابتن على هذه الجلسة.";
      } else {
        const customerType = customerTypeByTable[tableId] || "cash";
        r = await safeFetch(`${base}/api/restaurant/table-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableId,
            mat3amActor: actor,
            assignOrderTaker: true,
            startedByRole: actor.role,
            startReason: "captain_seat_from_table_card",
            customerType,
          }),
          timeoutMs: claimTimeoutMs,
        });
        okMessage = "تم فتح جلسة وتسكينك كابتن على الطاولة.";
      }
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      const j = tryParseJson<TableSession | { session?: TableSession; approvalRequested?: boolean; message?: string }>(t);
      if (j && typeof j === "object" && "approvalRequested" in j && j.approvalRequested) {
        setMsg(typeof j.message === "string" && j.message.trim() ? j.message : "تم رفع طلب موافقة للمدير.");
        await loadTables();
        return;
      }
      const session = j && typeof j === "object" && "session" in j ? j.session : (j as TableSession | null);
      if (session && !String(session.captainUserId || "").trim()) {
        session.captainUserId = actor.id;
        session.captainLogin = actor.login;
        session.captainName = actor.name || actor.login;
        session.captainRole = actor.role;
      }
      applyClaimedSessionLocally(session, String(tableId));
      setMsg(okMessage);
      const newSessionId = session?.id || sessionId;
      const q = `tableId=${encodeURIComponent(tableId)}` + (newSessionId ? `&sessionId=${encodeURIComponent(String(newSessionId))}` : "");
      navigate(`${orderTakerBase}/order-taker?${q}`);
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setClaimBusyTableId("");
    }
  }

  async function requestCaptainTransfer(sessionId: string) {
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    setCaptainTransferBusySessionId(sessionId);
    setMsg("");
    try {
      const r = await safeFetch(
        `${base}/api/restaurant/manager-approvals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "captain_handover_request",
            sessionId,
            reason: "طلب تسليم/استبدال كابتن أثناء التشغيل",
            mat3amActor: actor,
          }),
        },
      );
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      setMsg("تم رفع طلب تسليم الكابتن للمدير ليحدد البديل ونطاق التحويل.");
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setCaptainTransferBusySessionId("");
    }
  }

  async function reviewGuestSession(sessionId: string, action: "approve" | "reject") {
    const requestId = String(guestApprovalRequestBySession[sessionId] || "").trim();
    if (!requestId) {
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
    setGuestApprovalBusySessionId(sessionId);
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/restaurant/manager-approvals/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          decisionId: action === "approve" ? "approve_guest_session" : undefined,
          managerNote: managerNote || undefined,
          reviewedBy: {
            userId: user?.id != null ? String(user.id) : "",
            name: repairArabicDisplayText(String(user?.name || user?.login || "مدير")),
            role: user?.role || "manager",
          },
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ detail?: unknown }>(t);
      if (!r.ok) {
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      setMsg(action === "approve" ? "تم اعتماد جلسة الضيف." : "تم رفض جلسة الضيف وإعادتها إلى عميل نقدي.");
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setGuestApprovalBusySessionId("");
    }
  }

  async function applyNoOrderWatchAction(sessionId: string, action: "snooze" | "close" | "reset_ready" | "reset_table", reason?: string) {
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    setNoOrderBusySessionId(sessionId);
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(sessionId)}/no-order-watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: reason || undefined,
          mat3amActor: actor,
        }),
      });
      const t = await r.text();
      if (!r.ok) {
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      const j = tryParseJson<{ session?: TableSession; approvalRequested?: boolean; message?: string } & Record<string, unknown>>(t);
      if (j?.approvalRequested) {
        setMsg(typeof j.message === "string" && j.message.trim() ? j.message : "تم رفع طلب موافقة للمدير.");
        await loadTables();
        return;
      }
      const done = j?.session;
      const doneTableId = String(done?.tableId || "").trim();
      if (done && doneTableId && action !== "snooze") {
        clearCompletedSessionLocally(sessionId, doneTableId, action === "close" ? "dirty" : "ready");
      }
      setMsg(
        action === "snooze"
          ? "تم منح مدة إضافية 10 دقائق."
          : action === "reset_table"
            ? "تم تنفيذ Reset للطاولة وتنظيف حالتها بالكامل."
            : action === "reset_ready"
              ? "تم إلغاء التسكين وإرجاع الطاولة إلى جاهزة."
              : "تم إنهاء التسكين وإغلاق الجلسة.",
      );
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setNoOrderBusySessionId("");
    }
  }

  async function snoozeNoOrderSession(sessionId: string) {
    await applyNoOrderWatchAction(sessionId, "snooze");
  }

  async function resetReadyNoOrderSession(sessionId: string) {
    const reason = window.prompt("سبب إرجاع الطاولة إلى جاهزة:", "") || "";
    const txt = reason.trim();
    if (!txt) return;
    await applyNoOrderWatchAction(sessionId, "reset_ready", txt);
  }

  async function closeNoOrderSession(sessionId: string) {
    await applyNoOrderWatchAction(sessionId, "reset_ready");
  }

  async function resetTableByTableId(tableId: string) {
    const tid = String(tableId || "").trim();
    if (!tid) return;
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    const reason =
      window.prompt("سبب Reset للطاولة (تنظيف كامل للجلسة والطلبات المفتوحة على الطاولة):", "تنظيف كامل للطاولة") || "";
    const txt = reason.trim();
    if (!txt) return;
    setTableResetBusyId(tid);
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/restaurant/tables/${encodeURIComponent(tid)}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: txt,
          mat3amActor: actor,
        }),
      });
      const t = await r.text();
      if (!r.ok) {
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      setMsg("تم تنفيذ Reset للطاولة وتنظيف حالتها بالكامل.");
      clearCompletedSessionLocally(null, tid, "ready");
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setTableResetBusyId("");
    }
  }

  async function submitReassignCaptain() {
    if (!reassignSid || !reassignPickId) return;
    setMsg("");
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    const pick = staffUsers.find((u) => String(u.id) === String(reassignPickId));
    if (!pick) {
      setMsg("اختر المستخدم الهدف.");
      return;
    }
    setReassignBusy(true);
    try {
      const r = await safeFetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(reassignSid)}/reassign-order-taker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mat3amActor: actor,
          targetUserId: pick.id,
          targetLogin: pick.login,
          targetName: pick.name || pick.login,
        }),
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      setMsg("تم تحويل الكابتن.");
      setReassignSid(null);
      setReassignPickId("");
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setReassignBusy(false);
    }
  }

  async function changeTableStatus(tableId: string, status: "dirty" | "cleaning" | "ready") {
    try {
      const r = await safeFetch(`${base}/api/restaurant/tables/${encodeURIComponent(tableId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t.slice(0, 280) || `HTTP ${r.status}`);
        return;
      }
      const updated = tables.map((tRow: RestTable) =>
        String(tRow.id) === String(tableId) ? { ...tRow, status } : tRow,
      );
      setTables(updated);
    } catch (e) {
      setMsg(briefNetworkHint(e));
    }
  }

  async function applyVipBilling(sessionId: string, mode: string) {
    if (!sessionId) return;
    setMsg("");
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    setVipBusySessionId(sessionId);
    try {
      const body: Record<string, unknown> = { mat3amActor: actor };
      if (!mode) {
        body.clear = true;
      } else if (mode === "__ops_defaults__") {
        body.applyOpsDefaults = true;
      } else if (mode.startsWith("__agent__:")) {
        body.vipAgentGuid = mode.slice("__agent__:".length).trim();
      } else {
        body.vipTemplateId = mode;
      }
      const r = await safeFetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(sessionId)}/billing-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      setMsg(
        !mode
          ? "تم إلغاء Owner/VIP للجلسة."
          : mode === "__ops_defaults__"
            ? "تم تطبيق افتراضيات Owner/VIP."
            : mode.startsWith("__agent__:")
              ? "تم ربط الجلسة بعميل الملاك من القاعدة."
              : "تم تطبيق قالب Owner/VIP.",
      );
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setVipBusySessionId("");
    }
  }

  async function saveMinimumCharge(tableId: string) {
    const tid = String(tableId || "").trim();
    if (!tid) return;
    if (!roleHasManagerOpsAccess(user?.role)) return;
    const raw = String(minChargeDraftByTable[tid] ?? "").trim();
    const mc = Number(raw);
    if (!Number.isFinite(mc) || mc < 0) {
      setMsg("minimum charge غير صالح.");
      return;
    }
    setMinChargeBusyByTable((p) => ({ ...p, [tid]: true }));
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/restaurant/tables/${encodeURIComponent(tid)}/minimum-charge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumCharge: mc, mat3amActor: buildMat3amActor(user) }),
      });
      const t = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(t);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : t || `HTTP ${r.status}`);
        return;
      }
      setMsg("تم حفظ الحد الأدنى لكل كرسي على هذه الطاولة.");
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setMinChargeBusyByTable((p) => ({ ...p, [tid]: false }));
    }
  }

  async function sendTableAlert(tableId: string, sessionId: string | null) {
    const tid = String(tableId || "").trim();
    if (!tid) return;
    const pickId = String(alertPickByTable[tid] || "").trim();
    const preset = alertPresets.find((x) => x.id === pickId) || null;
    if (!preset) {
      setMsg("اختر نوع تنبيه أولاً.");
      return;
    }
    setAlertBusyByTable((p) => ({ ...p, [tid]: true }));
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/restaurant/cashier/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: preset.type,
          title: preset.label,
          tableId: tid,
          sessionId: sessionId || undefined,
          sourceKey: `tbl:${tid}:${preset.id}:${Date.now()}`,
        }),
      });
      const txt = await r.text();
      if (!r.ok) {
        if (r.status === 0) {
          setMsg(briefNetworkHint("Failed to fetch"));
          return;
        }
        const j = tryParseJson<{ detail?: unknown }>(txt);
        const d = j?.detail;
        setMsg(typeof d === "string" ? d : txt || `HTTP ${r.status}`);
        return;
      }
      setMsg("تم إرسال التنبيه.");
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setAlertBusyByTable((p) => ({ ...p, [tid]: false }));
    }
  }

  const orderQty = (o: OrderRow) =>
    (Array.isArray(o.items) ? o.items : []).reduce((a, it) => a + Math.max(0, Number(it?.quantity ?? 0)), 0);
  const orderTotal = (o: OrderRow) => {
    const fromKitchen = Number(o?.kitchenTotals?.total ?? 0);
    if (fromKitchen > 0) return fromKitchen;
    return (Array.isArray(o.items) ? o.items : []).reduce(
      (a, it) => a + Math.max(0, Number(it?.quantity ?? 0)) * Math.max(0, Number(it?.unitPrice ?? 0)),
      0,
    );
  };
  const isArrived = (status: string) => ["ready", "served", "completed", "delivered"].includes(status);
  const isKitchen = (status: string) => ["pending", "preparing"].includes(status);

  const tableCosts = useMemo(() => {
    const m = new Map<string, { totalCost: number; pendingCost: number; orderCount: number }>();
    const todayOrders = orders.filter((o) => isTodayIso(String(o?.createdAt || "")));
    const sessionToTable = new Map<string, string>();
    for (const [tid, sid] of sessionByTable.entries()) {
      if (tid && sid) sessionToTable.set(sid, tid);
    }
    const byTable: Record<string, OrderRow[]> = {};
    for (const o of todayOrders) {
      const sid = String(o?.sessionId || "");
      const tid = String(o?.tableId || "");
      const key = sid ? (sessionToTable.get(sid) || tid) : tid;
      if (!key) continue;
      if (!byTable[key]) byTable[key] = [];
      byTable[key].push(o);
    }
    for (const [tid, related] of Object.entries(byTable)) {
      const totalCost = related.reduce((a, o) => a + orderTotal(o), 0);
      const pendingCost = related
        .filter((o) => isKitchen(String(o?.status || "").toLowerCase()))
        .reduce((a, o) => a + orderTotal(o), 0);
      m.set(tid, { totalCost, pendingCost, orderCount: related.length });
    }
    return m;
  }, [orders, sessionByTable]);
  const showTableReport = (t: RestTable, ev: ReactMouseEvent<HTMLElement>) => {
    ev.preventDefault();
    const tid = String(t.id);
    const session = sessions.find((s) => String(s?.tableId || "") === tid && String(s?.status || "").toLowerCase() === "active") || null;
    const sid = session?.id ? String(session.id) : null;
    const related = orders
      .filter((o) => (sid ? String(o?.sessionId || "") === sid : String(o?.tableId || "") === tid))
      .filter((o) => isTodayIso(String(o?.createdAt || "")))
      .sort((a, b) => String(a?.createdAt || "").localeCompare(String(b?.createdAt || "")));
    const lines = related.map((o) => {
      const st = String(o?.status || "").toLowerCase();
      const qty = orderQty(o);
      const rawItems = Array.isArray(o?.items) ? o.items : [];
      const items = rawItems
        .map((it) => ({
          name: String(it?.name || "").trim() || "—",
          quantity: Math.max(0, Number(it?.quantity ?? 0)),
          unitPrice: Math.max(0, Number(it?.unitPrice ?? 0)),
        }))
        .filter((it) => it.quantity > 0);
      return {
        id: String(o?.id || "").slice(0, 8),
        time: String(o?.createdAt || "").replace("T", " ").slice(0, 16),
        status: st || "pending",
        qty,
        total: orderTotal(o),
        items,
      };
    });
    const qtyTotal = lines.reduce((a, l) => a + l.qty, 0);
    const qtyArrived = lines.filter((l) => isArrived(l.status)).reduce((a, l) => a + l.qty, 0);
    const qtyKitchen = lines.filter((l) => isKitchen(l.status)).reduce((a, l) => a + l.qty, 0);
    const totalCost = lines.reduce((a, l) => a + l.total, 0);
    const pendingCost = lines.filter((l) => isKitchen(l.status)).reduce((a, l) => a + l.total, 0);
    const persistedDelay = Number((session as any)?.firstOrderDelayMinutes || 0);
    const noOrderDelayMinutes = lines.length === 0 ? diffMinutesFromIso(session?.startTime || undefined) : persistedDelay;
    const pendingCount = lines.filter((l) => l.status === "pending").length;
    const preparingCount = lines.filter((l) => l.status === "preparing").length;
    const readyCount = lines.filter((l) => l.status === "ready").length;
    const servedCount = lines.filter((l) => l.status === "served").length;
    const cancelledCount = lines.filter((l) => l.status === "cancelled").length;
    const guestCount = Math.max(1, Number(session?.guestCount ?? 1) || 1);
    const minimumChargePerSeat = Math.max(0, Number(session?.minimumChargePerSeat ?? 0) || 0);
    setReport({
      tableName: t.name,
      sessionId: sid,
      startTime: session?.startTime || null,
      captainName: repairArabicDisplayText(String(session?.captainName || session?.captainLogin || "").trim()) || null,
      guestCount,
      minimumChargePerSeat,
      orderCount: lines.length,
      qtyTotal,
      qtyArrived,
      qtyKitchen,
      pendingCount,
      preparingCount,
      readyCount,
      servedCount,
      cancelledCount,
      totalCost,
      pendingCost,
      noOrderDelayMinutes,
      guestSession: Boolean(session?.guestSession),
      lines,
    });
  };

  const reportFinancials = useMemo(() => {
    if (!report) return null;
    const net = report.totalCost;
    const svc = (net * policy.servicePercent) / 100;
    const vat = policy.serviceBeforeVat ? ((net + svc) * policy.vatPercent) / 100 : (net * policy.vatPercent) / 100;
    const total = Math.max(0, net + svc + vat);
    return { net, svc, vat, total };
  }, [report, policy]);

  const orderTakerBase = location.pathname.startsWith("/app/manager")
    ? "/app/manager"
    : location.pathname.startsWith("/app/operation_manager")
      ? "/app/operation_manager"
      : location.pathname.startsWith("/app/developer")
        ? "/app/developer"
        : "/app/waiter";

  const headerTitle =
    user?.role === "manager"
      ? "شريحات الطاولات — المدير"
      : user?.role === "operation_manager"
        ? "شريحات الطاولات — مدير التشغيل"
        : user?.role === "developer"
          ? "شريحات الطاولات — مطوّر"
          : "جارسون الطلبات";

  const handlePrint = useCallback(() => {
    const el = document.querySelector<HTMLElement>(".print-only");
    if (!el || !report) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const s = w.document;
    s.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${report.tableName}</title><style>@page{size:A4 portrait;margin:12mm}body{font-family:"IBM Plex Sans Arabic",Arial,sans-serif;font-size:11pt;line-height:1.5;direction:rtl;text-align:right;color:#000;background:#fff;margin:0;padding:16px 20px}table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{padding:6px 10px;border:1px solid #ccc;font-size:10pt}th{background:#f5f5f5;font-weight:700;color:#333}td{color:#222;background:#fff}span,strong,em,b,i,small,label{display:inline;color:#000}.print-header{font-size:16pt;font-weight:900;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px;color:#000}.print-subheader{font-size:12pt;font-weight:700;color:#444;margin:12px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}.print-row{display:flex;flex-direction:row;justify-content:space-between;gap:12px;margin-bottom:8px;page-break-inside:avoid}.print-col{display:flex;flex-direction:column;flex:1}.print-meta-box{border:1px solid #ccc;padding:8px 10px;border-radius:4px;background:#fafafa;margin-bottom:6px;page-break-inside:avoid}.print-meta-label{font-size:9pt;color:#666;font-weight:600;margin-bottom:2px}.print-meta-value{font-size:11pt;font-weight:800;color:#000}.print-alert{padding:6px 10px;border-radius:4px;margin:4px 0;font-size:10pt;font-weight:700;page-break-inside:avoid}.print-alert-warning{background:#fff8e1;border:1px solid #ffc107;color:#856404}.print-alert-danger{background:#ffebee;border:1px solid #f44336;color:#c62828}.print-alert-success{background:#e8f5e9;border:1px solid #4caf50;color:#2e7d32}.print-footer{margin-top:20px;padding-top:10px;border-top:1px solid #ccc;font-size:9pt;color:#666;text-align:center}.avoid-break{page-break-inside:avoid}</style></head><body>`);
    s.write(el.innerHTML);
    s.write("</body></html>");
    s.close();
    w.focus();
    w.print();
  }, [report]);

  return (
    <div className="role-op waiter-pos" onClick={() => setReport(null)}>
      <OperationalRoleHeader roleTitle={headerTitle} hideBack />

      <div className="role-op__main">
        <div className="waiter-tables-toolbar">
          <h2 className="role-op__section-title">اختر الطاولة</h2>
          <div className="waiter-tables-toolbar__jump">
            <input
              type="search"
              enterKeyHint="go"
              value={tableJumpQuery}
              onChange={(e) => setTableJumpQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jumpToTableCard();
                }
              }}
              placeholder="انتقال سريع: رقم أو اسم الطاولة…"
              aria-label="بحث عن طاولة للانتقال إليها في القائمة"
              className="waiter-tables-toolbar__jump-input"
            />
            <button type="button" className="btn btn-primary" onClick={() => jumpToTableCard()} style={{ fontWeight: 800 }}>
              انتقل
            </button>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void loadTables()} style={{ fontWeight: 800 }}>
            تحديث القائمة
          </button>
        </div>
        {msg && <p className="waiter-pos__msg">{msg}</p>}

        <div className="waiter-tables-grid">
          {tables.map((t) => {
            if (t.isSeparator) {
              return (
                <div key={t.id} className="waiter-tables-floor-band" role="group" aria-label={t.name}>
                  {t.name}
                </div>
              );
            }
            const displayLabel = t.name || "طاولة";
            const tStatus = normalizeTableStatus(String((t as any).status || ""));
            const notReady = tStatus === "dirty" || tStatus === "cleaning";
            const cleanupOverdue = Boolean((t as any).cleanupOverdue);
            const noOrderOverdue = Boolean((t as any).noOrderOverdue);
            const noOrderMinutes = Number((t as any).noOrderMinutes || 0);
            const isBusy = busyIds.has(String(t.id));
            const billReq = billReqIds.has(String(t.id));
            const sidStr = sessionByTable.get(String(t.id)) || "";
            const sessRow = sessions.find(
              (s) => String(s?.tableId || "") === String(t.id) && String(s?.status || "").toLowerCase() === "active",
            );
            const captainLabel = sessRow
              ? repairArabicDisplayText(String(sessRow.captainName || sessRow.captainLogin || "").trim()) || ""
              : "";
            const capId = sessRow ? String(sessRow.captainUserId || "").trim() : "";
            const tempTransfer = tempTransferByTable.get(normalizeAssignedTableId(t.id));
            const incomingTempTransfer = Boolean(tempTransfer && user?.id && String(tempTransfer.toUserId || "").trim() === String(user.id));
            const watchStage = String(sessRow?.noOrderWatchStage || "").trim();
            const snoozeCount = Math.max(0, Number(sessRow?.noOrderSnoozeCount || 0));
            const snoozedUntilIso = String(sessRow?.noOrderSnoozedUntil || "").trim();
            const snoozedUntilTs = snoozedUntilIso ? Date.parse(snoozedUntilIso) : Number.NaN;
            const snoozeActive = Number.isFinite(snoozedUntilTs) && snoozedUntilTs > Date.now();
            const needsImmediateResolution = watchStage === "final_decision" || snoozeCount >= 2;
            const isGuestSession = Boolean(sessRow?.guestSession);
            const guestApprovalPending = Boolean(sessRow?.guestApprovalPending);
            const customerTypeLocked = Boolean(sessRow?.customerTypeLocked || Number(sessRow?.linkedOrderCount || 0) > 0);
            const bp = sessRow?.billingProfile;
            const vipOwnerLabel =
              bp && typeof bp === "object" && bp.active !== false
                ? String(bp.vipOwnerLabel || "").trim() || ""
                : "";
            const isVipTable = Boolean(t.features?.vipSection);
            const cardTone = notReady ? "blocked" : isBusy ? "busy" : "ready";
            const money = tableCosts.get(String(t.id)) || { totalCost: 0, pendingCost: 0, orderCount: 0 };
            const minRaw = String(minChargeDraftByTable[String(t.id)] ?? "").trim();
            const minCharge = Number(minRaw);
            const minOk = Number.isFinite(minCharge) ? Math.max(0, minCharge) : 0;
            const minGap = minOk > 0 && money.totalCost < minOk ? minOk - money.totalCost : 0;
            const alertPick = alertPickByTable[String(t.id)] ?? "";
            const alertBusy = Boolean(alertBusyByTable[String(t.id)]);
            const canEditMin = roleHasManagerOpsAccess(user?.role);
            const billAgeMinutes = diffMinutesFromIso(sessRow?.billingRequestedAt || undefined);
            const canForceResetTable = Boolean(
              roleHasManagerOpsAccess(user?.role) &&
              (tStatus === "occupied" || sidStr || money.orderCount > 0 || billReq),
            );
            const noOrderWatchActive = Boolean(
              sidStr && money.orderCount === 0 && (noOrderMinutes >= 10 || snoozeActive || watchStage),
            );
            const billWatchActive = Boolean(sidStr && sessRow?.billingRequestedAt);
            const noOrderStatusLabel = snoozeActive
              ? `مدة إضافية حتى ${new Date(snoozedUntilTs).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}`
              : needsImmediateResolution
                ? `حسم فوري بعد ${noOrderMinutes} د`
                : watchStage === "manager_escalated"
                  ? `تصعيد بعد ${noOrderMinutes} د`
                  : noOrderOverdue
                    ? `فوات أوان التسكين ${noOrderMinutes} د`
                    : "";
            const billStatusLabel = billWatchActive
              ? billAgeMinutes >= 1
                ? `طلب الحساب ${billAgeMinutes} د`
                : "طلب حساب"
              : "";
            const sessionStateLabel = tStatus === "dirty" ? "متسخة" : tStatus === "cleaning" ? "قيد التنظيف" : isBusy ? "مشغولة" : "جاهزة";
            const customerTypeLabels: Record<string, string> = {
              cash: "نقدي",
              guest: "ضيف صالة",
              owner: "مالك",
              vip: "شخص مهم",
            };
            const currentCustomerType = String(sessRow?.customerType || "cash");
            const customerStateLabel = guestApprovalPending
              ? `العميل: ${customerTypeLabels[currentCustomerType] || currentCustomerType} بانتظار اعتماد`
              : isGuestSession
                ? "العميل: ضيف صالة"
                : vipOwnerLabel
                  ? `العميل: ${vipOwnerLabel}`
                  : customerTypeLocked
                    ? `العميل: ${customerTypeLabels[currentCustomerType] || currentCustomerType} مقفول`
                    : `العميل: ${customerTypeLabels[currentCustomerType] || currentCustomerType} افتراضي`;
            const captainStateLabel = captainLabel
              ? `الكابتن: ${captainLabel}`
              : sidStr
                ? "الجلسة مفتوحة بدون كابتن"
                : "لا توجد جلسة نشطة";
            const claimButtonLabel =
              claimBusyTableId === String(t.id)
                ? "جاري التسكين…"
                : capId && user?.id && String(capId) === String(user.id)
                  ? "أنت الكابتن ✓"
                  : sidStr
                    ? capId
                      ? "الطاولة مسندة"
                      : "تسكين كابتن"
                    : "فتح جلسة";
            const claimButtonTitle =
              claimBusyTableId === String(t.id)
                ? "جارٍ تنفيذ أمر التسكين لهذه الطاولة"
                : capId && user?.id && String(capId) === String(user.id)
                  ? "أنت الكابتن على هذه الجلسة"
                  : sidStr
                    ? capId
                      ? `الجلسة مسندة إلى ${captainLabel || "كابتن آخر"}`
                      : "ربط الجلسة على الكابتن"
                    : "بدء جلسة وتسكين نفسك على الطاولة";
            const openOrderDisabled = Boolean(
              notReady ||
              guestApprovalPending ||
              (exclusiveOn && capId && user?.id && String(capId) !== String(user.id) && !roleHasManagerOpsAccess(user.role)),
            );
            const openOrderLabel = guestApprovalPending
              ? "بانتظار الاعتماد"
              : notReady
                ? "الطاولة غير جاهزة"
                : !sidStr
                  ? "فتح الطلب وبدء الجلسة"
                  : capId && user?.id && String(capId) === String(user.id)
                    ? "متابعة الطلب"
                    : sidStr && !capId
                      ? "فتح الطلب وتأكيد الكابتن"
                      : roleHasManagerOpsAccess(user?.role)
                        ? "فتح الطلب"
                        : "الطاولة مسندة";
            const openOrderHint = guestApprovalPending
              ? "بانتظار اعتماد المدير — لا يمكن فتح الطلب حتى يتم الاعتماد"
              : !sidStr
                ? "فتح شاشة الطلب سيُنشئ الجلسة تلقائياً لهذه الطاولة"
                : sidStr && !capId
                  ? "فتح شاشة الطلب ثم تثبيت الكابتن على الجلسة الحالية"
                  : "متابعة تشغيل الطلب على الجلسة الحالية";
            const openOrderTakerForTable = async () => {
              if (notReady) {
                setMsg("الطاولة غير جاهزة. أكمل دورة التنظيف أولًا.");
                return;
              }
              if (
                exclusiveOn &&
                capId &&
                user?.id &&
                String(capId) !== String(user.id) &&
                !roleHasManagerOpsAccess(user.role)
              ) {
                const nm = captainLabel || "كابتن آخر";
                setMsg(`الطاولة مسندة إلى ${nm}. يتدخل المدير لتحويل الكابتن أو سجّل تسكينك إن كنت المسؤول.`);
                return;
              }
              // اذا في اختيار VIP/Owner غير مطبّق، نطبّقه تلقائياً قبل فتح الطلب
              if (sidStr) {
                const bp = sessRow?.billingProfile;
                const src = String(bp?.source || "").toLowerCase();
                const currentMode =
                  bp?.active === false
                    ? ""
                    : src === "vip_owner_agent" && String(bp?.vipAgentGuid || "").trim()
                      ? `__agent__:${String(bp?.vipAgentGuid || "").trim().toUpperCase()}`
                      : src === "vip_owner_template" && String(bp?.vipTemplateId || "").trim()
                        ? String(bp?.vipTemplateId || "").trim()
                        : bp && String(bp?.source || "").trim()
                          ? "__ops_defaults__"
                          : "";
                const chosen = vipChoiceBySession[sidStr] ?? "";
                if (chosen && chosen !== currentMode) {
                  await applyVipBilling(sidStr, chosen);
                }
              }
              const q =
                `tableId=${encodeURIComponent(t.id)}` + (sidStr ? `&sessionId=${encodeURIComponent(sidStr)}` : "");
              navigate(`${orderTakerBase}/order-taker?${q}`);
            };

            return (
              <div
                key={t.id}
                className={`waiter-tables-card-wrap${tableJumpHighlightId === String(t.id) ? " waiter-tables-card-wrap--jump-highlight" : ""}`}
                ref={(node) => {
                  const tid = String(t.id);
                  if (node) tableCardRefs.current.set(tid, node);
                  else tableCardRefs.current.delete(tid);
                }}
              >
                <div
                  className={`role-op__pick-card waiter-tblcard--spec waiter-tables-card--${cardTone}${billReq ? " waiter-tables-card--bill" : ""}${vipOwnerLabel ? " waiter-tblcard--owner" : ""}`}
                  onClick={openOrderTakerForTable}
                  onContextMenu={(ev) => showTableReport(t, ev)}
                  aria-label={`بطاقة طاولة ${displayLabel}`}
                >
                  <div className="waiter-tblcard__spec-top">
                    <div className="waiter-tblcard__spec-id">
                      <span className="waiter-tblcard__spec-id-text">{displayLabel}</span>
                      {isVipTable ? <span className="waiter-tables-vip-pill">VIP</span> : null}
                      {vipOwnerLabel ? <span className="waiter-tables-owner-pill">{vipOwnerLabel}</span> : null}
                      {isGuestSession ? <span className="waiter-tables-owner-pill" style={{ background: "rgba(16,185,129,0.15)", borderColor: "rgba(16,185,129,0.4)", color: "#047857" }}>ضيف</span> : null}
                      {guestApprovalPending ? (
                        <span className="waiter-tables-owner-pill" style={{ background: "rgba(245,158,11,0.14)", borderColor: "rgba(245,158,11,0.45)", color: "#92400e" }}>
                          {customerTypeLabels[currentCustomerType] || currentCustomerType} مؤقت
                        </span>
                      ) : null}
                      {incomingTempTransfer ? (
                        <span className="waiter-tables-owner-pill" style={{ background: "rgba(59,130,246,0.12)", borderColor: "rgba(59,130,246,0.45)", color: "#1d4ed8" }}>
                          محولة مؤقتاً
                        </span>
                      ) : null}
                    </div>
                    <div className="waiter-tblcard__spec-meta-row">
                      <span className="waiter-tblcard__mini-chip waiter-tblcard__mini-chip--state">{sessionStateLabel}</span>
                      <span className="waiter-tblcard__spec-seats">المقاعد: {t.seats ?? "—"}</span>
                      {money.orderCount > 0 ? <span className="waiter-tblcard__mini-chip">طلبات: {money.orderCount}</span> : null}
                      {billReq ? (
                        <span className="waiter-tblcard__mini-chip" style={{ borderColor: "rgba(59,130,246,0.5)", background: "rgba(59,130,246,0.12)" }}>
                          {billStatusLabel || "طلب حساب"}
                        </span>
                      ) : null}
                      {noOrderStatusLabel ? <span className="waiter-tblcard__mini-chip" data-tooltip="متابعة التسكين بلا طلبات">⏱ {noOrderStatusLabel}</span> : null}
                    </div>
                    <div className="waiter-tblcard__spec-seated-by">
                      {captainLabel ? <span className="waiter-tblcard__spec-captain">{captainStateLabel}</span> : <span className="waiter-tblcard__spec-muted">{captainStateLabel}</span>}
                    </div>
                    <div className="waiter-tblcard__spec-customer-line">{customerStateLabel}</div>
                    {cleanupOverdue ? <div className="waiter-tblcard__session-gap">تنبيه: تأخر تنظيف أكثر من 10 دقائق</div> : null}
                  </div>

                  <div className="waiter-tblcard__spec-open">
                    <button
                      type="button"
                      className="waiter-tblcard__open-order"
                      disabled={openOrderDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openOrderTakerForTable();
                      }}
                      data-tooltip={openOrderDisabled ? claimButtonTitle : openOrderHint}
                    >
                      {openOrderLabel}
                    </button>
                    <div className="waiter-tblcard__open-order-hint">{openOrderDisabled ? claimButtonTitle : openOrderHint}</div>
                  </div>

                  <div className="waiter-tblcard__spec-row1" onClick={(e) => e.stopPropagation()}>
                    <div className="waiter-tblcard__pill-row">
                      {(roleHasManagerOpsAccess(user?.role) || user?.role === "waiter") && !sidStr ? (
                        <select
                          className="waiter-tblcard__pill"
                          style={{
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 999,
                            border: "1px solid rgba(99,102,241,0.35)",
                            background: "rgba(99,102,241,0.08)",
                            color: "#4338ca",
                            cursor: "pointer",
                            minWidth: 0,
                          }}
                          value={customerTypeByTable[String(t.id)] || "cash"}
                          onChange={(e) =>
                            setCustomerTypeByTable((prev) => ({
                              ...prev,
                              [String(t.id)]: e.target.value,
                            }))
                          }
                          title="نوع العميل قبل التسكين"
                        >
                          <option value="cash">عميل نقدي</option>
                          <option value="guest">ضيف صالة</option>
                          <option value="owner">مالك</option>
                          <option value="vip">شخص مهم</option>
                        </select>
                      ) : null}
                      <button
                        type="button"
                        className="waiter-tblcard__pill waiter-tblcard__pill--assign"
                        disabled={
                          claimBusyTableId === String(t.id) ||
                          notReady ||
                          Boolean(
                            exclusiveOn &&
                            capId &&
                            user?.id &&
                            String(capId) !== String(user.id) &&
                            !roleHasManagerOpsAccess(user.role),
                          )
                        }
                        onClick={() => void claimCaptain({ tableId: String(t.id), sessionId: sidStr || null })}
                        title={claimButtonTitle}
                      >
                        {claimButtonLabel}
                      </button>

                      {sidStr &&
                        capId &&
                        user?.id &&
                        String(capId) === String(user.id) &&
                        (user.role === "waiter" || user.role === "host") ? (
                        <button
                          type="button"
                          className="waiter-tblcard__pill"
                          disabled={notReady || captainTransferBusySessionId === sidStr}
                          onClick={(e) => {
                            e.stopPropagation();
                            void requestCaptainTransfer(sidStr);
                          }}
                          data-tooltip="رفع طلب للمدير لتحديد البديل وهل التحويل لهذه الطاولة فقط أم لكل الطاولات الحالية"
                        >
                          {captainTransferBusySessionId === sidStr ? "…" : "طلب تسليم"}
                        </button>
                      ) : null}

                      {roleHasManagerOpsAccess(user?.role) && sidStr && guestApprovalPending ? (
                        <>
                          <button
                            type="button"
                            className="waiter-tblcard__pill"
                            disabled={guestApprovalBusySessionId === sidStr || !guestApprovalRequestBySession[sidStr]}
                            onClick={(e) => {
                              e.stopPropagation();
                              void reviewGuestSession(sidStr, "approve");
                            }}
                            data-tooltip="اعتماد جلسة الضيف من نفس بطاقة الطاولة"
                            style={{ background: "rgba(16,185,129,0.14)", borderColor: "rgba(16,185,129,0.38)", color: "#047857" }}
                          >
                            {guestApprovalBusySessionId === sidStr ? "…" : "اعتماد ضيف"}
                          </button>
                          <button
                            type="button"
                            className="waiter-tblcard__pill"
                            disabled={guestApprovalBusySessionId === sidStr || !guestApprovalRequestBySession[sidStr]}
                            onClick={(e) => {
                              e.stopPropagation();
                              void reviewGuestSession(sidStr, "reject");
                            }}
                            data-tooltip="رفض جلسة الضيف وإعادتها إلى عميل نقدي"
                            style={{ background: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.35)", color: "#b91c1c" }}
                          >
                            {guestApprovalBusySessionId === sidStr ? "…" : "رفض ضيف"}
                          </button>
                        </>
                      ) : null}

                      {roleHasManagerOpsAccess(user?.role) && sidStr ? (
                        <button
                          type="button"
                          className="waiter-tblcard__pill"
                          disabled={notReady}
                          onClick={() => {
                            setReassignSid(sidStr);
                            setReassignPickId("");
                          }}
                          data-tooltip="تغيير/تحويل الكابتن"
                        >
                          تغيير كابتن
                        </button>
                      ) : null}
                    </div>

                  </div>

                  {canForceResetTable ? (
                    <div
                      className="waiter-tblcard__spec-alert"
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
                    >
                      <button
                        type="button"
                        className="waiter-tblcard__send"
                        disabled={tableResetBusyId === String(t.id)}
                        onClick={() => void resetTableByTableId(String(t.id))}
                        data-tooltip="Reset للطاولة: تنظيف كامل للجلسات والطلبات المفتوحة وإرجاع الطاولة إلى جاهزة حتى لو لم تعد هناك جلسة نشطة"
                        style={{ background: "rgba(244,114,182,0.16)", borderColor: "rgba(244,114,182,0.45)", color: "#fbcfe8" }}
                      >
                        {tableResetBusyId === String(t.id) ? "…" : "Reset للطاولة"}
                      </button>
                    </div>
                  ) : null}

                  {sidStr && noOrderWatchActive ? (
                    <div
                      className="waiter-tblcard__spec-alert"
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
                    >
                      {snoozeCount < 2 ? (
                        <button
                          type="button"
                          className="waiter-tblcard__send"
                          disabled={noOrderBusySessionId === sidStr}
                          onClick={() => void snoozeNoOrderSession(sidStr)}
                          data-tooltip="منح مدة إضافية 10 دقائق"
                        >
                          {noOrderBusySessionId === sidStr ? "…" : "مدة إضافية 10 د"}
                        </button>
                      ) : null}
                      {needsImmediateResolution ? (
                        <button
                          type="button"
                          className="waiter-tblcard__send"
                          disabled={noOrderBusySessionId === sidStr}
                          onClick={() => void resetReadyNoOrderSession(sidStr)}
                          data-tooltip="إلغاء التسكين وإرجاع الطاولة إلى جاهزة"
                          style={{ background: "rgba(16,185,129,0.18)", borderColor: "rgba(16,185,129,0.55)", color: "#d1fae5" }}
                        >
                          {noOrderBusySessionId === sidStr ? "…" : "إلغاء التسكين"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="waiter-tblcard__send"
                        disabled={noOrderBusySessionId === sidStr}
                        onClick={() => void closeNoOrderSession(sidStr)}
                        data-tooltip="إلغاء التسكين إذا لم توجد طلبات على الطاولة"
                      >
                        {noOrderBusySessionId === sidStr ? "…" : "إلغاء التسكين"}
                      </button>
                    </div>
                  ) : null}

                  {!noOrderWatchActive && (billWatchActive || minGap > 0) ? (
                    <div
                      className="waiter-tblcard__spec-alert"
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
                    >
                      {billWatchActive && billAgeMinutes >= 10 ? (
                        <span className="waiter-tblcard__pill waiter-tblcard__pill--busy">متأخر</span>
                      ) : minGap > 0 ? (
                        <span className="waiter-tblcard__pill waiter-tblcard__pill--dirty">تنبيه مالي</span>
                      ) : null}
                    </div>
                  ) : null}

                  {sidStr ? (
                    <div
                      style={{ position: "relative", marginTop: 8, display: "grid", gridTemplateColumns: "minmax(0,1fr) 86px", gap: 8, width: "100%", alignItems: "center" }}
                      onClick={(e) => e.stopPropagation()}
                      data-tooltip="ربط الطاولة على Owner/VIP"
                    >
                      {guestApprovalPending ? (
                        <div style={{ fontSize: "0.72rem", color: "#92400e", fontWeight: 700, padding: "4px 0", textAlign: "center" }}>
                          الجلسة {customerTypeLabels[currentCustomerType] || currentCustomerType} مؤقت بانتظار قرار المدير
                        </div>
                      ) : isGuestSession ? (
                        <div style={{ fontSize: "0.72rem", color: "#047857", fontWeight: 600, padding: "4px 0", textAlign: "center" }}>
                          جلسة ضيف — لا يمكن تحويلها لملاك/VIP
                        </div>
                      ) : (
                        <select
                          className="waiter-pos__select"
                          style={{ minWidth: 0, width: "100%" }}
                          value={(() => {
                            const bp = sessRow?.billingProfile;
                            const src = String(bp?.source || "").toLowerCase();
                            const currentMode =
                              bp?.active === false
                                ? ""
                                : src === "vip_owner_agent" && String(bp?.vipAgentGuid || "").trim()
                                  ? `__agent__:${String(bp?.vipAgentGuid || "").trim().toUpperCase()}`
                                  : src === "vip_owner_template" && String(bp?.vipTemplateId || "").trim()
                                    ? String(bp?.vipTemplateId || "").trim()
                                    : bp && String(bp?.source || "").trim()
                                      ? "__ops_defaults__"
                                      : "";
                            return vipChoiceBySession[sidStr] ?? currentMode;
                          })()}
                          onChange={(e) => setVipChoiceBySession((prev) => ({ ...prev, [sidStr]: e.target.value }))}
                        >
                          <option value="">عادي (بدون Owner/VIP)</option>
                          <option value="__ops_defaults__">Owner/VIP (افتراضيات الإعدادات)</option>
                          {activeVipTemplates.length ? (
                            <optgroup label="قوالب">
                              {activeVipTemplates.map((tpl) => {
                                const ownerName = tpl.agentGuid
                                  ? (ownersVipAgents.find((a) => a.CardGuide === tpl.agentGuid)?.AgentName || "")
                                  : "";
                                const display = tpl.label || ownerName || "Owner/VIP";
                                return (
                                  <option key={`vip-tpl-${tpl.id}`} value={tpl.id}>
                                    {display}
                                  </option>
                                );
                              })}
                            </optgroup>
                          ) : null}
                          {ownersVipAgentsDeduped.length ? (
                            <optgroup label="عملاء ملاك (غير مكرّرين في القوالب)">
                              {ownersVipAgentsDeduped.map((a) => (
                                <option key={`vip-ag-${a.CardGuide}`} value={`__agent__:${a.CardGuide}`}>
                                  {a.AgentName || a.CardGuide}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </select>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontWeight: 900, whiteSpace: "nowrap", padding: "0.35rem 0.5rem", width: "100%", minWidth: 0 }}
                        disabled={vipBusySessionId === sidStr || isGuestSession || guestApprovalPending || customerTypeLocked}
                        onClick={() => {
                          if (isGuestSession) {
                            setMsg("جلسة ضيف — لا يمكن تحويلها لملاك/VIP");
                            return;
                          }
                          if (guestApprovalPending) {
                            setMsg("هناك طلب ضيف بانتظار اعتماد المدير على هذه الجلسة.");
                            return;
                          }
                          if (customerTypeLocked) {
                            setMsg("نوع العميل مقفول بعد أول طلب على الجلسة.");
                            return;
                          }
                          const chosen = vipChoiceBySession[sidStr] ?? "";
                          void applyVipBilling(sidStr, chosen);
                        }}
                        data-tooltip={
                          isGuestSession
                            ? "جلسة ضيف — لا يمكن تطبيق Owner/VIP"
                            : guestApprovalPending
                              ? "يوجد طلب ضيف بانتظار اعتماد المدير"
                              : customerTypeLocked
                                ? "نوع العميل مقفول بعد أول طلب"
                                : "تطبيق Owner/VIP على الجلسة"
                        }
                      >
                        {vipBusySessionId === sidStr ? "…" : isGuestSession || guestApprovalPending ? "—" : customerTypeLocked ? "مقفول" : "تطبيق"}
                      </button>
                    </div>
                  ) : null}

                  <div className="waiter-tblcard__spec-money">
                    <div className="waiter-tblcard__money-est">
                      <div className="waiter-tblcard__money-est-label">قيمة تقديرية</div>
                      <div className="waiter-tblcard__money-est-val">{money.totalCost.toFixed(0)} ج</div>
                    </div>
                    <div className="waiter-tblcard__money-min-stack" onClick={(e) => e.stopPropagation()} data-tooltip="الحد الأدنى لكل كرسي على هذه الطاولة">
                      {canEditMin ? (
                        <input
                          className="waiter-tblcard__money-input"
                          type="number"
                          min={0}
                          step={1}
                          value={minChargeDraftByTable[String(t.id)] ?? ""}
                          onChange={(e) => setMinChargeDraftByTable((p) => ({ ...p, [String(t.id)]: e.target.value }))}
                          disabled={Boolean(minChargeBusyByTable[String(t.id)])}
                        />
                      ) : (
                        <div className="waiter-tblcard__money-min-readout">{minOk.toFixed(0)}</div>
                      )}
                      <div className="waiter-tblcard__money-min-hint">لكل كرسي</div>
                    </div>
                    <div className="waiter-tblcard__money-min-label" onClick={(e) => e.stopPropagation()}>
                      {canEditMin ? (
                        <InlinePinConfirm
                          label={Boolean(minChargeBusyByTable[String(t.id)]) ? "…" : "حفظ"}
                          reason="minimum_charge_override"
                          promptHint="تعديل الحد الأدنى لكل كرسي"
                          variant="warn"
                          disabled={Boolean(minChargeBusyByTable[String(t.id)])}
                          onConfirm={() => saveMinimumCharge(String(t.id))}
                        />
                      ) : (
                        <span className="waiter-tblcard__spec-muted">حد أدنى لكل كرسي</span>
                      )}
                    </div>
                  </div>

                  {minGap > 0 ? (
                    <div className="waiter-tblcard__spec-min-gap">فرق الحد الأدنى: {minGap.toFixed(0)} ج</div>
                  ) : null}

                  <div className="waiter-tblcard__spec-alert" onClick={(e) => e.stopPropagation()} data-tooltip="تنبيه كاشير سريع من إعدادات التشغيل — ليست قائمة عملاء الملاك">
                    <button
                      type="button"
                      className="waiter-tblcard__send"
                      disabled={alertBusy || !sidStr}
                      onClick={() => void sendTableAlert(String(t.id), sidStr || null)}
                    >
                      {alertBusy ? "…" : "تنبيه"}
                    </button>
                    <select
                      className="waiter-tblcard__alert-select"
                      value={alertPick}
                      onChange={(e) => setAlertPickByTable((p) => ({ ...p, [String(t.id)]: e.target.value }))}
                      disabled={alertBusy || alertPresets.length === 0}
                    >
                      <option value="">— اختر —</option>
                      {alertPresets.map((x) => (
                        <option key={`al-${x.id}`} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="waiter-tblcard__spec-footer" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="waiter-tblcard__report"
                      onClick={(e) => {
                        e.stopPropagation();
                        showTableReport(t, e);
                      }}
                    >
                      تقرير سريع
                    </button>
                    {tStatus === "dirty" ? (
                      <button
                        type="button"
                        className="waiter-tblcard__pill waiter-tblcard__pill--clean-go"
                        onClick={(e) => {
                          e.stopPropagation();
                          void changeTableStatus(String(t.id), "cleaning");
                        }}
                      >
                        بدء تنظيف
                      </button>
                    ) : null}
                    {tStatus === "cleaning" ? (
                      <button
                        type="button"
                        className="waiter-tblcard__pill waiter-tblcard__pill--clean-done"
                        onClick={(e) => {
                          e.stopPropagation();
                          void changeTableStatus(String(t.id), "ready");
                        }}
                      >
                        تم التنظيف
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {reassignSid ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            zIndex: 1100,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => !reassignBusy && setReassignSid(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: "100%", padding: "1rem 1.1rem", direction: "rtl" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, marginBottom: 8 }}>تحويل الكابتن (مدير)</div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>اختر جرسون الطلبات / الاستقبال</label>
            <select className="waiter-pos__select" style={{ width: "100%", marginBottom: 12 }} value={reassignPickId} onChange={(e) => setReassignPickId(e.target.value)}>
              <option value="">— اختر —</option>
              {staffUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.login} ({u.login})
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" disabled={reassignBusy} onClick={() => setReassignSid(null)}>
                إلغاء
              </button>
              <button type="button" className="btn btn-primary" disabled={reassignBusy || !reassignPickId} onClick={() => void submitReassignCaptain()}>
                {reassignBusy ? "…" : "تأكيد"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {report ? (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2,6,23,0.45)",
              zIndex: 999,
            }}
            onClick={() => setReport(null)}
          />
          {/* Modal */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(720px, 95vw)",
              maxHeight: "90vh",
              overflow: "auto",
              zIndex: 1000,
              background: "#ffffff",
              border: "2px solid #0ea5e9",
              borderRadius: 14,
              boxShadow: "0 20px 50px rgba(2,6,23,0.35)",
              padding: "1rem 1.1rem",
              direction: "rtl",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderBottom: "1px solid #e2e8f0", paddingBottom: 10 }}>
              <div style={{ fontSize: "1.15rem", fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
                {report.tableName} — ملخص الجلسة
                {report.guestSession ? (
                  <span style={{ fontSize: "0.72rem", background: "rgba(16,185,129,0.15)", color: "#047857", border: "1px solid rgba(16,185,129,0.4)", borderRadius: 6, padding: "2px 8px" }}>ضيف</span>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ fontSize: "0.78rem" }} onClick={handlePrint}>
                  🖨️ طباعة
                </button>
                <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ padding: "2px 10px" }} onClick={() => setReport(null)}>
                  ×
                </button>
              </div>
            </div>

            {/* Session Meta */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 12 }}>
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f1f5f9" }}>
                <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>الكابتن</div>
                <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a" }}>{report.captainName || "—"}</div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f1f5f9" }}>
                <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>بدأت الجلسة</div>
                <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a" }}>
                  {report.startTime ? new Date(report.startTime).toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "غير متاح"}
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f1f5f9" }}>
                <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>الضيوف</div>
                <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a" }}>{report.guestCount} ضيف</div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f1f5f9" }}>
                <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700 }}>مينيموم شارج</div>
                <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a" }}>
                  {report.minimumChargePerSeat > 0 ? `${report.minimumChargePerSeat.toFixed(0)} ج.م/ضيف = ${(report.minimumChargePerSeat * report.guestCount).toFixed(0)} ج.م` : "غير مفعّل"}
                </div>
              </div>
            </div>

            {/* Orders Status Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginTop: 12 }}>
              <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#1e40af" }}>{report.orderCount}</div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#3b82f6" }}>إجمالي الطلبات</div>
              </div>
              <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#92400e" }}>{report.pendingCount + report.preparingCount + report.readyCount}</div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b45309" }}>في المطبخ</div>
                <div style={{ fontSize: "0.65rem", color: "#78716c" }}>انتظار {report.pendingCount} · تحضير {report.preparingCount} · جاهز {report.readyCount}</div>
              </div>
              <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #86efac" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#15803d" }}>{report.servedCount}</div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#16a34a" }}>واصل للطاولة</div>
              </div>
              <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#991b1b" }}>{report.cancelledCount}</div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#dc2626" }}>ملغى</div>
              </div>
              <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#e2e8f0", border: "1px solid #cbd5e1" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#1e293b" }}>{report.qtyTotal}</div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>إجمالي العناصر</div>
              </div>
              <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "#f5f3ff", border: "1px solid #ddd6fe" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#5b21b6" }}>{report.totalCost.toFixed(0)}</div>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#7c3aed" }}>السلة ج.م</div>
              </div>
            </div>

            {/* Financial Summary */}
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 8, color: "#0f172a" }}>التكلفة</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, fontSize: "0.86rem" }}>
                <div><span style={{ color: "#64748b" }}>السلة:</span> <strong>{report.totalCost.toFixed(2)} ج.م</strong></div>
                <div><span style={{ color: "#64748b" }}>الخدمة ({policy.servicePercent}%):</span> <strong>{reportFinancials?.svc.toFixed(2)}</strong></div>
                <div><span style={{ color: "#64748b" }}>VAT ({policy.vatPercent}%):</span> <strong>{reportFinancials?.vat.toFixed(2)}</strong></div>
                <div><span style={{ color: "#64748b" }}>واصل للطاولة (قيمة):</span> <strong>{(report.totalCost - report.pendingCost).toFixed(2)}</strong></div>
                <div><span style={{ color: "#0f172a" }}>الإجمالي:</span> <strong style={{ fontSize: "1rem", color: "#059669" }}>{reportFinancials?.total.toFixed(2)} ج.م</strong></div>
              </div>
            </div>

            {/* Alerts */}
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {report.sessionId && billReqIds.has(report.sessionId) ? (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fee2e2", color: "#991b1b", fontSize: "0.82rem", fontWeight: 800 }}>
                  ⚠️ طلب حساب معلق — لا يمكن إضافة أصناف جديدة
                </div>
              ) : null}
              {Number(report.noOrderDelayMinutes || 0) >= 10 ? (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef3c7", color: "#92400e", fontSize: "0.82rem", fontWeight: 800 }}>
                  ⏱️ تأخر أخذ الطلب بعد التسكين ({report.noOrderDelayMinutes} دقيقة)
                </div>
              ) : null}
              {report.readyCount > 0 ? (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: "#dcfce7", color: "#14532d", fontSize: "0.82rem", fontWeight: 800 }}>
                  ✅ {report.readyCount} طلب جاهز بالمطبخ — استدعِ الرنر
                </div>
              ) : null}
            </div>

            {/* Recent Orders */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 8, fontSize: "0.9rem", color: "#0f172a" }}>الطلبات المرسلة</div>
              {report.lines.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: "0.85rem" }}>لا توجد طلبات على هذه الطاولة.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
                  {report.lines.map((l) => (
                    <div key={l.id + l.time} style={{ border: "1px solid #dbeafe", borderRadius: 10, padding: "8px 10px", background: "#f8fbff" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "0.82rem", color: "#0f172a" }}>
                        <span>طلب {l.id || "—"} · {(() => {
                          const s = String(l.status || "").toLowerCase();
                          const map: Record<string, string> = { pending: "انتظار", preparing: "تحضير", ready: "جاهز", served: "مُقدَّم", cancelled: "ملغى", paid: "مدفوع" };
                          return map[s] || s;
                        })()}</span>
                        <span style={{ color: "#64748b", fontWeight: 600 }}>{l.qty} عنصر</span>
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#475569", marginTop: 2 }}>{l.time || "—"}</div>
                      <div style={{ fontSize: "0.86rem", marginTop: 3, color: "#0f172a", fontWeight: 700 }}>القيمة: {l.total.toFixed(2)} ج.م</div>
                      {l.items.length > 0 ? (
                        <ul style={{ margin: "6px 0 0", padding: "0 14px 0 0", listStyle: "disc", fontSize: "0.78rem", color: "#334155", lineHeight: 1.6 }}>
                          {l.items.map((it, idx) => (
                            <li key={idx}>
                              {it.quantity} × {it.name}
                              {it.unitPrice > 0 ? ` — ${Math.round(it.unitPrice)} ج.م` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* ===== Print-Only Report (A4 Clean Print) ===== */}
      {report ? (
        <div className="print-only" dir="rtl">
          {/* Header */}
          <div className="print-header">
            {report.tableName} — ملخص الجلسة
            {report.guestSession ? (
              <span style={{ fontSize: "10pt", fontWeight: 400, marginRight: 8, color: "#666" }}>
                (جلسة ضيف)
              </span>
            ) : null}
          </div>

          {/* Meta Grid */}
          <div className="print-subheader">معلومات الجلسة</div>
          <div className="print-row">
            <div className="print-col">
              <div className="print-meta-box avoid-break">
                <div className="print-meta-label">الكابتن</div>
                <div className="print-meta-value">{report.captainName || "—"}</div>
              </div>
            </div>
            <div className="print-col">
              <div className="print-meta-box avoid-break">
                <div className="print-meta-label">بدأت الجلسة</div>
                <div className="print-meta-value">
                  {report.startTime
                    ? new Date(report.startTime).toLocaleString("ar-EG", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })
                    : "غير متاح"}
                </div>
              </div>
            </div>
            <div className="print-col">
              <div className="print-meta-box avoid-break">
                <div className="print-meta-label">الضيوف</div>
                <div className="print-meta-value">{report.guestCount} ضيف</div>
              </div>
            </div>
            <div className="print-col">
              <div className="print-meta-box avoid-break">
                <div className="print-meta-label">مينيموم شارج</div>
                <div className="print-meta-value">
                  {report.minimumChargePerSeat > 0
                    ? `${report.minimumChargePerSeat.toFixed(0)} ج.م/ضيف = ${(report.minimumChargePerSeat * report.guestCount).toFixed(0)} ج.م`
                    : "غير مفعّل"}
                </div>
              </div>
            </div>
          </div>

          {/* Orders Status */}
          <div className="print-subheader">حالة الطلبات</div>
          <table style={{ width: "100%", marginBottom: 12 }}>
            <thead>
              <tr>
                <th>إجمالي الطلبات</th>
                <th>في المطبخ</th>
                <th>واصل للطاولة</th>
                <th>ملغى</th>
                <th>إجمالي العناصر</th>
                <th>السلة ج.م</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ textAlign: "center", fontWeight: 800 }}>{report.orderCount}</td>
                <td style={{ textAlign: "center" }}>
                  {report.pendingCount + report.preparingCount + report.readyCount}
                  <div style={{ fontSize: "9pt", color: "#666", marginTop: 2 }}>
                    انتظار {report.pendingCount} · تحضير {report.preparingCount} · جاهز {report.readyCount}
                  </div>
                </td>
                <td style={{ textAlign: "center", fontWeight: 800 }}>{report.servedCount}</td>
                <td style={{ textAlign: "center", fontWeight: 800 }}>{report.cancelledCount}</td>
                <td style={{ textAlign: "center", fontWeight: 800 }}>{report.qtyTotal}</td>
                <td style={{ textAlign: "center", fontWeight: 800 }}>{report.totalCost.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {/* Financial Summary */}
          <div className="print-subheader">التكلفة</div>
          <table style={{ width: "100%", marginBottom: 12 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700 }}>السلة</td>
                <td style={{ textAlign: "left", fontWeight: 800 }}>{report.totalCost.toFixed(2)} ج.م</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>الخدمة ({policy.servicePercent}%)</td>
                <td style={{ textAlign: "left", fontWeight: 800 }}>{reportFinancials?.svc.toFixed(2)} ج.م</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>VAT ({policy.vatPercent}%)</td>
                <td style={{ textAlign: "left", fontWeight: 800 }}>{reportFinancials?.vat.toFixed(2)} ج.م</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>واصل للطاولة (قيمة)</td>
                <td style={{ textAlign: "left", fontWeight: 800 }}>{(report.totalCost - report.pendingCost).toFixed(2)} ج.م</td>
              </tr>
              <tr style={{ background: "#f5f5f5" }}>
                <td style={{ fontWeight: 900, fontSize: "11pt" }}>الإجمالي</td>
                <td style={{ textAlign: "left", fontWeight: 900, fontSize: "11pt", color: "#000" }}>
                  {reportFinancials?.total.toFixed(2)} ج.م
                </td>
              </tr>
            </tbody>
          </table>

          {/* Alerts */}
          {report.sessionId && billReqIds.has(report.sessionId) ? (
            <div className="print-alert print-alert-danger">
              ⚠️ طلب حساب معلق — لا يمكن إضافة أصناف جديدة
            </div>
          ) : null}
          {Number(report.noOrderDelayMinutes || 0) >= 10 ? (
            <div className="print-alert print-alert-warning">
              ⏱️ تأخر أخذ الطلب بعد التسكين ({report.noOrderDelayMinutes} دقيقة)
            </div>
          ) : null}
          {report.readyCount > 0 ? (
            <div className="print-alert print-alert-success">
              ✅ {report.readyCount} طلب جاهز بالمطبخ — استدعِ الرنر
            </div>
          ) : null}

          {/* Recent Orders */}
          <div className="print-subheader">الطلبات المرسلة</div>
          {report.lines.length === 0 ? (
            <div style={{ color: "#666", fontSize: "10pt", padding: "8px 0" }}>لا توجد طلبات على هذه الطاولة.</div>
          ) : (
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: "15%" }}>رقم الطلب</th>
                  <th style={{ width: "15%" }}>الحالة</th>
                  <th style={{ width: "20%" }}>الوقت</th>
                  <th style={{ width: "10%" }}>العناصر</th>
                  <th style={{ width: "20%" }}>القيمة</th>
                  <th style={{ width: "20%" }}>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((l) => {
                  const s = String(l.status || "").toLowerCase();
                  const map: Record<string, string> = {
                    pending: "انتظار",
                    preparing: "تحضير",
                    ready: "جاهز",
                    served: "مُقدَّم",
                    cancelled: "ملغى",
                    paid: "مدفوع",
                  };
                  return (
                    <tr key={l.id + l.time} className="avoid-break">
                      <td style={{ textAlign: "center", fontWeight: 700 }}>{l.id || "—"}</td>
                      <td style={{ textAlign: "center" }}>{map[s] || s}</td>
                      <td style={{ textAlign: "center", fontSize: "9pt" }}>{l.time || "—"}</td>
                      <td style={{ textAlign: "center" }}>{l.qty}</td>
                      <td style={{ textAlign: "left", fontWeight: 700 }}>{l.total.toFixed(2)} ج.م</td>
                      <td style={{ fontSize: "9pt" }}>
                        {l.items.length > 0 ? (
                          <ul style={{ margin: 0, padding: "0 14px 0 0", listStyle: "disc" }}>
                            {l.items.map((it, idx) => (
                              <li key={idx}>
                                {it.quantity} × {it.name}
                                {it.unitPrice > 0 ? ` — ${Math.round(it.unitPrice)} ج.م` : ""}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Footer */}
          <div className="print-footer">
            تم إنشاء هذا التقرير في {new Date().toLocaleString("ar-EG")} — نظام إدارة المطاعم
          </div>
        </div>
      ) : null}
    </div>
  );
}
