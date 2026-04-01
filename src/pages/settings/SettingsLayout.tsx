import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { RoleId } from "../../auth/roles";

type SettingsNavItem = { path: string; label: string };

const SETTINGS_NAV: SettingsNavItem[] = [
  { path: "venue", label: "المكان والطابق والمساحات" },
  { path: "floor-editor", label: "محرّر مخطط الصالة" },
  { path: "tables", label: "الطاولات والمناطق" },
  { path: "costing", label: "إعدادات التكاليف" },
  { path: "menus", label: "المنيو والقائمة اليومية" },
  { path: "pos", label: "سياسات POS والعروض" },
  { path: "master-data", label: "التعريفات الأساسية" },
  { path: "connection", label: "اتصال القاعدة" },
  { path: "init-db", label: "تهيئة الجداول والإجراءات" },
  { path: "users", label: "المستخدمون والأدوار" },
];

function roleFromPath(pathname: string): RoleId | null {
  const m = pathname.match(/^\/app\/([^/]+)\//);
  return (m?.[1] as RoleId) ?? null;
}

export default function SettingsLayout() {
  const loc = useLocation();
  const role = roleFromPath(loc.pathname);
  const base = role ? `/app/${role}/settings` : "/app/manager/settings";

  return (
    <div style={{ display: "flex", gap: "1.25rem", alignItems: "stretch", minHeight: "70vh" }}>
      <aside
        style={{
          width: 260,
          flexShrink: 0,
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "1rem",
          background: "rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
        }}
      >
        <div
          style={{
            fontFamily: "var(--display)",
            fontWeight: 700,
            fontSize: "1.1rem",
            marginBottom: "0.5rem",
            color: "var(--muted)",
          }}
        >
          إعدادات النظام
        </div>
        {SETTINGS_NAV.map((it) => (
          <NavLink
            key={it.path}
            to={`${base}/${it.path}`}
            className={({ isActive }) =>
              isActive ? "nav-link nav-link--active" : "nav-link"
            }
            style={{ fontSize: "0.92rem", padding: "0.45rem 0.6rem" }}
          >
            {it.label}
          </NavLink>
        ))}
      </aside>
      <section style={{ flex: 1, minWidth: 0 }}>
        <Outlet />
      </section>
    </div>
  );
}
