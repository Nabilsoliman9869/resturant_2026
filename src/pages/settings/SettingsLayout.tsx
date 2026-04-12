import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { RoleId } from "../../auth/roles";

type SettingsNavItem = { path: string; label: string };

/** ترتيب منطقي: مكان → تشغيل يومي → محاسبة → صيانة */
const SETTINGS_SECTIONS: { title: string; items: SettingsNavItem[] }[] = [
  {
    title: "المكان والصالة",
    items: [
      { path: "venue", label: "المكان والطابق والمساحات" },
      { path: "floor-editor", label: "محرّر مخطط الصالة" },
      { path: "tables", label: "الطاولات والمناطق" },
    ],
  },
  {
    title: "القوائم والمبيعات",
    items: [
      { path: "menus", label: "المنيو والقائمة اليومية" },
      { path: "product-images", label: "صور المنتجات" },
      { path: "pos", label: "سياسات POS والعروض" },
    ],
  },
  {
    title: "التكاليف والتعريفات",
    items: [
      { path: "costing", label: "إعدادات التكاليف" },
      { path: "master-data", label: "التعريفات الأساسية" },
    ],
  },
  {
    title: "النظام والصيانة",
    items: [
      { path: "connection", label: "اتصال القاعدة" },
      { path: "init-db", label: "تهيئة الجداول والإجراءات" },
      { path: "users", label: "المستخدمون والأدوار" },
    ],
  },
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
          gap: "0.75rem",
        }}
      >
        <div
          style={{
            fontFamily: "var(--display)",
            fontWeight: 700,
            fontSize: "1.1rem",
            marginBottom: "0.25rem",
            color: "var(--muted)",
          }}
        >
          إعدادات النظام
        </div>
        {SETTINGS_SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div
              style={{
                fontSize: "0.72rem",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--muted)",
                marginBottom: "0.35rem",
                opacity: 0.9,
              }}
            >
              {sec.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {sec.items.map((it) => (
                <NavLink
                  key={it.path}
                  to={`${base}/${it.path}`}
                  className={({ isActive }) => (isActive ? "nav-link nav-link--active" : "nav-link")}
                  style={{ fontSize: "0.92rem", padding: "0.45rem 0.6rem" }}
                >
                  {it.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </aside>
      <section style={{ flex: 1, minWidth: 0 }}>
        <Outlet />
      </section>
    </div>
  );
}
