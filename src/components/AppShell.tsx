import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { CashierAlertsBar } from "./CashierAlertsBar";
import { RestaurantDualBells } from "./RestaurantDualBells";
import { DbConnectionBar } from "./DbConnectionBar";
import { PinOverlay } from "./PinOverlay";
import { sessionDisplayName } from "../auth/displayUser";
import { useAuth } from "../auth/AuthContext";
import { useVenue } from "../context/VenueContext";
import GlobalSearchModal from "./GlobalSearchModal";
import { useDbEpoch } from "../context/DbSettingsRefreshContext";
import { TerminalLockProvider } from "../context/TerminalLockContext";
import { venueBrandLabel } from "../lib/venueType";
import type { RoleId } from "../auth/roles";
import { ROLE_LABELS } from "../auth/roles";
import { WaiterUiStylePrompt } from "./WaiterUiStylePrompt";
import {
  isWaiterUiPromptDoneThisSession,
  roleUsesWaiterOrderUiStyle,
  saveWaiterLastPath,
  waiterPathAfterStylePick,
} from "../lib/waiterOrderUiPrefs";
import { buildMat3amActor } from "../lib/mat3amActor";
import { WAITER_NAV_ITEMS } from "../lib/waiterNav";
import { AppMenuProvider } from "../context/AppMenuContext";
import "../styles/appShell.css";

type NavItem = { to: string; label: string };
type NavSection = { title: string; items: NavItem[] };

function isNavItemActive(pathname: string, base: string, n: NavItem): boolean {
  const dest = `${base}/${n.to}`;
  const settingsPrefix = `${base}/settings`;
  const isSettingsNav = n.to === "settings";
  const isSettingsSubRoute = n.to.startsWith("settings/");
  if (isSettingsNav) {
    return pathname === settingsPrefix || pathname.startsWith(`${settingsPrefix}/`);
  }
  if (isSettingsSubRoute) {
    return pathname === dest || pathname.startsWith(`${dest}/`);
  }
  return pathname === dest;
}

function pickNavItems(items: NavItem[], order: string[]): NavItem[] {
  return order
    .map((key) => items.find((it) => it.to === key))
    .filter((it): it is NavItem => Boolean(it));
}

function buildNavSections(role: RoleId, items: NavItem[]): NavSection[] {
  const used = new Set<string>();
  const mark = (picked: NavItem[]) => {
    for (const item of picked) used.add(item.to);
    return picked;
  };

  const sections: NavSection[] = [];
  if (role === "cashier") {
    sections.push(
      { title: "1. الصالة والتحصيل", items: mark(pickNavItems(items, ["dashboard", "table-sessions", "invoices-local"])) },
      { title: "2. الطلبات والخدمات", items: mark(pickNavItems(items, ["call-center", "kids-area", "pos"])) },
      { title: "3. المالية اليومية", items: mark(pickNavItems(items, ["purchases", "cash-expense"])) },
    );
  } else if (role === "accountant") {
    sections.push(
      { title: "1. المتابعة والحسابات", items: mark(pickNavItems(items, ["dashboard", "reports", "costing", "master-data"])) },
      { title: "2. التشغيل المساند", items: mark(pickNavItems(items, ["call-center", "pos", "purchases"])) },
    );
  } else if (role === "manager") {
    sections.push(
      { title: "1. الصالة والتشغيل الأمامي", items: mark(pickNavItems(items, ["dashboard", "captain-tables", "order-taker"])) },
      { title: "2. خدمة العميل والدليفري", items: mark(pickNavItems(items, ["guest-returns", "call-center", "delivery-management"])) },
      { title: "3. مركز الإعدادات", items: mark(pickNavItems(items, ["settings"])) },
      { title: "4. المالية والتشغيل الخلفي", items: mark(pickNavItems(items, ["pos", "purchases", "cash-expense", "reports", "cashflow"])) },
    );
  } else if (role === "developer") {
    sections.push(
      { title: "1. الصالة والتشغيل الأمامي", items: mark(pickNavItems(items, ["dashboard", "captain-tables", "order-taker"])) },
      { title: "2. خدمة العميل والدليفري", items: mark(pickNavItems(items, ["guest-returns", "call-center", "delivery-management"])) },
      { title: "3. مركز الإعدادات", items: mark(pickNavItems(items, ["settings"])) },
      { title: "4. المالية والتشغيل الخلفي", items: mark(pickNavItems(items, ["pos", "purchases", "cash-expense", "reports", "cashflow"])) },
    );
  } else if (role === "server") {
    sections.push({ title: "1. التشغيل", items: mark(pickNavItems(items, ["dashboard", "runner", "tables"])) });
  } else if (role === "kitchen") {
    sections.push({ title: "1. المطبخ", items: mark(pickNavItems(items, ["kitchen", "kitchen-item-stop"])) });
  } else if (role === "kitchen_specialist") {
    sections.push({ title: "1. الشيف المختص", items: mark(pickNavItems(items, ["kitchen"])) });
  } else if (role === "speed_order") {
    sections.push({ title: "1. الطلبات السريعة", items: mark(pickNavItems(items, ["speed-order"])) });
  } else if (role === "host") {
    sections.push({ title: "1. الاستقبال", items: mark(pickNavItems(items, ["reception"])) });
  } else if (role === "kids_guard") {
    sections.push({ title: "1. منطقة الأطفال", items: mark(pickNavItems(items, ["kids-area"])) });
  } else {
    sections.push({ title: "1. القائمة الرئيسية", items: mark([...items]) });
  }

  const leftovers = items.filter((it) => !used.has(it.to));
  if (leftovers.length) {
    sections.push({ title: `${sections.length + 1}. عناصر إضافية`, items: leftovers });
  }
  return sections.filter((section) => section.items.length > 0);
}

