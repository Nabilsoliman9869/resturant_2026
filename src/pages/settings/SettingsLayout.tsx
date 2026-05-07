import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { RoleId } from "../../auth/roles";

type SettingsNavItem = { path: string; label: string };

/** إعدادات التشغيل — المدير + المطوّر */
const OPERATIONAL_SECTIONS: { title: string; items: SettingsNavItem[] }[] = [
  {
    title: "المكان والصالة",
    items: [
      { path: "venue", label: "المكان والطابق" },
      { path: "floor-editor", label: "مخطط الصالة" },
      { path: "tables", label: "الطاولات والمناطق" },
    ],
  },
  {
    title: "القوائم والمبيعات",
    items: [
      { path: "menus", label: "المنيو" },
      { path: "product-images", label: "صور المنتجات" },
      { path: "pos-venue", label: "نوع المنشأ (POS)" },
      { path: "pos-kds", label: "شاشة المطبخ (KDS)" },
      { path: "pos-prep-times", label: "زمن التحضير لكل صنف" },
      { path: "pos-tax", label: "الضريبة والخدمة" },
      { path: "addons", label: "الإضافات (كتالوج)" },
      { path: "payment-routing", label: "ربط التحصيل (حسابات)" },
      { path: "pos-promos", label: "العروض" },
    ],
  },
  {
    title: "التكاليف والتعريفات",
    items: [
      { path: "costing-mode", label: "أساس التكلفة" },
      { path: "costing", label: "التكاليف" },
      { path: "price-lists", label: "قوائم الأسعار" },
      { path: "daily-opening-custody", label: "عهدة أول اليوم" },
      { path: "daily-return", label: "المسترد" },
      { path: "daily-overhead", label: "مصاريف التشغيل" },
      { path: "daily-result", label: "النتيجة اليومية" },
      { path: "kitchen-item-stop", label: "إيقاف أصناف المطبخ" },
      { path: "daily-cost-engine", label: "التكلفة اليومية" },
      { path: "master-data", label: "التعريفات الأساسية" },
    ],
  },
  {
    title: "التشغيل",
    items: [
      { path: "workflow", label: "دورة العمل والأدوار" },
      { path: "role-schedule", label: "جدولة أدوار المستخدمين" },
      { path: "restaurant-ops", label: "إعدادات التشغيل الشاملة" },
      { path: "minimum-charge", label: "الميني موم تشارج" },
    ],
  },
];

const TECH_SECTION: { title: string; items: SettingsNavItem[] } = {
  title: "تقنية",
  items: [
    { path: "connection", label: "اتصال القاعدة" },
    { path: "init-db", label: "تهيئة SQL" },
    { path: "users", label: "مستخدمو التطبيق" },
  ],
};

function roleFromPath(pathname: string): RoleId | null {
  const m = pathname.match(/^\/app\/([^/]+)\//);
  return (m?.[1] as RoleId) ?? null;
}

export default function SettingsLayout() {
  const loc = useLocation();
  const role = roleFromPath(loc.pathname);
  const base = role ? `/app/${role}/settings` : "/app/manager/settings";
  /** المدير والمطوّر يريان قسم التقنية (لا يُخفى على المدير بينما المسارات كانت تُعاد لتوجيه وهمي). */
  const showTechSection = role === "developer" || role === "manager";

  const sections = showTechSection ? [TECH_SECTION, ...OPERATIONAL_SECTIONS] : OPERATIONAL_SECTIONS;

  const asideTitle = showTechSection ? "إعدادات" : "إعدادات التشغيل";

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
          {asideTitle}
        </div>
        {sections.map((sec) => (
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
