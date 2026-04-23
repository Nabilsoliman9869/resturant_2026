import { useMemo } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CashierAlertsBar } from "./CashierAlertsBar";
import { DbConnectionBar } from "./DbConnectionBar";
import { sessionDisplayName } from "../auth/displayUser";
import { useAuth } from "../auth/AuthContext";
import { useVenue } from "../context/VenueContext";
import { useDbEpoch } from "../context/DbSettingsRefreshContext";
import { venueBrandTitle } from "../lib/venueType";
import type { RoleId } from "../auth/roles";

type NavItem = { to: string; label: string };

const NAV_BY_ROLE: Record<RoleId, NavItem[]> = {
  /* ترتيب القائمة = تدفق التشغيل: صالة → جلسات → تسديد طاولات → POS جانبي → خلفية */
  cashier: [
    { to: "dashboard", label: "لوحة الصالة" },
    { to: "table-sessions", label: "جلسات الطاولات" },
    { to: "invoices-local", label: "تسديد فواتير الطاولات" },
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
    { to: "settings", label: "إعدادات التشغيل" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
    { to: "reports", label: "تقارير" },
    { to: "cashflow", label: "التدفق النقدي" },
    { to: "settings", label: "إعدادات النظام" },
  ],
  developer: [
    { to: "dashboard", label: "داشبورد" },
    { to: "settings", label: "إعدادات" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
    { to: "reports", label: "تقارير الحسابات" },
    { to: "cashflow", label: "التدفق النقدي" },
    { to: "settings", label: "إعدادات النظام" },
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

export function AppShell({ role }: { role: RoleId }) {
  const { user, logout } = useAuth();
  const { venueType } = useVenue();
  const dbEpoch = useDbEpoch();
  const location = useLocation();
  const base = `/app/${role}`;
  const isWaiterOrderTaker = role === "waiter" && location.pathname.startsWith(`${base}/order-taker`);
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

  return (
    <div style={{ display: "flex", minHeight: "100%" }}>
      {!isWaiterOrderTaker && (
        <aside
          style={{
            width: 240,
            flexShrink: 0,
            borderLeft: "1px solid var(--border)",
            background: "rgba(0,0,0,0.35)",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            fontFamily: "var(--font)",
          }}
        >
          <div style={{ marginBottom: "1rem" }}>
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
          <button type="button" className="btn btn-ghost" onClick={logout} style={{ marginBottom: "0.6rem" }}>
            خروج
          </button>
          {items.map((n) => {
            const dest = `${base}/${n.to}`;
            const settingsPrefix = `${base}/settings`;
            const isSettingsNav = n.to === "settings";
            const isSettingsSubRoute = n.to.startsWith("settings/");
            const active = isSettingsNav
              ? location.pathname === settingsPrefix || location.pathname.startsWith(`${settingsPrefix}/`)
              : isSettingsSubRoute
                ? location.pathname === dest || location.pathname.startsWith(`${dest}/`)
                : location.pathname === dest;
            return (
              <NavLink
                key={n.to}
                to={dest}
                className={() => (active ? "nav-link nav-link--active" : "nav-link")}
              >
                {n.label}
              </NavLink>
            );
          })}
        </aside>
      )}
      <main style={{ flex: 1, padding: isWaiterOrderTaker ? "0" : "1.5rem", overflow: "auto" }}>
        {isWaiterOrderTaker ? (
          <div style={{ padding: "0.45rem 0.75rem", borderBottom: "1px solid var(--border)" }}>
            <DbConnectionBar compact />
          </div>
        ) : null}
        {role === "cashier" ? <CashierAlertsBar /> : null}
        <Outlet key={dbEpoch} />
      </main>
    </div>
  );
}
