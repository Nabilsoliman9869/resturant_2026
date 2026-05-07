import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { buildMat3amActor } from "../lib/mat3amActor";
import { tryParseJson } from "../lib/tryParseJson";
import { briefNetworkHint, safeFetch } from "../lib/safeFetch";
import { buildSegmentedTablesFromFloorPlan, type SegmentedTableRow } from "../lib/restaurantTableView";
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
  captainClaimedAt?: string;
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
type TableReport = {
  tableName: string;
  sessionId: string | null;
  startTime: string | null;
  orderCount: number;
  qtyTotal: number;
  qtyArrived: number;
  qtyKitchen: number;
  totalCost: number;
  pendingCost: number;
  noOrderDelayMinutes?: number;
  lines: Array<{ id: string; time: string; status: string; qty: number; total: number }>;
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
  const [reportPos, setReportPos] = useState({ x: 0, y: 0 });
  const [exclusiveOn, setExclusiveOn] = useState(false);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [reassignSid, setReassignSid] = useState<string | null>(null);
  const [reassignPickId, setReassignPickId] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [reassignBusy, setReassignBusy] = useState(false);
  const [alertPresets, setAlertPresets] = useState<AlertPreset[]>([]);
  const [alertPickByTable, setAlertPickByTable] = useState<Record<string, string>>({});
  const [alertBusyByTable, setAlertBusyByTable] = useState<Record<string, boolean>>({});
  const [minChargeDraftByTable, setMinChargeDraftByTable] = useState<Record<string, string>>({});
  const [minChargeBusyByTable, setMinChargeBusyByTable] = useState<Record<string, boolean>>({});
  const [vipTemplates, setVipTemplates] = useState<VipTemplate[]>([]);
  const [ownersVipAgents, setOwnersVipAgents] = useState<OwnersVipAgent[]>([]);
  const [vipChoiceBySession, setVipChoiceBySession] = useState<Record<string, string>>({});
  const [vipBusySessionId, setVipBusySessionId] = useState<string>("");
  const [captainTransferBusySessionId, setCaptainTransferBusySessionId] = useState<string>("");

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
    try {
      const [fp, rt, rs, ro, wf, ops] = await Promise.all([
        safeFetch(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
        safeFetch(`${base}/api/restaurant/tables`),
        safeFetch(`${base}/api/restaurant/table-sessions?status=active`),
        safeFetch(`${base}/api/restaurant/orders`),
        safeFetch(`${base}/api/restaurant/workflow-settings`),
        safeFetch(`${base}/api/restaurant/ops-settings`),
      ]);
      const fpj = (tryParseJson(await fp.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const jt = (tryParseJson(await rt.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const js = (tryParseJson(await rs.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const oj = (tryParseJson(await ro.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const wfj = (tryParseJson(await wf.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const opsj = (tryParseJson(await ops.text().catch(() => "")) ?? {}) as Record<string, unknown>;
      const httpLabel = (r: Response, nameAr: string) =>
        `${nameAr} (${r.status === 0 ? "لا اتصال — شغّل API 2288" : `HTTP ${r.status}`})`;
      const bad: string[] = [];
      if (!fp.ok) bad.push(httpLabel(fp, "خريطة الصالة"));
      if (!rt.ok) bad.push(httpLabel(rt, "الطاولات"));
      if (!rs.ok) bad.push(httpLabel(rs, "الجلسات"));
      if (!ro.ok) bad.push(httpLabel(ro, "الطلبات"));
      if (!wf.ok) bad.push(httpLabel(wf, "إعداد المسند"));
      if (!ops.ok) bad.push(httpLabel(ops, "إعدادات Owner/VIP"));
      if (bad.length) {
        setMsg(
          `تعذّر تحميل البيانات: ${bad.join(" · ")}. إن ظهر «لا اتصال» فشغّل run_api.bat ثم افتح http://127.0.0.1:2288/api/ping`,
        );
        setTables([]);
        setSessionByTable(new Map());
        setSessions([]);
        setOrders([]);
        return;
      }
      setMsg("");
      const ex = String((wfj as { orderTakerExclusiveTable?: string })?.orderTakerExclusiveTable || "").toLowerCase();
      setExclusiveOn(ex === "on" || ex === "1" || ex === "true" || ex === "yes");

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

      const apiTables: RestTable[] = Array.isArray(jt["tables"]) ? (jt["tables"] as RestTable[]) : [];
      const planRaw = fpj["plan"];
      const statusById = new Map<string, string>();
      for (const t of apiTables as any[]) statusById.set(String(t?.id || ""), normalizeTableStatus(String(t?.status || "")));
      setTables(
        buildSegmentedTablesFromFloorPlan(planRaw, apiTables).map((t: any) => ({
          ...t,
          status: statusById.get(String(t?.id || "")) || normalizeTableStatus(String(t?.status || "")),
          noOrderOverdue: Boolean((apiTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.noOrderOverdue),
          noOrderMinutes: Number((apiTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.noOrderMinutes || 0),
          cleanupOverdue: Boolean((apiTables as any[]).find((x: any) => String(x?.id || "") === String(t?.id || ""))?.cleanupOverdue),
        })),
      );

      setMinChargeDraftByTable((prev) => {
        const next = { ...prev };
        for (const t of apiTables as any[]) {
          const tid = String(t?.id || "").trim();
          if (!tid) continue;
          if (next[tid] != null && String(next[tid]).trim() !== "") continue;
          const mc = Number(t?.minimumCharge ?? 0);
          next[tid] = Number.isFinite(mc) ? String(Math.max(0, mc)) : "0";
        }
        return next;
      });
      const m = new Map<string, string>();
      const sessions = (Array.isArray(js["sessions"]) ? js["sessions"] : []).filter((s: unknown) =>
        isTodayIso(String((s as TableSession)?.startTime || "")),
      ) as TableSession[];
      setSessions(sessions);
      for (const s of sessions) {
        const tid = s?.tableId != null ? String(s.tableId) : "";
        const sid = s?.id != null ? String(s.id) : "";
        if (tid && sid) m.set(tid, sid);
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
        if (tid && ["pending", "preparing"].includes(st)) busy.add(tid);
      }
      setBusyIds(busy);
      setBillReqIds(billreq);
    } catch (e) {
      setMsg(briefNetworkHint(e));
    }
  }, [base]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      await loadTables();
    };
    void tick();
    const id = window.setInterval(() => void tick(), 7000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [loadTables]);

  useEffect(() => {
    const r = user?.role;
    if (r !== "manager" && r !== "developer") return;
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

  /**
   * تسكين كابتن من شريحة الطاولة:
   * - بدون جلسة نشطة → ننشئها بـ POST؛ الخادم يُسكِّن المُرسِل تلقائياً (waiter/host/manager/developer)
   *   عبر `_restaurant_assign_captain_from_actor_if_needed` (api_server.py).
   * - بجلسة نشطة بلا كابتن (أو لتأكيد الكابتن) → نستخدم مسار `/claim-order-taker` كما كان.
   * بهذا السلوك يصبح زر «تسكين» في الشريحة هو الفعل الأول الذي يحجز الطاولة على المُسكِّن.
   */
  async function claimCaptain(args: { tableId: string; sessionId?: string | null }) {
    const { tableId, sessionId } = args;
    setMsg("");
    const actor = buildMat3amActor(user);
    if (!actor?.id) {
      setMsg("تعذر تحديد المستخدم — أعد تسجيل الدخول.");
      return;
    }
    setClaimBusy(true);
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
          },
        );
        okMessage = "تم تسكينك كابتن على هذه الجلسة.";
      } else {
        r = await safeFetch(`${base}/api/restaurant/table-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableId,
            mat3amActor: actor,
            assignOrderTaker: true,
            startedByRole: actor.role,
            startReason: "captain_seat_from_table_card",
          }),
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
      setMsg(okMessage);
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setClaimBusy(false);
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
        `${base}/api/restaurant/table-sessions/${encodeURIComponent(sessionId)}/request-captain-transfer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mat3amActor: actor }),
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
      setMsg("تم إرسال طلب تحويل الكابتن — سيصل للزملاء بنفس الدور الفعّال اليوم في الجرس الأحمر.");
      await loadTables();
    } catch (e) {
      setMsg(briefNetworkHint(e));
    } finally {
      setCaptainTransferBusySessionId("");
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
    if (!(user?.role === "manager" || user?.role === "developer")) return;
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
        body: JSON.stringify({ minimumCharge: mc }),
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
      setMsg("تم حفظ minimum charge للطاولة.");
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

  const costByTableId = useCallback(
    (tableId: string, sessionId: string | null) => {
      const tid = String(tableId || "");
      const sid = sessionId ? String(sessionId) : "";
      const related = orders
        .filter((o) => String(o?.tableId || "") === tid || (sid ? String(o?.sessionId || "") === sid : false))
        .filter((o) => isTodayIso(String(o?.createdAt || "")));
      const totalCost = related.reduce((a, o) => a + orderTotal(o), 0);
      const pendingCost = related
        .filter((o) => isKitchen(String(o?.status || "").toLowerCase()))
        .reduce((a, o) => a + orderTotal(o), 0);
      return { totalCost, pendingCost, orderCount: related.length };
    },
    [orders],
  );
  const showTableReport = (t: RestTable, ev: ReactMouseEvent<HTMLButtonElement>) => {
    ev.preventDefault();
    const tid = String(t.id);
    const session = sessions.find((s) => String(s?.tableId || "") === tid && String(s?.status || "").toLowerCase() === "active") || null;
    const sid = session?.id ? String(session.id) : null;
    const related = orders
      .filter((o) => String(o?.tableId || "") === tid || (sid ? String(o?.sessionId || "") === sid : false))
      .filter((o) => isTodayIso(String(o?.createdAt || "")))
      .sort((a, b) => String(a?.createdAt || "").localeCompare(String(b?.createdAt || "")));
    const lines = related.map((o) => {
      const st = String(o?.status || "").toLowerCase();
      const qty = orderQty(o);
      return {
        id: String(o?.id || "").slice(0, 8),
        time: String(o?.createdAt || "").replace("T", " ").slice(0, 16),
        status: st || "pending",
        qty,
        total: orderTotal(o),
      };
    });
    const qtyTotal = lines.reduce((a, l) => a + l.qty, 0);
    const qtyArrived = lines.filter((l) => isArrived(l.status)).reduce((a, l) => a + l.qty, 0);
    const qtyKitchen = lines.filter((l) => isKitchen(l.status)).reduce((a, l) => a + l.qty, 0);
    const totalCost = lines.reduce((a, l) => a + l.total, 0);
    const pendingCost = lines.filter((l) => isKitchen(l.status)).reduce((a, l) => a + l.total, 0);
    const persistedDelay = Number((session as any)?.firstOrderDelayMinutes || 0);
    const noOrderDelayMinutes = lines.length === 0 ? diffMinutesFromIso(session?.startTime || undefined) : persistedDelay;
    setReport({
      tableName: t.name,
      sessionId: sid,
      startTime: session?.startTime || null,
      orderCount: lines.length,
      qtyTotal,
      qtyArrived,
      qtyKitchen,
      totalCost,
      pendingCost,
      noOrderDelayMinutes,
      lines,
    });
    setReportPos({ x: ev.clientX, y: ev.clientY });
  };

  const orderTakerBase = location.pathname.startsWith("/app/manager")
    ? "/app/manager"
    : location.pathname.startsWith("/app/developer")
      ? "/app/developer"
      : "/app/waiter";

  const headerTitle =
    user?.role === "manager"
      ? "شريحات الطاولات — المدير"
      : user?.role === "developer"
        ? "شريحات الطاولات — مطوّر"
        : "جارسون الطلبات";

  return (
    <div className="role-op waiter-pos" onClick={() => setReport(null)}>
      <OperationalRoleHeader roleTitle={headerTitle} hideBack />

      <div className="role-op__main">
        <div className="waiter-tables-toolbar">
          <h2 className="role-op__section-title">اختر الطاولة</h2>
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
            const num = t.number != null ? `#${t.number}` : t.name;
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
              ? String(sessRow.captainName || sessRow.captainLogin || "").trim() || ""
              : "";
            const capId = sessRow ? String(sessRow.captainUserId || "").trim() : "";
            const bp = sessRow?.billingProfile;
            const vipOwnerLabel =
              bp && typeof bp === "object" && bp.active !== false
                ? String(bp.vipOwnerLabel || "").trim() || ""
                : "";
            const isVipTable = Boolean(t.features?.vipSection);
            const cardTone = notReady ? "blocked" : isBusy ? "busy" : "ready";
            const money = costByTableId(String(t.id), sidStr || null);
            const minRaw = String(minChargeDraftByTable[String(t.id)] ?? "").trim();
            const minCharge = Number(minRaw);
            const minOk = Number.isFinite(minCharge) ? Math.max(0, minCharge) : 0;
            const minGap = minOk > 0 && money.totalCost < minOk ? minOk - money.totalCost : 0;
            const alertPick = alertPickByTable[String(t.id)] ?? "";
            const alertBusy = Boolean(alertBusyByTable[String(t.id)]);
            const canEditMin = user?.role === "manager" || user?.role === "developer";
            return (
              <div key={t.id} className="waiter-tables-card-wrap">
              <button
                type="button"
                className={`role-op__pick-card waiter-tblcard--spec waiter-tables-card--${cardTone}${billReq ? " waiter-tables-card--bill" : ""}${vipOwnerLabel ? " waiter-tblcard--owner" : ""}`}
                onClick={() => {
                  if (notReady) {
                    setMsg("الطاولة غير جاهزة. أكمل دورة التنظيف أولًا.");
                    return;
                  }
                  if (
                    exclusiveOn &&
                    capId &&
                    user?.id &&
                    String(capId) !== String(user.id) &&
                    user.role !== "manager" &&
                    user.role !== "developer"
                  ) {
                    const nm = captainLabel || "كابتن آخر";
                    setMsg(`الطاولة مسندة إلى ${nm}. يتدخل المدير لتحويل الكابتن أو سجّل تسكينك إن كنت المسؤول.`);
                    return;
                  }
                  const q =
                    `tableId=${encodeURIComponent(t.id)}` +
                    (sidStr ? `&sessionId=${encodeURIComponent(sidStr)}` : "");
                  navigate(`${orderTakerBase}/order-taker?${q}`);
                }}
                onContextMenu={(ev) => showTableReport(t, ev)}
              >
                <div className="waiter-tblcard__spec-top">
                  <div className="waiter-tblcard__spec-id">
                    <span className="waiter-tblcard__spec-id-text">{num}</span>
                    {isVipTable ? <span className="waiter-tables-vip-pill">VIP</span> : null}
                    {vipOwnerLabel ? <span className="waiter-tables-owner-pill">{vipOwnerLabel}</span> : null}
                  </div>
                  <div className="waiter-tblcard__spec-meta-row">
                    <span className="waiter-tblcard__spec-seats">المقاعد: {t.seats ?? "—"}</span>
                    <span className="waiter-tblcard__mini-chip">{tStatus === "dirty" ? "متسخة" : tStatus === "cleaning" ? "قيد التنظيف" : isBusy ? "مشغولة" : "جاهزة"}</span>
                    {billReq ? <span className="waiter-tblcard__mini-chip" style={{ borderColor: "rgba(59,130,246,0.5)", background: "rgba(59,130,246,0.12)" }}>طلب حساب</span> : null}
                    {noOrderOverdue ? <span className="waiter-tblcard__mini-chip" title="تأخر أخذ الطلب">⏱ {noOrderMinutes} د</span> : null}
                  </div>
                  <div className="waiter-tblcard__spec-seated-by">
                    {captainLabel ? (
                      <span className="waiter-tblcard__spec-captain">كابتن: {captainLabel}</span>
                    ) : sidStr ? (
                      <span className="waiter-tblcard__spec-muted">لم يُسكَّن كابتن بعد</span>
                    ) : (
                      <span className="waiter-tblcard__spec-muted">لا توجد جلسة نشطة</span>
                    )}
                  </div>
                  {cleanupOverdue ? <div className="waiter-tblcard__session-gap">تنبيه: تأخر تنظيف أكثر من 10 دقائق</div> : null}
                </div>

                <div className="waiter-tblcard__spec-row1" onClick={(e) => e.stopPropagation()}>
                  <div className="waiter-tblcard__pill-row">
                    <button
                      type="button"
                      className="waiter-tblcard__pill waiter-tblcard__pill--assign"
                      disabled={
                        claimBusy ||
                        notReady ||
                        Boolean(
                          exclusiveOn &&
                            capId &&
                            user?.id &&
                            String(capId) !== String(user.id) &&
                            user.role !== "manager" &&
                            user.role !== "developer",
                        )
                      }
                      onClick={() => void claimCaptain({ tableId: String(t.id), sessionId: sidStr || null })}
                      title={
                        capId && user?.id && String(capId) === String(user.id)
                          ? "أنت الكابتن على هذه الجلسة"
                          : sidStr
                            ? "تسكين كابتن (ربط الطاولة على المسند)"
                            : "بدء جلسة وتسكين نفسك على الطاولة"
                      }
                    >
                      {capId && user?.id && String(capId) === String(user.id)
                        ? "أنت الكابتن ✓"
                        : sidStr
                          ? "تسكين كابتن"
                          : "ابدأ التسكين"}
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
                        title="إرسال تنبيه للزملاء بنفس الدور الفعّال اليوم — قبول من الجرس الأحمر"
                      >
                        {captainTransferBusySessionId === sidStr ? "…" : "طلب تحويل"}
                      </button>
                    ) : null}

                    {(user?.role === "manager" || user?.role === "developer") && sidStr ? (
                      <button
                        type="button"
                        className="waiter-tblcard__pill"
                        disabled={notReady}
                        onClick={() => {
                          setReassignSid(sidStr);
                          setReassignPickId("");
                        }}
                        title="تغيير/تحويل الكابتن"
                      >
                        تغيير كابتن
                      </button>
                    ) : null}
                  </div>

                  <div className="waiter-tblcard__pill-row waiter-tblcard__pill-row--solo">
                    <span className={`waiter-tblcard__pill ${notReady ? "waiter-tblcard__pill--dirty" : isBusy ? "waiter-tblcard__pill--busy" : "waiter-tblcard__pill--ready"}`}>
                      {notReady ? (tStatus === "dirty" ? "متسخة" : "قيد التنظيف") : isBusy ? "مشغولة" : "جاهزة"}
                    </span>
                    {billReq ? <span className="waiter-tblcard__pill">طلب حساب</span> : null}
                  </div>
                </div>

                {sidStr ? (
                  <div
                    style={{ marginTop: 8, display: "grid", gridTemplateColumns: "minmax(0,1fr) 86px", gap: 8, width: "100%", alignItems: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
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
                      title="ربط الطاولة على Owner/VIP"
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
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontWeight: 900, whiteSpace: "nowrap", padding: "0.35rem 0.5rem", width: "100%", minWidth: 0 }}
                      disabled={vipBusySessionId === sidStr}
                      onClick={() => {
                        const chosen = vipChoiceBySession[sidStr] ?? "";
                        void applyVipBilling(sidStr, chosen);
                      }}
                      title="تطبيق Owner/VIP على الجلسة"
                    >
                      {vipBusySessionId === sidStr ? "…" : "تطبيق"}
                    </button>
                  </div>
                ) : null}

                <div className="waiter-tblcard__spec-open">
                  <button
                    type="button"
                    className="waiter-tblcard__open-order"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (notReady) {
                        setMsg("الطاولة غير جاهزة. أكمل دورة التنظيف أولًا.");
                        return;
                      }
                      if (
                        exclusiveOn &&
                        capId &&
                        user?.id &&
                        String(capId) !== String(user.id) &&
                        user.role !== "manager" &&
                        user.role !== "developer"
                      ) {
                        const nm = captainLabel || "كابتن آخر";
                        setMsg(`الطاولة مسندة إلى ${nm}. يتدخل المدير لتحويل الكابتن أو سجّل تسكينك إن كنت المسؤول.`);
                        return;
                      }
                      const q = `tableId=${encodeURIComponent(t.id)}` + (sidStr ? `&sessionId=${encodeURIComponent(sidStr)}` : "");
                      navigate(`${orderTakerBase}/order-taker?${q}`);
                    }}
                  >
                    فتح الطلب
                  </button>
                </div>

                <div className="waiter-tblcard__spec-money">
                  <div className="waiter-tblcard__money-est">
                    <div className="waiter-tblcard__money-est-label">قيمة تقديرية</div>
                    <div className="waiter-tblcard__money-est-val">{money.totalCost.toFixed(0)} ج</div>
                  </div>
                  <div className="waiter-tblcard__money-min-stack" onClick={(e) => e.stopPropagation()}>
                    {canEditMin ? (
                      <input
                        className="waiter-tblcard__money-input"
                        type="number"
                        min={0}
                        step={1}
                        value={minChargeDraftByTable[String(t.id)] ?? ""}
                        onChange={(e) => setMinChargeDraftByTable((p) => ({ ...p, [String(t.id)]: e.target.value }))}
                        disabled={Boolean(minChargeBusyByTable[String(t.id)])}
                        title="Minimum charge للطاولة"
                      />
                    ) : (
                      <div className="waiter-tblcard__money-min-readout">{minOk.toFixed(0)}</div>
                    )}
                    <div className="waiter-tblcard__money-min-hint">minimum</div>
                  </div>
                  <div className="waiter-tblcard__money-min-label">
                    {canEditMin ? (
                      <button
                        type="button"
                        className="waiter-tblcard__pill waiter-tblcard__pill--clean-done"
                        onClick={(e) => {
                          e.stopPropagation();
                          void saveMinimumCharge(String(t.id));
                        }}
                        disabled={Boolean(minChargeBusyByTable[String(t.id)])}
                      >
                        {Boolean(minChargeBusyByTable[String(t.id)]) ? "…" : "حفظ"}
                      </button>
                    ) : (
                      <span className="waiter-tblcard__spec-muted">حد أدنى للطاولة</span>
                    )}
                  </div>
                </div>

                {minGap > 0 ? (
                  <div className="waiter-tblcard__spec-min-gap">فرق الحد الأدنى: {minGap.toFixed(0)} ج</div>
                ) : null}

                <div className="waiter-tblcard__spec-alert" onClick={(e) => e.stopPropagation()}>
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
                    title="تنبيه كاشير سريع من إعدادات التشغيل — ليست قائمة عملاء الملاك"
                  >
                    <option value="">— اختر —</option>
                    {alertPresets.map((x) => (
                      <option key={`al-${x.id}`} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="waiter-tblcard__spec-footer">
                  <button type="button" className="waiter-tblcard__report" onClick={(e) => showTableReport(t, e as any)}>
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
              </button>
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
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: Math.min(reportPos.y + 8, window.innerHeight - 360),
            left: Math.min(reportPos.x + 8, window.innerWidth - 440),
            width: 420,
            maxWidth: "95vw",
            maxHeight: "72vh",
            overflow: "auto",
            zIndex: 1000,
            background: "#ffffff",
            border: "2px solid #0ea5e9",
            borderRadius: 14,
            boxShadow: "0 16px 40px rgba(2,6,23,0.25)",
            padding: "0.8rem 0.9rem",
            direction: "rtl",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 900 }}>تقرير الطاولة {report.tableName}</div>
            <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ padding: "2px 10px" }} onClick={() => setReport(null)}>
              ×
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: "0.86rem", color: "#0f172a", display: "grid", gap: 4 }}>
            <div>وقت التسكين: {report.startTime ? new Date(report.startTime).toLocaleString("ar-EG") : "غير متاح"}</div>
            <div>عدد الطلبات: {report.orderCount}</div>
            <div>إجمالي العناصر: {report.qtyTotal}</div>
            <div>وصل منها: {report.qtyArrived}</div>
            <div>باقي بالمطبخ: {report.qtyKitchen}</div>
            <div>التكلفة الحالية: {report.totalCost.toFixed(2)} ج.م</div>
            <div>قيمة المتبقي حتى الوصول: {report.pendingCost.toFixed(2)} ج.م</div>
            {Number(report.noOrderDelayMinutes || 0) >= 10 ? (
              <div style={{ color: "#7c3aed", fontWeight: 800 }}>
                تنبيه: تأخر أخذ الطلب بعد التسكين ({report.noOrderDelayMinutes} دقيقة)
              </div>
            ) : null}
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid #cbd5e1", paddingTop: 8, display: "grid", gap: 6 }}>
            {report.lines.length === 0 ? (
              <div style={{ color: "#64748b" }}>لا توجد طلبات على هذه الطاولة.</div>
            ) : (
              report.lines.map((l) => (
                <div key={l.id + l.time} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "6px 8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
                    <span>طلب {l.id || "—"}</span>
                    <span>{l.status}</span>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#475569", marginTop: 2 }}>{l.time || "—"}</div>
                  <div style={{ fontSize: "0.86rem", marginTop: 3 }}>العناصر: {l.qty} · القيمة: {l.total.toFixed(2)} ج.م</div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
