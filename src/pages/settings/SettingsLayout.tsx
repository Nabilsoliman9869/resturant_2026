import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { RoleId } from "../../auth/roles";

type SettingsNavItem = { to: string; label: string; absolute?: boolean };
type SettingsNavSection = { title: string; items: SettingsNavItem[] };

function roleFromPath(pathname: string): RoleId | null {
  const m = pathname.match(/^\/app\/([^/]+)\//);
  return (m?.[1] as RoleId) ?? null;
}

function buildSettingsSections(role: RoleId | null): SettingsNavSection[] {
  const roleBase = role ? `/app/${role}` : "/app/manager";
  const sections: SettingsNavSection[] = [
    {
      title: "1. إعدادات الصالة",
      items: [
        { to: "venue", label: "المكان والطابق" },
        { to: "floor-editor", label: "مخطط الصالة" },
        { to: "tables", label: "الطاولات والمناطق" },
        { to: "minimum-charge", label: "الحد الأدنى للطاولة" },
        { to: "restaurant-ops", label: "سياسات تشغيل الصالة" },
      ],
    },
    {
      title: "2. إعدادات المطبخ والطباعة",
      items: [
        { to: "pos-kds", label: "شاشة المطبخ (KDS)" },
        { to: "pos-prep-times", label: "زمن التحضير لكل صنف" },
        { to: "kitchen-ops", label: "محطات الشيف المختص وتشغيل المطبخ" },
        { to: "kitchen-item-stop", label: "إيقاف أصناف المطبخ" },
        { to: "workflow", label: "دورة العمل والأدوار" },
      ],
    },
    {
      title: "3. إعدادات المستخدمين والتشغيل",
      items: [
        { to: "users", label: "مستخدمو التطبيق" },
        { to: "role-schedule", label: "جدولة أدوار المستخدمين" },
        { to: "pos-shared-terminal", label: "تشغيل نقطة البيع المشتركة" },
        { to: "kids-area-packages", label: "باقات منطقة الأطفال" },
      ],
    },
    {
      title: "4. الإعدادات المالية والبيع",
      items: [
        { to: "pos-venue", label: "نوع المنشأ (POS)" },
        { to: "pos-tax", label: "الضريبة والخدمة" },
        { to: "payment-routing", label: "ربط التحصيل (حسابات)" },
        { to: "pos-promos", label: "العروض" },
        { to: "costing-mode", label: "أساس التكلفة" },
        { to: "costing", label: "التكاليف" },
        { to: "price-lists", label: "قوائم الأسعار" },
        { to: "daily-opening-custody", label: "عهدة أول اليوم" },
        { to: "daily-return", label: "المسترد" },
        { to: "daily-overhead", label: "مصاريف التشغيل" },
        { to: "daily-result", label: "النتيجة اليومية" },
        { to: "daily-cost-engine", label: "التكلفة اليومية" },
      ],
    },
    {
      title: "5. الكتالوج والتعريفات",
      items: [
        { to: "menus", label: "المنيو" },
        { to: "product-images", label: "صور المنتجات" },
        { to: "addons", label: "الإضافات (كتالوج)" },
        { to: "master-data", label: "التعريفات الأساسية" },
      ],
    },
    {
      title: "6. إعدادات النظام",
      items: [
        { to: "connection", label: "اتصال القاعدة" },
        { to: "init-db", label: "تهيئة SQL" },
      ],
    },
  ];

  if (role === "manager" || role === "developer") {
    sections.push({
      title: "7. المراكز الإدارية المرتبطة",
      items: [
        { to: `${roleBase}/guest-returns`, label: "مرتجعات الضيوف", absolute: true },
        { to: `${roleBase}/call-center`, label: "Call Center (دليفري)", absolute: true },
        { to: `${roleBase}/delivery-management`, label: "إدارة الدليفري", absolute: true },
        { to: `${roleBase}/purchases`, label: "المشتريات", absolute: true },
        { to: `${roleBase}/cash-expense`, label: "صرف مصروفات", absolute: true },
        { to: `${roleBase}/reports`, label: "تقارير الحسابات", absolute: true },
        { to: `${roleBase}/cashflow`, label: "التدفق النقدي", absolute: true },
      ],
    });
  }

  if (role === "developer") {
    sections[5]?.items.push({ to: "pos-admin-legacy", label: "واجهة POS القديمة" });
  }

  return sections;
}

export default function SettingsLayout() {
  const loc = useLocation();
  const role = roleFromPath(loc.pathname);
  const base = role ? `/app/${role}/settings` : "/app/manager/settings";
  const sections = buildSettingsSections(role);
  const asideTitle = "مركز الإعدادات والإدارة";

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
            marginBottom: "0.15rem",
            color: "var(--muted)",
          }}
        >
          {asideTitle}
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.6 }}>
          ترتيب مرقّم للتدريب والتشغيل، مع ضم الشاشات الإدارية المرتبطة داخل مرجع واحد.
        </div>
        {sections.map((sec) => (
          <div key={sec.title}>
            <div
              style={{
                fontSize: "0.8rem",
                fontWeight: 800,
                color: "var(--muted)",
                marginBottom: "0.35rem",
                opacity: 0.9,
              }}
            >
              {sec.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {sec.items.map((it, itemIndex) => (
                <NavLink
                  key={`${sec.title}-${it.to}`}
                  to={it.absolute ? it.to : `${base}/${it.to}`}
                  className={({ isActive }) => (isActive ? "nav-link nav-link--active" : "nav-link")}
                  style={{ fontSize: "0.92rem", padding: "0.45rem 0.6rem" }}
                >
                  {`${sec.title.split(".")[0]}.${itemIndex + 1} ${it.label}`}
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
