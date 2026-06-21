import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { RoleId } from "../../auth/roles";

type SettingsNavItem = { to: string; label: string; absolute?: boolean; hint?: string };
type SettingsNavSection = { title: string; items: SettingsNavItem[] };

function roleFromPath(pathname: string): RoleId | null {
  const m = pathname.match(/^\/app\/([^/]+)\//);
  return (m?.[1] as RoleId) ?? null;
}

function buildSettingsSections(role: RoleId | null): SettingsNavSection[] {
  const roleBase = role ? `/app/${role}` : "/app/manager";
  const sections: SettingsNavSection[] = [
    {
      title: "1. النظام والتعريفات",
      items: [
        { to: "master-data", label: "التعريفات الأساسية", hint: "العملة، الوحدات، مجموعات الأصناف..." },
        { to: "connection", label: "اتصال القاعدة", hint: "إعدادات الاتصال بقاعدة البيانات SQL Server" },
        { to: "init-db", label: "تهيئة SQL", hint: "إنشاء الجداول الأولية في القاعدة" },
      ],
    },
    {
      title: "2. المنشأ والأساس",
      items: [
        { to: "pos-venue", label: "نوع المنشأ (POS)", hint: "مطعم، كافيه، فندق — يؤثر على أنماط الفواتير" },
        { to: "venue", label: "المكان والطابق", hint: "اسم المنشأ، عدد الطوابق، نوع الصالة" },
        { to: "floor-editor", label: "مخطط الصالة (رسم)", hint: "رسم موقع الطاولات على الخريطة" },
        { to: "tables", label: "الطاولات والمناطق", hint: "تعريف أرقام الطاولات وربطها بالمخطط" },
      ],
    },
    {
      title: "3. المنيو والمنتجات",
      items: [
        { to: "menus", label: "المنيو", hint: "تنظيم الأصناف في مجموعات وعرضها في POS" },
        { to: "display-categories", label: "تصنيفات عرض المنيو", hint: "ربط مجموعات TBL006 بتصنيفات عرض رئيسية في شاشة الجرسون" },
        { to: "product-images", label: "صور المنتجات", hint: "رفع صور الأصناف للعرض في المنيو" },
        { to: "addons", label: "الإضافات (كتالوج)", hint: "إضافات اختيارية يمكن اختيارها مع الأصناف" },
        { to: "modifier-groups", label: "إعدادات الشرائح (Wizard)", hint: "تعريف الشرائح العامة وخياراتها والكتابة الحرة داخلها" },
        { to: "product-modifier-links", label: "بروفايلات الأصناف", hint: "ربط كل صنف بالشرائح المناسبة له وترتيبها وخصائصها" },
        { to: "price-lists", label: "قوائم الأسعار", hint: "تعديل الأسعار لكل صنف حسب قائمة السعر" },
        { to: "costing-mode", label: "أساس التكلفة", hint: "طريقة حساب التكلفة: منيو أو تكلفة + نسبة" },
      ],
    },
    {
      title: "4. المطبخ والإنتاج",
      items: [
        { to: "pos-kds", label: "شاشة المطبخ (KDS)", hint: "طريقة عرض الطلبات للطباخين" },
        { to: "pos-prep-times", label: "زمن التحضير لكل صنف", hint: "مدة تحضير كل صنف لحساب وقت التسليم المتوقع" },
        { to: "kitchen-item-stop", label: "إيقاف أصناف المطبخ", hint: "إيقاف بيع أصناف مؤقتاً عند نفاد المخزون" },
      ],
    },
    {
      title: "5. السياسات المالية",
      items: [
        { to: "pos-tax", label: "الضريبة والخدمة", hint: "نسبة الضريبة المضافة ونسبة الخدمة" },
        { to: "minimum-charge", label: "الحد الأدنى للطاولة", hint: "القيمة الافتراضية التي يجب أن يصل إليها حساب كل طاولة" },
        { to: "pos-promos", label: "العروض والتخفيضات", hint: "إنشاء عروض وأكواد خصم" },
        { to: "payment-routing", label: "ربط التحصيل (حسابات)", hint: "حسابات التحصيل لكل وسيلة دفع" },
      ],
    },
    {
      title: "6. دورة العمل والأدوار",
      items: [
        { to: "kitchen-ops", label: "سياسات تشغيل الصالة", hint: "دورة العمل، التنظيف، مسارات الأدوار، VIP، تدقيق" },
        { to: "role-schedule", label: "جدولة أدوار المستخدمين", hint: "دوام كل موظف حسب دوره في النظام" },
        { to: "users", label: "مستخدمو التطبيق", hint: "إنشاء وإدارة حسابات الدخول للموظفين" },
        { to: "pos-shared-terminal", label: "نقاط البيع المشتركة", hint: "إعدادات الطابعات والأجهزة المشتركة" },
      ],
    },
    {
      title: "7. العملاء والخدمات الإضافية",
      items: [
        { to: "customer-vip", label: "تعريف العملاء والمالكين", hint: "تعريف عملاء TBL016 ومجموعات TBL015 وإعدادات المالك/VIP" },
        { to: "kids-area-packages", label: "باقات منطقة الأطفال", hint: "أسعار الدخول والباقات لمنطقة الأطفال" },
      ],
    },
    {
      title: "8. التدقيق والتكاليف اليومية",
      items: [
        { to: "audit-compliance", label: "التدقيق والامتثال", hint: "سجلات التدقيق، جدولة الأدوار، سياسة الدليفري" },
        { to: "costing", label: "التكاليف اليومية", hint: "إدخال تكاليف المواد الخام يومياً" },
        { to: "daily-opening-custody", label: "عهدة أول اليوم", hint: "المبلغ المبدئي في الصندوق" },
        { to: "daily-return", label: "المسترد والمرتجعات", hint: "قيمة المرتجعات اليومية" },
        { to: "daily-overhead", label: "مصاريف التشغيل", hint: "مصاريف الكهرباء، الإيجار، الرواتب..." },
        { to: "daily-cost-engine", label: "محرك التكلفة", hint: "حساب التكلفة الفعلية لكل صنف" },
        { to: "daily-result", label: "النتيجة اليومية", hint: "صافي الربح أو الخسارة اليومية" },
      ],
    },
  ];

  if (role === "manager" || role === "developer") {
    sections.push({
      title: "9. المراكز الإدارية المرتبطة",
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

  // pos-admin-legacy removed — all features (venue, KDS, tax, promos) now in dedicated pages

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
                  title={it.hint || ""}
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
