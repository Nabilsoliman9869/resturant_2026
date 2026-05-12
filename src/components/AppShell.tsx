import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CashierAlertsBar } from "./CashierAlertsBar";
import { RestaurantDualBells } from "./RestaurantDualBells";
import { DbConnectionBar } from "./DbConnectionBar";
import { PinOverlay } from "./PinOverlay";
import { sessionDisplayName } from "../auth/displayUser";
import { useAuth } from "../auth/AuthContext";
import { useVenue } from "../context/VenueContext";
import { useDbEpoch } from "../context/DbSettingsRefreshContext";
import { TerminalLockProvider } from "../context/TerminalLockContext";
import { venueBrandTitle } from "../lib/venueType";
import type { RoleId } from "../auth/roles";
import { buildMat3amActor } from "../lib/mat3amActor";
import "../styles/appShell.css";

type NavItem = { to: string; label: string };

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

/** أيقونات SVG بسيطة لشريط الجوال — بدون مكتبة خارجية */
function NavDockGlyph({ navTo }: { navTo: string }) {
  const cn = "app-shell__dock-svg";
  switch (navTo) {
    case "dashboard":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M4 10.5h6V4.5H4v6zm10 0h6V4.5h-6v6zM4 20.5h6v-6H4v6zm10 0h6v-6h-6v6z"
          />
        </svg>
      );
    case "tables":
    case "captain-tables":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M4 6.5h16v3H4v-3zm0 5.5h7.5v6H4v-6zm9.5 0H20v6h-7.5v-6z"
          />
        </svg>
      );
    case "table-sessions":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M6 4h12v4H6V4zm-2 6h16v10H4V10zm2 2v6h12v-6H6z"
          />
        </svg>
      );
    case "invoices-local":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M7 3h10v2H7V3zm-2 4h14v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7zm4 3h6v2H9v-2zm0 4h6v2H9v-2z"
          />
        </svg>
      );
    case "order-taker":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M6 4h12v2H6V4zm0 4h12l-1 10H7L6 8zm3.5 2.5h5v1.5h-5V10.5z"
          />
        </svg>
      );
    case "call-center":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M6.5 3h11l1 3v14H5.5V6l1-3zm2 5a9 9 0 0 0 6 6l1.2-1.2-2.3-1.2.6-1.5 3.5 1.8a1 1 0 0 0 1.3-.4c.4-.8.6-1.7.6-2.6 0-.4-.3-.7-.7-.7h-1a8 8 0 0 0-8 8v1c0 .4.3.7.7.7.9 0 1.8-.2 2.6-.6a1 1 0 0 0 .4-1.3l-1.8-3.5-1.5.6-1.2-2.3L12 14a9 9 0 0 0-3-8.5z"
          />
        </svg>
      );
    case "delivery-management":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M4 16.5V8h10v8.5a2.5 2.5 0 0 1-2.5 2.5H8a3 3 0 0 1-3-3v-1H4zm14-7h3l2 4v3h-3v-3h-2v-4zm-9 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
          />
        </svg>
      );
    case "kids-area":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm-7 9c0-2 2.5-3 7-3s7 1 7 3v7H5v-7z"
          />
        </svg>
      );
    case "pos":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M7 5h10a2 2 0 0 1 2 2v11H5V7a2 2 0 0 1 2-2zm3 4h4v2h-4V9zm0 4h4v2h-4v-2z"
          />
        </svg>
      );
    case "purchases":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M9 3h6v2h5v2H4V5h5V3zm-4 6h14l-1.2 12H6.2L5 9zm4 3v6h2v-6H9zm4 0v6h2v-6h-2z"
          />
        </svg>
      );
    case "cash-expense":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            d="M12 3v18M6 9h12M8 14h8M8 18h5"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );
    case "reports":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M5 19h14v2H5v-2zm2-4h3v3H7v-3zm4-5h3v8h-3v-8zm4-4h3v12h-3V6z"
          />
        </svg>
      );
    case "costing":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M5 6h14v2H5V6zm0 5h14v2H5v-2zm0 5h10v2H5v-2zm11 2l4 4-4 4v-8z"
          />
        </svg>
      );
    case "master-data":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M5 5h6v6H5V5zm8 0h6v6h-6V5zM5 13h6v6H5v-6zm8 0h6v6h-6v-6z"
          />
        </svg>
      );
    case "settings":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.4-5 .9-2.1-2-1.7-.2-2.7-2.8-.6-1.7-2.1-2.7.9-2.4-1.5-2.4 1.5-2.7-.9-1.7 2.1-2.8.6-.2 2.7-2 1.7.9 2.1-.6 2.8 1.5 2.4-1.5 2.4.9 2.7 2.1 1.7.6 2.8 2.7.2 2 1.7 2.1-.9 2.8.6 2.7 2.1 1.7 2.4-1.5 2.4 1.5z"
          />
        </svg>
      );
    case "cashflow":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M4 17h16v2H4v-2zm2-5 4-4 4 4 4-4 4 4v3H6v-7z"
          />
        </svg>
      );
    case "reception":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 9v-1c0-3 4-4.5 8-4.5s8 1.5 8 4.5v1H4z"
          />
        </svg>
      );
    case "runner":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M5 15l7-8 4 4 4-5v11H5v-2zm7-11h3v3h-3V4z"
          />
        </svg>
      );
    case "kitchen":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M8 4h8v3H8V4zm-2 6h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10zm4 3h4v5h-4v-5z"
          />
        </svg>
      );
    case "kitchen-item-stop":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6V4zm1 3v5l4 2 .9-1.7L14 11.3V7h-1z"
          />
        </svg>
      );
    case "speed-order":
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"
          />
        </svg>
      );
    default:
      return (
        <svg className={cn} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="7" fill="currentColor" opacity="0.85" />
        </svg>
      );
  }
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
    { to: "call-center", label: "Call Center (دليفري)" },
    { to: "delivery-management", label: "إدارة الدليفري" },
    { to: "settings", label: "إعدادات التشغيل" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
    { to: "reports", label: "تقارير" },
    { to: "cashflow", label: "التدفق النقدي" },
  ],
  developer: [
    { to: "dashboard", label: "داشبورد" },
    { to: "captain-tables", label: "شريحات الطاولات" },
    { to: "order-taker", label: "طلب للطاولة" },
    { to: "call-center", label: "Call Center (دليفري)" },
    { to: "delivery-management", label: "إدارة الدليفري" },
    { to: "settings", label: "إعدادات" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
    { to: "reports", label: "تقارير الحسابات" },
    { to: "cashflow", label: "التدفق النقدي" },
  ],
  host: [{ to: "reception", label: "استقبال العملاء" }],
  waiter: [
    { to: "dashboard", label: "لوحة الصالة" },
    { to: "tables", label: "الطاولات" },
    { to: "order-taker", label: "طلب للطاولة" },
    { to: "runner", label: "استلام من المطبخ" },
    { to: "pos", label: "طلب سريع (بار)" },
  ],
  kitchen: [
    { to: "kitchen", label: "شاشة المطبخ" },
    { to: "kitchen-item-stop", label: "إيقاف أصناف المطبخ" },
  ],
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
  const { venueType } = useVenue();
  const dbEpoch = useDbEpoch();
  const location = useLocation();
  const base = `/app/${role}`;
  const isWaiterOrderTaker =
    (role === "waiter" || role === "manager" || role === "developer") &&
    location.pathname.startsWith(`${base}/order-taker`);

  const [narrowViewport, setNarrowViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`).matches : false,
  );
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarInitialOpen);
  const [dockTouchHeld, setDockTouchHeld] = useState(false);
  const dockNavRef = useRef<HTMLElement | null>(null);

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
      if (role === "kitchen" && it.to === "kitchen") {
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

  const interDeptBells = role !== "kids_guard";

  const closeIfNarrow = useCallback(() => {
    if (narrowViewport) setSidebarOpen(false);
  }, [narrowViewport]);

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const showSidebarChrome = !isWaiterOrderTaker;
  /** شريط أيقونات الجوال يظهر بدل زر ‹ عندما القائمة الكاملة مغلقة */
  const showMobileDock = narrowViewport && showSidebarChrome && !sidebarOpen;

  useLayoutEffect(() => {
    if (!showMobileDock) {
      setDockTouchHeld(false);
      return;
    }
    const el = dockNavRef.current;
    if (!el) return;
    const begin = () => setDockTouchHeld(true);
    const end = () => setDockTouchHeld(false);
    el.addEventListener("touchstart", begin, { capture: true, passive: true });
    el.addEventListener("pointerdown", begin, { capture: true });
    window.addEventListener("touchend", end, false);
    window.addEventListener("touchcancel", end, false);
    window.addEventListener("pointerup", end, false);
    window.addEventListener("pointercancel", end, false);
    return () => {
      el.removeEventListener("touchstart", begin, { capture: true } as AddEventListenerOptions);
      el.removeEventListener("pointerdown", begin, { capture: true } as AddEventListenerOptions);
      window.removeEventListener("touchend", end, false);
      window.removeEventListener("touchcancel", end, false);
      window.removeEventListener("pointerup", end, false);
      window.removeEventListener("pointercancel", end, false);
      setDockTouchHeld(false);
    };
  }, [showMobileDock]);

  return (
    <TerminalLockProvider>
      <div className={`app-shell${dockTouchHeld ? " app-shell--dock-touch-held" : ""}`}>
        {interDeptBells ? (
          <RestaurantDualBells role={role} userId={user?.id} mat3amActor={buildMat3amActor(user)} />
        ) : null}

        {showSidebarChrome && narrowViewport && sidebarOpen ? (
          <button type="button" className="app-shell__backdrop" aria-label="إغلاق القائمة" onClick={closeSidebar} />
        ) : null}

        {showSidebarChrome && !narrowViewport && !sidebarOpen ? (
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

        {showMobileDock ? (
          <nav ref={dockNavRef} className="app-shell__dock" aria-label="تنقل سريع">
            <div className="app-shell__dock-scroll">
              {items.map((n) => {
                const dest = `${base}/${n.to}`;
                const active = isNavItemActive(location.pathname, base, n);
                return (
                  <NavLink
                    key={n.to}
                    to={dest}
                    className={() =>
                      active ? "app-shell__dock-link app-shell__dock-link--active" : "app-shell__dock-link"
                    }
                    title={n.label}
                    aria-label={n.label}
                    onClick={closeIfNarrow}
                  >
                    <NavDockGlyph navTo={n.to} />
                  </NavLink>
                );
              })}
            </div>
            <button
              type="button"
              className="app-shell__dock-more"
              aria-label="القائمة الكاملة والحساب والخروج"
              title="القائمة، الاتصال بقاعدة البيانات، الخروج"
              onClick={openSidebar}
            >
              <svg className="app-shell__dock-svg" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M4 7h16v2H4V7zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"
                />
              </svg>
            </button>
          </nav>
        ) : null}

        {showSidebarChrome && (
          <aside
            className={`app-shell__aside ${sidebarOpen ? "is-open" : "is-collapsed"}`}
            aria-hidden={!sidebarOpen}
          >
            <div className="app-shell__aside-head">
              <div className="app-shell__aside-brand">
                <div
                  style={{
                    fontFamily: "var(--font)",
                    fontSize: "1.15rem",
                    fontWeight: 700,
                  }}
                >
                  {venueBrandTitle(venueType)}
                </div>
                <div style={{ color: "var(--muted)", fontSize: "0.85rem" }} title={user?.login || undefined}>
                  {sessionDisplayName(user)}
                </div>
                <div style={{ marginTop: "0.75rem" }}>
                  <DbConnectionBar />
                </div>
              </div>
              <button type="button" className="app-shell__aside-close" onClick={closeSidebar} aria-label="طي القائمة">
                ›
              </button>
            </div>
            <button type="button" className="btn btn-ghost" onClick={logout} style={{ marginBottom: "0.6rem" }}>
              خروج
            </button>
            {items.map((n) => {
              const dest = `${base}/${n.to}`;
              const active = isNavItemActive(location.pathname, base, n);
              return (
                <NavLink
                  key={n.to}
                  to={dest}
                  className={() => (active ? "nav-link nav-link--active" : "nav-link")}
                  onClick={closeIfNarrow}
                >
                  {n.label}
                </NavLink>
              );
            })}
          </aside>
        )}

        <main
          className="app-shell__main"
          data-order-taker-shell={isWaiterOrderTaker ? "1" : "0"}
          style={
            isWaiterOrderTaker
              ? { padding: "0" }
              : showMobileDock
                ? { padding: "1.5rem", paddingInlineStart: "calc(1.5rem + 52px)" }
                : { padding: "1.5rem" }
          }
        >
          {isWaiterOrderTaker ? (
            <div style={{ padding: "0.45rem 0.75rem", borderBottom: "1px solid var(--border)" }}>
              <DbConnectionBar compact />
            </div>
          ) : null}
          {role === "cashier" ? <CashierAlertsBar /> : null}
          <Outlet key={dbEpoch} />
        </main>
        <PinOverlay />
      </div>
    </TerminalLockProvider>
  );
}