const NAV_BY_ROLE: Record<RoleId, NavItem[]> = {
  /* ترتيب القائمة = تدفق التشغيل: صالة → جلسات → تسديد طاولات → POS جانبي → خلفية */
  cashier: [
    { to: "dashboard", label: "لوحة الصالة" },
    { to: "table-sessions", label: "جلسات الطاولات" },
    { to: "invoices-local", label: "تسديد فواتير الطاولات" },
    { to: "call-center", label: "Call Center (دليفري)" },
    { to: "kids-area", label: "منطقة الأطفال" },
    { to: "pos", label: "نقطة البيع (بار / سفري)" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
  ],
  accountant: [
    { to: "dashboard", label: "لوحة" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "reports", label: "تقارير حسابات" },
    { to: "costing", label: "إعداد التكاليف" },
    { to: "master-data", label: "تعريفات أساسية" },
  ],
  manager: [
    { to: "dashboard", label: "داشبورد" },
    { to: "captain-tables", label: "شريحات الطاولات" },
    { to: "order-taker", label: "طلب للطاولة" },
    { to: "guest-returns", label: "مرتجعات الضيوف" },
    { to: "call-center", label: "Call Center (دليفري)" },
    { to: "delivery-management", label: "إدارة الدليفري" },
    { to: "settings", label: "إعدادات التشغيل" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
    { to: "reports", label: "تقارير" },
    { to: "table-sessions-report", label: "تقرير جلسات الطاولات" },
    { to: "cashflow", label: "التدفق النقدي" },
  ],
  developer: [
    { to: "dashboard", label: "داشبورد" },
    { to: "captain-tables", label: "شريحات الطاولات" },
    { to: "order-taker", label: "طلب للطاولة" },
    { to: "guest-returns", label: "مرتجعات الضيوف" },
    { to: "call-center", label: "Call Center (دليفري)" },
    { to: "delivery-management", label: "إدارة الدليفري" },
    { to: "settings", label: "إعدادات" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
    { to: "reports", label: "تقارير الحسابات" },
    { to: "table-sessions-report", label: "تقرير جلسات الطاولات" },
    { to: "cashflow", label: "التدفق النقدي" },
  ],
  host: [{ to: "reception", label: "استقبال العملاء" }],
  waiter: WAITER_NAV_ITEMS,
  kitchen: [
    { to: "kitchen", label: "شاشة المطبخ" },
    { to: "kitchen-item-stop", label: "إيقاف أصناف المطبخ" },
  ],
  kitchen_specialist: [{ to: "kitchen", label: "شاشة الشيف المختص" }],
  speed_order: [{ to: "speed-order", label: "شاشة الطلبات السريعة" }],
  server: [
    { to: "dashboard", label: "لوحة الصالة" },
    { to: "runner", label: "توصيل الطلبات" },
    { to: "tables", label: "حالة الطاولات" },
  ],
  kids_guard: [{ to: "kids-area", label: "منطقة الأطفال" }],
};

const SIDEBAR_STORAGE_KEY = "mat3am_shell_sidebar";
const NARROW_MAX_PX = 960;

function readSidebarInitialOpen(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* ignore */
  }
  if (typeof window === "undefined") return true;
  return !window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`).matches;
}

export function AppShell({ role }: { role: RoleId }) {
  const { user, logout } = useAuth();
  const { venueType, venueName } = useVenue();
  const dbEpoch = useDbEpoch();
  const location = useLocation();
  const navigate = useNavigate();
  const base = `/app/${role}`;
  const [uiStylePromptOpen, setUiStylePromptOpen] = useState(
    () => roleUsesWaiterOrderUiStyle(role) && !isWaiterUiPromptDoneThisSession(),
  );

  const handleWaiterUiStyleDone = useCallback(() => {
    setUiStylePromptOpen(false);
    if (role === "waiter") {
      navigate(waiterPathAfterStylePick(), { replace: true });
    }
  }, [role, navigate]);
  const isOrderTakerFullscreen =
    (role === "waiter" || role === "manager" || role === "developer") &&
    location.pathname.startsWith(`${base}/order-taker`);

  useEffect(() => {
    if (role === "waiter") {
      saveWaiterLastPath(location.pathname, location.search);
    }
  }, [role, location.pathname, location.search]);

  const [narrowViewport, setNarrowViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`).matches : false,
  );
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarInitialOpen);
  const [asideSupplement, setAsideSupplement] = useState<ReactNode | null>(null);

  useEffect(() => {
    if (isOrderTakerFullscreen && narrowViewport) setSidebarOpen(false);
  }, [isOrderTakerFullscreen, narrowViewport, location.pathname]);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`);
    const fn = () => setNarrowViewport(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarOpen]);

  const items = useMemo(() => {
    const raw = NAV_BY_ROLE[role];
    if (venueType !== "coffee_shop") return raw;
    const mapped = raw.map((it) => {
      if ((role === "kitchen" || role === "kitchen_specialist") && it.to === "kitchen") {
        return { ...it, label: "البار / التحضير" };
      }
      if (role === "speed_order" && it.to === "speed-order") {
        return { ...it, label: "الطلبات السريعة (شيشة/مشروبات)" };
      }
      if (role === "waiter" && it.to === "pos") {
        return { ...it, label: "طلب سريع (بار)" };
      }
      if ((role === "cashier" || role === "manager" || role === "developer" || role === "accountant") && it.to === "pos") {
        return { ...it, label: "نقطة البيع / بار" };
      }
      return it;
    });
    if (role === "waiter") {
      return mapped.filter((it) => it.to !== "pos");
    }
    return mapped;
  }, [role, venueType]);
  const navSections = useMemo(() => buildNavSections(role, items), [role, items]);

  const interDeptBells = role !== "kids_guard";

  const closeIfNarrow = useCallback(() => {
    if (narrowViewport) setSidebarOpen(false);
  }, [narrowViewport]);

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const showMobileMenuFab = narrowViewport && !sidebarOpen && !isOrderTakerFullscreen;

  const appMenuValue = useMemo(
    () => ({ openAppMenu: openSidebar, closeAppMenu: closeSidebar, setAsideSupplement }),
    [openSidebar, closeSidebar],
  );

  return (
    <TerminalLockProvider>
      <AppMenuProvider value={appMenuValue}>
        <div className="app-shell">
          {interDeptBells ? (
            <RestaurantDualBells role={role} userId={user?.id} mat3amActor={buildMat3amActor(user)} />
          ) : null}

          {narrowViewport && sidebarOpen ? (
            <button type="button" className="app-shell__backdrop" aria-label="إغلاق القائمة" onClick={closeSidebar} />
          ) : null}

          {!narrowViewport && !sidebarOpen ? (
            <button
              type="button"
              className="app-shell__rail-tab"
              aria-label="فتح قائمة التنقل"
              aria-expanded={false}
              onClick={openSidebar}
            >
              ‹
            </button>
          ) : null}

          {showMobileMenuFab ? (
            <button
              type="button"
              className="app-shell__menu-fab"
              aria-label="القائمة الرئيسية"
              title="القائمة الرئيسية — التنقل والحساب والخروج"
              onClick={openSidebar}
            >
              <svg className="app-shell__menu-fab-svg" viewBox="0 0 24 24" aria-hidden>
                <path fill="currentColor" d="M4 7h16v2H4V7zm0 5h16v2H4v-2zm0 5h10v2H4v-2z" />
              </svg>
            </button>
          ) : null}

          <aside
            className={`app-shell__aside ${sidebarOpen ? "is-open" : "is-collapsed"}${isOrderTakerFullscreen ? " app-shell__aside--order-taker" : ""}`}
            aria-hidden={!sidebarOpen}
          >
            <div className="app-shell__aside-head">
              <div className="app-shell__aside-brand">
                <img
                  src="/app-logo.png"
                  alt="SIR RESTO"
                  className="app-shell__brand-logo"
                />
                <div className="app-shell__brand-title">{venueBrandLabel(venueType, venueName)}</div>
                <div className="app-shell__brand-user" title={user?.login || undefined}>
                  {sessionDisplayName(user)}
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  <DbConnectionBar compact={isOrderTakerFullscreen} lightweight={isOrderTakerFullscreen} />
                </div>
              </div>
              <button type="button" className="app-shell__aside-close" onClick={closeSidebar} aria-label="طي القائمة">
                ›
              </button>
            </div>
            <p className="app-shell__nav-heading" style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 800, color: "var(--muted)" }}>
              القائمة الرئيسية
            </p>
            <div className="app-shell__aside-main">
              <button type="button" className="btn btn-ghost app-shell__logout-btn" onClick={logout} style={{ marginBottom: "0.6rem" }}>
                خروج
              </button>
              {navSections.map((section) => (
                <div key={section.title} className="app-shell__nav-section" style={{ marginBottom: "0.7rem" }}>
                  <div className="app-shell__nav-section-title" style={{ margin: "0.15rem 0 0.35rem", fontSize: "0.74rem", fontWeight: 800, color: "var(--muted)" }}>
                    {section.title}
                  </div>
                  {section.items.map((n) => {
                    const dest = `${base}/${n.to}`;
                    const active = isNavItemActive(location.pathname, base, n);
                    return (
                      <NavLink
                        key={`${section.title}-${n.to}`}
                        to={dest}
                        className={() => (active ? "nav-link nav-link--active" : "nav-link")}
                        onClick={closeIfNarrow}
                        title={"hint" in n ? (n as { hint?: string }).hint : undefined}
                      >
                        {n.label}
                      </NavLink>
                    );
                  })}
                </div>
              ))}
              {asideSupplement ? <div className="app-shell__aside-supplement">{asideSupplement}</div> : null}
            </div>
            <div className="app-shell__aside-copy">
              <div>© 2026 Sir Consult for Information Technology</div>
              <div>حقوق الواجهة والهوية محفوظة داخل الهيكل العام للنظام.</div>
            </div>
          </aside>

          <main
            className="app-shell__main"
            data-order-taker-shell={isOrderTakerFullscreen ? "1" : "0"}
            style={isOrderTakerFullscreen ? { padding: "0" } : { padding: "1.5rem" }}
          >
            {!isOrderTakerFullscreen ? (
              <div className="app-shell__fixed-logo" aria-hidden="true">
                <img src="/app-logo.png" alt="" className="app-shell__fixed-logo-img" />
              </div>
            ) : null}
            {isOrderTakerFullscreen ? null : (
              <div style={{ padding: "0.45rem 0.75rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <DbConnectionBar compact />
                {role === "developer" ? (
                  <button type="button" className="btn btn-ghost" onClick={() => { window.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true, key: "k" })); }} style={{ fontSize: "0.82rem", gap: 6, display: "inline-flex", alignItems: "center" }}>
                    🔍 البحث <kbd style={{ fontSize: 10, opacity: 0.5, background: "var(--surface)", padding: "1px 6px", borderRadius: 4 }}>Ctrl+K</kbd>
                  </button>
                ) : null}
              </div>
            )}
            {role === "cashier" ? <CashierAlertsBar /> : null}
            <Outlet key={dbEpoch} />
          </main>
          <PinOverlay />
          {uiStylePromptOpen && roleUsesWaiterOrderUiStyle(role) ? (
            <WaiterUiStylePrompt roleLabel={ROLE_LABELS[role]} onDone={handleWaiterUiStyleDone} />
          ) : null}
          <GlobalSearchModal role={role} />
        </div>
      </AppMenuProvider>
    </TerminalLockProvider>
  );
}
