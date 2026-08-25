import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { roleHasManagerOpsAccess } from "../auth/roles";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { CashierPayInvoiceModal } from "./CashierPayInvoiceModal";
import {
  ManagerTableInstructionsMenu,
  managerOrderTakerBase,
  type ManagerTableInstructionItem,
} from "./ManagerTableInstructionsMenu";
import { ManagerTableChecksModal } from "./ManagerTableChecksModal";
import "../styles/hallLiveBoard.css";

export type TableOverviewAwaitingInvoice = {
  invoiceId: string;
  splitName?: string | null;
  seats?: number[];
  total?: number;
  billNumber?: number | null;
  isOwnerCheck?: boolean;
  agentName?: string | null;
};

export type TableOverviewSession = {
  sessionId: string;
  tableId?: string;
  tableDisplayName?: string;
  guestCount?: number;
  billingRequestedAt?: string | null;
  awaitingPayment?: boolean;
  awaitingInvoiceId?: string | null;
  awaitingInvoices?: TableOverviewAwaitingInvoice[];
  awaitingInvoiceCount?: number;
  billAgeMinutes?: number;
  orderCount?: number;
  kitchenInProgressCount?: number;
  linesPreview?: string;
  itemsSubtotal?: number;
  minimumCharge?: number;
  minimumGap?: number;
  startTime?: string | null;
  sessionAgeMinutes?: number;
  lastOrderAt?: string | null;
  idleMinutes?: number;
  captainName?: string | null;
  captainLogin?: string | null;
  zone?: string | null;
  mergedIntoSessionId?: string | null;
  isMergedSource?: boolean;
  isMergedHost?: boolean;
  mergedSourceCount?: number;
  pendingReturnCount?: number;
  agentName?: string | null;
  customerType?: string | null;
};

type FilterKey = "all" | "pay" | "bill" | "long" | "idle" | "returns" | "merge";
type ViewMode = "table" | "cards";

function awaitingChecks(s: TableOverviewSession): TableOverviewAwaitingInvoice[] {
  if (Array.isArray(s.awaitingInvoices) && s.awaitingInvoices.length > 0) {
    return s.awaitingInvoices.filter((x) => String(x?.invoiceId || "").trim());
  }
  if (s.awaitingPayment && s.awaitingInvoiceId) {
    return [{ invoiceId: String(s.awaitingInvoiceId) }];
  }
  return [];
}

function checkChipLabel(c: TableOverviewAwaitingInvoice): string {
  const seats = Array.isArray(c.seats) ? c.seats : [];
  if (c.splitName) return String(c.splitName);
  if (seats.length === 1) return `كرسي ${seats[0]}${c.isOwnerCheck ? " ★" : ""}`;
  if (seats.length > 1) return `كراسي ${seats.join("+")}${c.isOwnerCheck ? " ★" : ""}`;
  if (c.billNumber != null) return `#${c.billNumber}`;
  return "شيك";
}

const POLL_MS = 28000;
const LONG_MIN = 45;
const IDLE_MIN = 25;
function fmtMoney(n: number) {
  return `${(Number.isFinite(n) ? n : 0).toFixed(0)} ج.م`;
}

