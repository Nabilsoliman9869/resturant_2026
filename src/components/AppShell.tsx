import { useMemo } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { sessionDisplayName } from "../auth/displayUser";
import { useAuth } from "../auth/AuthContext";
import { useVenue } from "../context/VenueContext";
import { venueBrandTitle } from "../lib/venueType";
import type { RoleId } from "../auth/roles";

type NavItem = { to: string; label: string };

const NAV_BY_ROLE: Record<RoleId, NavItem[]> = {
  cashier: [
    { to: "dashboard", label: "لوحة" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
  ],
  accountant: [
    { to: "dashboard", label: "لوحة" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "costing", label: "إعداد التكاليف" },
    { to: "master-data", label: "تعريفات أساسية" },
    { to: "reports", label: "تقارير حسابات" },
  ],
  manager: [
    { to: "dashboard", label: "داشبورد" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
    { to: "reports", label: "تقارير" },
    { to: "cashflow", label: "التدفق النقدي" },
    { to: "settings", label: "إعدادات النظام" },
  ],
  developer: [
    { to: "dashboard", label: "داشبورد" },
    { to: "pos", label: "نقطة البيع" },
    { to: "purchases", label: "مشتريات" },
    { to: "cash-expense", label: "صرف مصروفات" },
    { to: "reports", label: "تقارير الحسابات" },
    { to: "cashflow", label: "التدفق النقدي" },
    { to: "settings", label: "إعدادات النظام" },
  ],
  host: [{ to: "reception", label: "استقبال العملاء" }],
  waiter: [
    { to: "tables", label: "اختيار الطاولة" },
    { to: "order-taker", label: "أخذ الطلبات" },
    { to: "pos", label: "نقطة الطلب (مبسّط)" },
  ],
  kitchen: [
    { to: "kitchen", label: "شاشة المطبخ" },
  ],
  server: [
    { to: "runner", label: "توصيل الطلبات" },
    { to: "tables", label: "حالة الطاولات" },
  ],
};

export function AppShell({ role }: { role: RoleId }) {
  const { user, logout } = useAuth();
  const { venueType } = useVenue();
  const location = useLocation();
  const base = `/app/${role}`;
  const items = useMemo(() => {
    const raw = NAV_BY_ROLE[role];
    if (venueType !== "coffee_shop") return raw;
    return raw.map((it) => {
      if (role === "kitchen" && it.to === "kitchen") {
        return { ...it, label: "البار / التحضير" };
      }
      if (role === "waiter" && it.to === "pos") {
        return { ...it, label: "طلب سريع (بار)" };
      }
      if ((role === "cashier" || role === "manager" || role === "developer" || role === "accountant") && it.to === "pos") {
        return { ...it, label: "نقطة البيع / بار" };
      }
      return it;
    });
  }, [role, venueType]);

  return (
    <div style={{ display: "flex", minHeight: "100%" }}>
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
        </div>
        {items.map((n) => {
          const dest = `${base}/${n.to}`;
          const settingsPrefix = `${base}/settings`;
          const isSettingsNav = n.to === "settings";
          const active = isSettingsNav
            ? location.pathname === settingsPrefix || location.pathname.startsWith(`${settingsPrefix}/`)
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
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" onClick={logout}>
          خروج
        </button>
      </aside>
      <main style={{ flex: 1, padding: "1.5rem", overflow: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