function fmtMins(m: number) {
  const n = Math.max(0, Math.floor(m || 0));
  if (n < 60) return `${n} د`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}س ${r}د` : `${h}س`;
}

function statusMeta(s: TableOverviewSession) {
  const pay = Boolean(s.awaitingPayment);
  const bill = Boolean(s.billingRequestedAt);
  // أحمر فوري: طُلب الحساب / طُبع الشيك ولم يُقفَل الحساب بعد (تنبيه كاشير/مدير)
  if (pay || bill) {
    return {
      key: "urgent" as const,
      label: pay ? "شيك مطبوع — بانتظار التسديد" : "طُلِب الحساب — لم يُقفَل",
      cls: "hall-live-board__status--urgent",
    };
  }
  return { key: "active" as const, label: "نشطة", cls: "hall-live-board__status--active" };
}

function rowTone(s: TableOverviewSession): "" | "hall-live-board__row--pay" | "hall-live-board__row--urgent" {
  const st = statusMeta(s);
  if (st.key === "urgent") return "hall-live-board__row--urgent";
  return "";
}

export function CashierTableStripBoard() {
  const base = getApiBase();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isManager = roleHasManagerOpsAccess(user?.role);
  const [sessions, setSessions] = useState<TableOverviewSession[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [view, setView] = useState<ViewMode>("table");
  const [zoneFilter, setZoneFilter] = useState("");
  const [captainFilter, setCaptainFilter] = useState("");
  const [inspect, setInspect] = useState<TableOverviewSession | null>(null);
  const [mgrMenu, setMgrMenu] = useState<{ x: number; y: number; session: TableOverviewSession } | null>(null);
  const [mgrChecks, setMgrChecks] = useState<{ id: string; label: string } | null>(null);

  function openManagerPos(s: TableOverviewSession) {
    const tid = String(s.tableId || "").trim();
    if (!tid) {
      setMsg("لا يوجد معرّف طاولة لهذه الجلسة.");
      return;
    }
    const basePath = managerOrderTakerBase(location.pathname);
    const q =
      `tableId=${encodeURIComponent(tid)}` +
      (s.sessionId ? `&sessionId=${encodeURIComponent(String(s.sessionId))}` : "");
    navigate(`${basePath}/order-taker?${q}`);
  }

  function openMgrMenu(s: TableOverviewSession, ev: ReactMouseEvent) {
    if (!isManager) return;
    ev.preventDefault();
    ev.stopPropagation();
    setMgrMenu({ x: ev.clientX, y: ev.clientY, session: s });
  }

  function buildMgrItems(s: TableOverviewSession): ManagerTableInstructionItem[] {
    const items: ManagerTableInstructionItem[] = [
      {
        id: "open-pos",
        label: "فتح نقطة بيع جرسون الطلبات",
        hint: "تعليمات المدير — دخول نقطة البيع لنفس الطاولة",
        primary: true,
        disabled: !String(s.tableId || "").trim(),
        onSelect: () => openManagerPos(s),
      },
      {
        id: "captain-tables",
        label: "فتح شريحات الطاولات",
        hint: "لوحة الكابتن الكاملة للتحويل والدمج والتنظيف",
        onSelect: () => {
          const basePath = managerOrderTakerBase(location.pathname);
          navigate(`${basePath}/captain-tables`);
        },
      },
    ];
    const checks = awaitingChecks(s);
    if (checks.length === 1) {
      items.push({
        id: "pay",
        label: `تسديد — ${checkChipLabel(checks[0]!)}`,
        hint: "فتح نافذة التسديد للكاشير/المدير",
        onSelect: () => openPay(String(checks[0]!.invoiceId)),
      });
    } else if (checks.length > 1) {
      for (const c of checks) {
        items.push({
          id: `pay-${c.invoiceId}`,
          label: `تسديد — ${checkChipLabel(c)}`,
          hint: c.total != null ? `${Number(c.total).toFixed(2)} ج.م` : "شيك بانتظار الدفع",
          onSelect: () => openPay(String(c.invoiceId)),
        });
      }
    }
    items.push({
      id: "table-checks",
      label: "شيكات الطاولة…",
      hint: "كل الشيكات على الطاولة — فتح / طباعة / تصحيح",
      disabled: !String(s.tableId || "").trim(),
      onSelect: () =>
        setMgrChecks({
          id: String(s.tableId || ""),
          label: String(s.tableDisplayName || s.tableId || "طاولة"),
        }),
    });
    items.push({
      id: "details",
      label: "تفاصيل الجلسة",
      onSelect: () => setInspect(s),
    });
    return items;
  }

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/table-overview`);
      const txt = await r.text();
      const j = tryParseJson<{ sessions?: TableOverviewSession[]; generatedAt?: string; detail?: unknown }>(txt) ?? {};
      if (!r.ok) {
        const d = j.detail;
        throw new Error(typeof d === "string" ? d : "فشل تحميل الملخص");
      }
      setSessions(Array.isArray(j.sessions) ? j.sessions : []);
      setGeneratedAt(typeof j.generatedAt === "string" ? j.generatedAt : "");
      setMsg("");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInspect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspect]);

  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      const z = String(s.zone || "").trim();
      if (z) set.add(z);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ar"));
  }, [sessions]);

  const captains = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      const c = String(s.captainName || s.captainLogin || "").trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ar"));
  }, [sessions]);

  const kpis = useMemo(() => {
    const active = sessions.length;
    const pay = sessions.filter((s) => s.awaitingPayment).length;
    const bill = sessions.filter((s) => s.billingRequestedAt && !s.awaitingPayment).length;
    const kitchen = sessions.reduce((a, s) => a + (Number(s.kitchenInProgressCount) || 0), 0);
    const returns = sessions.reduce((a, s) => a + (Number(s.pendingReturnCount) || 0), 0);
    const openValue = sessions.reduce((a, s) => a + (Number(s.itemsSubtotal) || 0), 0);
    const long = sessions.filter((s) => Number(s.sessionAgeMinutes || 0) >= LONG_MIN).length;
    const idle = sessions.filter((s) => Number(s.idleMinutes || 0) >= IDLE_MIN && !s.awaitingPayment).length;
    const avgAge =
      active > 0
        ? Math.round(sessions.reduce((a, s) => a + (Number(s.sessionAgeMinutes) || 0), 0) / active)
        : 0;
    return { active, pay, bill, kitchen, returns, openValue, long, idle, avgAge };
  }, [sessions]);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (zoneFilter && String(s.zone || "").trim() !== zoneFilter) return false;
      if (captainFilter) {
        const c = String(s.captainName || s.captainLogin || "").trim();
        if (c !== captainFilter) return false;
      }
      if (filter === "pay") return Boolean(s.awaitingPayment);
      if (filter === "bill") return Boolean(s.billingRequestedAt) && !s.awaitingPayment;
      if (filter === "long") return Number(s.sessionAgeMinutes || 0) >= LONG_MIN;
      if (filter === "idle") return Number(s.idleMinutes || 0) >= IDLE_MIN && !s.awaitingPayment;
      if (filter === "returns") return Number(s.pendingReturnCount || 0) > 0;
      if (filter === "merge") return Boolean(s.isMergedHost || s.isMergedSource);
      return true;
    });
  }, [sessions, filter, zoneFilter, captainFilter]);

  function openPay(invoiceId: string) {
    setPayInvoiceId(invoiceId);
    setPayOpen(true);
  }

  if (loading && sessions.length === 0) {
    return (
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ margin: 0, color: "var(--muted)" }}>جاري تحميل ملخص الطاولات…</p>
      </div>
    );
  }

  return (
    <div className="card hall-live-board" style={{ marginBottom: "1rem" }}>
      <CashierPayInvoiceModal
        open={payOpen}
        invoiceId={payInvoiceId}
        initialRow={null}
        onClose={() => {
          setPayOpen(false);
          setPayInvoiceId(null);
        }}
        onPaid={() => {
          void load();
          setInspect(null);
        }}
      />

      {inspect ? (
        <InspectDrawer
          s={inspect}
          onClose={() => setInspect(null)}
          onPay={(id) => openPay(id)}
        />
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>قائمة الطاولات المفتوحة (حية)</h3>
          {isManager ? (
            <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 2 }}>
              يمين على الطاولة = تعليمات المدير (فتح نقطة بيع جرسون الطلبات…)
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {generatedAt ? (
            <span style={{ fontSize: "0.72rem", color: "var(--muted)" }} title={generatedAt}>
              تحديث: {generatedAt.replace("T", " ").slice(0, 19)}
            </span>
          ) : null}
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={() => void load()}>
            تحديث
          </button>
          <NavLink to="../table-sessions" className="btn btn-ghost" style={{ fontSize: "0.78rem", textDecoration: "none" }}>
            جلسات
          </NavLink>
          <NavLink to="../invoices-local" className="btn btn-ghost" style={{ fontSize: "0.78rem", textDecoration: "none" }}>
            تسديد
          </NavLink>
        </div>
      </div>

      {msg ? <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>{msg}</p> : null}

      <div className="hall-live-board__kpi-grid">
        <Kpi label="نشطة" value={String(kpis.active)} onClick={() => setFilter("all")} active={filter === "all"} />
        <Kpi label="انتظار دفع" value={String(kpis.pay)} tone="#facc15" onClick={() => setFilter("pay")} active={filter === "pay"} />
        <Kpi label="طُلِب الحساب" value={String(kpis.bill)} tone="#fb923c" onClick={() => setFilter("bill")} active={filter === "bill"} />
        <Kpi label="مطبخ مفتوح" value={String(kpis.kitchen)} tone="#60a5fa" />
        <Kpi label="مرتجعات معلّقة" value={String(kpis.returns)} tone="#f472b6" onClick={() => setFilter("returns")} active={filter === "returns"} />
        <Kpi label="قيمة مفتوحة" value={fmtMoney(kpis.openValue)} />
        <Kpi label="متوسط المدة" value={fmtMins(kpis.avgAge)} onClick={() => setFilter("long")} active={filter === "long"} />
        <Kpi label="خمول طويل" value={String(kpis.idle)} tone="#a78bfa" onClick={() => setFilter("idle")} active={filter === "idle"} />
      </div>

      <div className="hall-live-board__filters">
        {(
          [
            ["all", "الكل"],
            ["pay", "تسديد"],
            ["bill", "طلب حساب"],
            ["long", `≥ ${LONG_MIN} د`],
            ["idle", "خمول"],
            ["returns", "مرتجعات"],
            ["merge", "مدموجة"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`hall-live-board__chip${filter === k ? " hall-live-board__chip--on" : ""}`}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}

        <select
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
          style={{ fontSize: "0.78rem", padding: "0.28rem 0.45rem", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "inherit" }}
          aria-label="القسم"
        >
          <option value="">كل الأقسام</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>

        <select
          value={captainFilter}
          onChange={(e) => setCaptainFilter(e.target.value)}
          style={{ fontSize: "0.78rem", padding: "0.28rem 0.45rem", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "inherit" }}
          aria-label="الكابتن"
        >
          <option value="">كل الكباتن</option>
          {captains.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <span style={{ flex: 1 }} />

        <button
          type="button"
          className={`hall-live-board__chip${view === "table" ? " hall-live-board__chip--on" : ""}`}
          onClick={() => setView("table")}
        >
          جدول
        </button>
        <button
          type="button"
          className={`hall-live-board__chip${view === "cards" ? " hall-live-board__chip--on" : ""}`}
          onClick={() => setView("cards")}
        >
          بطاقات
        </button>
      </div>

      {sessions.length === 0 ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>لا توجد جلسات نشطة.</p>
      ) : filtered.length === 0 ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>لا نتائج لهذا التصفية.</p>
      ) : view === "table" ? (
        <div className="hall-live-board__table-wrap">
          <table className="hall-live-board__table">
            <thead>
              <tr>
                <th>رقم الطاولة</th>
                <th>القسم</th>
                <th>الوقت المنقضي</th>
                <th>الإجمالي</th>
                <th>الخادم</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const st = statusMeta(s);
                const age = Number(s.sessionAgeMinutes || 0);
                return (
                  <tr
                    key={s.sessionId}
                    className={`hall-live-board__row ${rowTone(s)}`}
                    onClick={() => setInspect(s)}
                    onContextMenu={(ev) => openMgrMenu(s, ev)}
                    title={isManager ? "يمين: تعليمات المدير" : undefined}
                  >
                    <td>
                      <strong>{s.tableDisplayName || "طاولة"}</strong>
                      {s.isMergedHost || s.isMergedSource ? (
                        <span className="hall-live-board__badge" title="طاولة مدموجة">
                          🔗
                          {s.isMergedHost && s.mergedSourceCount ? ` +${s.mergedSourceCount}` : ""}
                        </span>
                      ) : null}
                      {Number(s.pendingReturnCount || 0) > 0 ? (
                        <span className="hall-live-board__badge" title="مرتجع معلّق" style={{ background: "rgba(244,114,182,0.2)" }}>
                          ↩ {s.pendingReturnCount}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ color: "var(--muted)" }}>{s.zone || "—"}</td>
                    <td>
                      {fmtMins(age)}
                      {Number(s.idleMinutes || 0) >= IDLE_MIN ? (
                        <span className="hall-live-board__badge" title="منذ آخر طلب" style={{ background: "rgba(167,139,250,0.18)" }}>
                          خمول {fmtMins(Number(s.idleMinutes || 0))}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ fontWeight: 800 }}>{fmtMoney(Number(s.itemsSubtotal || 0))}</td>
                    <td style={{ color: "var(--muted)" }}>{s.captainName || s.captainLogin || "—"}</td>
                    <td>
                      <span className={`hall-live-board__status ${st.cls}`}>{st.label}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {awaitingChecks(s).length > 0 ? (
                          awaitingChecks(s).map((c) => (
                            <button
                              key={c.invoiceId}
                              type="button"
                              className="btn btn-primary"
                              style={{ fontSize: "0.74rem", padding: "0.2rem 0.55rem" }}
                              title={c.total != null ? `${Number(c.total).toFixed(2)} ج.م` : undefined}
                              onClick={() => openPay(String(c.invoiceId))}
                            >
                              {checkChipLabel(c)}
                            </button>
                          ))
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: "0.74rem", padding: "0.2rem 0.55rem" }}
                            onClick={() => setInspect(s)}
                          >
                            تفاصيل
                          </button>
                        )}
                        {awaitingChecks(s).length === 0 ? (
                          <NavLink
                            to="../delivery-hub?tab=convert"
                            className="btn btn-ghost"
                            style={{ fontSize: "0.74rem", padding: "0.2rem 0.55rem", textDecoration: "none" }}
                          >
                            → دليفري
                          </NavLink>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "0.65rem",
          }}
        >
          {filtered.map((s) => (
            <TableStrip
              key={s.sessionId}
              s={s}
              onOpenPay={openPay}
              onInspect={() => setInspect(s)}
              onContextMenu={isManager ? (ev) => openMgrMenu(s, ev) : undefined}
            />
          ))}
        </div>
      )}
      {mgrMenu ? (
        <ManagerTableInstructionsMenu
          open
          x={mgrMenu.x}
          y={mgrMenu.y}
          tableLabel={String(mgrMenu.session.tableDisplayName || mgrMenu.session.tableId || "طاولة")}
          captainLabel={mgrMenu.session.captainName || mgrMenu.session.captainLogin || null}
          sessionHint={mgrMenu.session.sessionId ? `جلسة · ${String(mgrMenu.session.sessionId).slice(0, 8)}` : null}
          items={buildMgrItems(mgrMenu.session)}
          onClose={() => setMgrMenu(null)}
        />
      ) : null}
      {mgrChecks ? (
        <ManagerTableChecksModal
          open
          tableId={mgrChecks.id}
          tableLabel={mgrChecks.label}
          onClose={() => setMgrChecks(null)}
        />
      ) : null}
      {msg ? (
        <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#fca5a5" }} role="status">
          {msg}
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: string;
  tone?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const clickable = Boolean(onClick);
  return (
    <div
      className={`hall-live-board__kpi${clickable ? " hall-live-board__kpi--clickable" : ""}${active ? " hall-live-board__chip--on" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={active ? { borderColor: "rgba(34,211,238,0.55)" } : undefined}
    >
      <div className="hall-live-board__kpi-label">{label}</div>
      <div className="hall-live-board__kpi-value" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

function InspectDrawer({
  s,
  onClose,
  onPay,
}: {
  s: TableOverviewSession;
  onClose: () => void;
  onPay: (invoiceId: string) => void;
}) {
  const st = statusMeta(s);
  return (
    <div className="hall-live-board__drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="hall-live-board__drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="تفاصيل الطاولة"
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
          <div>
            <h3 style={{ margin: 0 }}>{s.tableDisplayName || "طاولة"}</h3>
            <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 4 }}>
              {s.zone || "بدون قسم"} · {s.captainName || s.captainLogin || "بدون كابتن"}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={onClose}>
            إغلاق
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <span className={`hall-live-board__status ${st.cls}`}>{st.label}</span>
          {s.isMergedHost || s.isMergedSource ? (
            <span className="hall-live-board__badge" style={{ marginInlineStart: 6 }}>
              🔗 {s.isMergedHost ? `مضيف دمج (+${s.mergedSourceCount || 0})` : "مدموجة إلى أخرى"}
            </span>
          ) : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
          <MiniStat label="المدة" value={fmtMins(Number(s.sessionAgeMinutes || 0))} />
          <MiniStat label="منذ آخر طلب" value={fmtMins(Number(s.idleMinutes || 0))} />
          <MiniStat label="تقريبي" value={fmtMoney(Number(s.itemsSubtotal || 0))} />
          <MiniStat label="ضيوف" value={String(s.guestCount ?? "—")} />
          <MiniStat label="طلبات" value={String(s.orderCount ?? 0)} />
          <MiniStat label="مطبخ" value={String(s.kitchenInProgressCount ?? 0)} />
        </div>

        {Number(s.minimumGap || 0) > 0 ? (
          <p style={{ margin: "10px 0 0", fontSize: "0.82rem", color: "#f87171", fontWeight: 700 }}>
            ناقص حد أدنى {Number(s.minimumGap).toFixed(0)} ج
          </p>
        ) : null}

        {Number(s.pendingReturnCount || 0) > 0 ? (
          <p style={{ margin: "8px 0 0", fontSize: "0.82rem", color: "#f472b6", fontWeight: 700 }}>
            مرتجعات بانتظار المدير: {s.pendingReturnCount}
          </p>
        ) : null}

        <div style={{ marginTop: 12, fontSize: "0.84rem", color: "var(--muted)", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 800, color: "inherit", marginBottom: 4 }}>بنود</div>
          {s.linesPreview || "—"}
        </div>

        <div className="hall-live-board__drawer-actions">
          {awaitingChecks(s).map((c) => (
            <button
              key={c.invoiceId}
              type="button"
              className="btn btn-primary"
              onClick={() => onPay(String(c.invoiceId))}
            >
              تسديد — {checkChipLabel(c)}
              {c.total != null ? ` (${Number(c.total).toFixed(2)})` : ""}
            </button>
          ))}
          <NavLink to="../invoices-local" className="btn btn-ghost" style={{ textDecoration: "none", textAlign: "center" }}>
            فتح فواتير الطاولات
          </NavLink>
          <NavLink to="../table-sessions" className="btn btn-ghost" style={{ textDecoration: "none", textAlign: "center" }}>
            إدارة الجلسات
          </NavLink>
          {Number(s.pendingReturnCount || 0) > 0 ? (
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)", textAlign: "center" }}>
              المرتجع المعلّق يُعتمد من شاشة المدير → مرتجعات الضيوف
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.45rem 0.55rem", background: "rgba(0,0,0,0.12)" }}>
      <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{value}</div>
    </div>
  );
}

function TableStrip({
  s,
  onOpenPay,
  onInspect,
  onContextMenu,
}: {
  s: TableOverviewSession;
  onOpenPay: (invoiceId: string) => void;
  onInspect: () => void;
  onContextMenu?: (ev: ReactMouseEvent) => void;
}) {
  const bill = Boolean(s.billingRequestedAt);
  const pay = Boolean(s.awaitingPayment);
  const sub = typeof s.itemsSubtotal === "number" ? s.itemsSubtotal : 0;
  const kc = typeof s.kitchenInProgressCount === "number" ? s.kitchenInProgressCount : 0;
  const oc = typeof s.orderCount === "number" ? s.orderCount : 0;
  const billAge = Math.max(0, Number(s.billAgeMinutes || 0));
  const minCharge = Math.max(0, Number(s.minimumCharge || 0));
  const minGap = Math.max(0, Number(s.minimumGap || 0));
  const st = statusMeta(s);

  const unpaidBill = pay || bill;
  let border = "1px solid var(--border)";
  if (unpaidBill) border = "2px solid rgba(239, 68, 68, 0.75)";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onInspect}
      onContextMenu={onContextMenu}
      title={onContextMenu ? "يمين: تعليمات المدير" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInspect();
        }
      }}
      style={{
        border,
        borderRadius: 10,
        padding: "0.65rem 0.75rem",
        cursor: "pointer",
        background: unpaidBill ? "rgba(239, 68, 68, 0.12)" : "rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "start" }}>
        <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>
          {s.tableDisplayName || "طاولة"}
          {s.isMergedHost || s.isMergedSource ? <span className="hall-live-board__badge">🔗</span> : null}
        </div>
        <span className={`hall-live-board__status ${st.cls}`}>{st.label}</span>
      </div>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 2 }}>
        {s.zone || "—"} · {s.captainName || s.captainLogin || "بدون كابتن"}
        {s.guestCount != null ? ` · ${s.guestCount} ضيف` : ""}
        {` · ${fmtMins(Number(s.sessionAgeMinutes || 0))}`}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, fontSize: "0.75rem" }}>
          {awaitingChecks(s).map((c) => (
            <button
              key={c.invoiceId}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPay(String(c.invoiceId));
              }}
              className="btn btn-primary"
              style={{ fontSize: "0.72rem", padding: "0.18rem 0.5rem" }}
              title={c.total != null ? `${Number(c.total).toFixed(2)} ج.م` : undefined}
            >
              {checkChipLabel(c)}
            </button>
          ))}
          {!pay ? (
            <NavLink
              to="../delivery-hub?tab=convert"
              onClick={(e) => e.stopPropagation()}
              style={{
                padding: "2px 10px",
                borderRadius: 999,
                background: "rgba(34,211,238,0.18)",
                fontWeight: 700,
                border: "1px solid rgba(34,211,238,0.35)",
                color: "inherit",
                textDecoration: "none",
                fontSize: "0.75rem",
              }}
            >
              → دليفري
            </NavLink>
          ) : null}
        {minGap > 0 ? (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(239,68,68,0.15)", fontWeight: 700 }}>
            ناقص حد أدنى {minGap.toFixed(0)} ج
          </span>
        ) : null}
        {kc > 0 ? (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(59,130,246,0.15)" }}>مطبخ {kc}</span>
        ) : null}
        {Number(s.pendingReturnCount || 0) > 0 ? (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(244,114,182,0.18)", fontWeight: 700 }}>
            مرتجع {s.pendingReturnCount}
          </span>
        ) : null}
        <span style={{ color: "var(--muted)" }}>{oc} طلب</span>
      </div>
      <div style={{ fontSize: "0.82rem", marginTop: 8, lineHeight: 1.45, color: "var(--muted)", maxHeight: 56, overflow: "hidden" }}>
        {s.linesPreview || "—"}
      </div>
      {(billAge > 0 || minCharge > 0) ? (
        <div style={{ marginTop: 8, fontSize: "0.76rem", color: "var(--muted)", lineHeight: 1.45 }}>
          {billAge > 0 ? `عمر طلب الحساب: ${billAge} د` : "لم يُطلب الحساب بعد"}
          {minCharge > 0 ? ` · minimum: ${minCharge.toFixed(0)} ج` : ""}
        </div>
      ) : null}
      <div style={{ marginTop: 8, fontWeight: 700, fontSize: "0.9rem" }}>{sub.toFixed(2)} ج.م تقريبي</div>
    </div>
  );
}
