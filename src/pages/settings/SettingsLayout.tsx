import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { roleHasSystemSettingsAccess, type RoleId } from "../../auth/roles";

type SettingsNavItem = { to: string; label: string; absolute?: boolean; hint?: string };
type SettingsNavSection = { title: string; items: SettingsNavItem[] };

function roleFromPath(pathname: string): RoleId | null {
  const m = pathname.match(/^\/app\/([^/]+)\//);
  return (m?.[1] as RoleId) ?? null;
}

function buildSettingsSections(role: RoleId | null): SettingsNavSection[] {
  const roleBase = role ? `/app/${role}` : "/app/manager";
  const fullSections: SettingsNavSection[] = [
    {
      title: "1. النظام والتعريفات",
      items: [
        { to: "playbook", label: "📖 دليل تشغيل النظام", hint: "الدليل الشامل لفهم تأثير كل إعداد على سير العمل" },
        { to: "master-data", label: "التعريفات الأساسية", hint: "يؤثر على: الوحدات، العملات، ومجموعات البيانات المرجعية في كل الشاشات" },
        { to: "connection", label: "اتصال القاعدة", hint: "يؤثر على: حفظ وقراءة كل الإعدادات والبيانات من SQL Server" },
        { to: "init-db", label: "تهيئة SQL", hint: "يؤثر على: إنشاء الجداول الأولية قبل أي تشغيل فعلي" },
      ],
    },
    {
      title: "2. المنشأ والأساس",
      items: [
        { to: "pos-venue", label: "نوع المنشأ (POS)", hint: "يؤثر على: شكل الفواتير، بعض المسميات، وسلوك التشغيل العام" },
        { to: "venue", label: "المكان والطابق", hint: "يؤثر على: اسم المنشأ، عدد الطوابق، وصياغة الواجهة" },
        { to: "floor-editor", label: "مخطط الصالة (رسم)", hint: "يؤثر على: توزيع الطاولات وظهورها بصرياً في شاشة الصالة" },
        { to: "tables", label: "الطاولات والمناطق", hint: "يؤثر على: أرقام الطاولات، المناطق، وربطها بالمخطط" },
      ],
    },
    {
      title: "3. الأصناف والمنيو",
      items: [
        { to: "menus", label: "المنيو", hint: "يؤثر على: تجميع الأصناف وطريقة عرضها في POS وشاشات الطلب" },
        { to: "display-categories", label: "تصنيفات عرض المنيو", hint: "يؤثر على: خريطة العرض في شاشة الجرسون وربط المجموعات الرئيسية" },
        { to: "product-images", label: "صور المنتجات", hint: "يؤثر على: صور الأصناف في شاشة المنيو، البطاقات، والمراجعة السريعة" },
        { to: "modifier-groups", label: "إعدادات الشرائح (Wizard)", hint: "يؤثر على: خيارات التعديل، الشرائح، والكتابة الحرة أثناء إضافة الصنف" },
        { to: "product-modifier-links", label: "بروفايلات الأصناف", hint: "يؤثر على: الشرائح المتاحة لكل صنف وترتيبها وسلوك الإضافة" },
        { to: "addons", label: "الإضافات (كتالوج)", hint: "يؤثر على: الإضافات الاختيارية التي تظهر مع الأصناف" },
        { to: "price-lists", label: "قوائم الأسعار", hint: "يؤثر على: سعر الصنف في الطلب، الكاشير، والتقارير" },
        { to: "costing-mode", label: "أساس التكلفة", hint: "يؤثر على: طريقة احتساب تكلفة الصنف وهامش الربح" },
      ],
    },
    {
      title: "4. المطبخ والإنتاج",
      items: [
        { to: "pos-kds", label: "شاشة المطبخ (KDS)", hint: "يؤثر على: عرض الطلبات للطباخين، المسارات، والتنبيه عند التأخير" },
        { to: "pos-prep-times", label: "زمن التحضير لكل صنف", hint: "يؤثر على: وقت التسليم المتوقع، العدّاد، وتقارير الأداء" },
        { to: "kitchen-item-stop", label: "إيقاف أصناف المطبخ", hint: "يؤثر على: إيقاف بيع الصنف في الطلب والبحث والماكينة" },
      ],
    },
    {
      title: "5. السياسات المالية",
      items: [
        { to: "pos-tax", label: "الضريبة والخدمة", hint: "يؤثر على: إجمالي الفاتورة، الحساب النهائي، وتقارير الكاشير" },
        { to: "minimum-charge", label: "الحد الأدنى للطاولة", hint: "يؤثر على: الحد الأدنى المفروض على كل جلسة والطباعة المحاسبية" },
        { to: "pos-promos", label: "العروض والتخفيضات", hint: "يؤثر على: الخصومات المطبقة في الطلب والفاتورة والتسويات" },
        { to: "payment-routing", label: "ربط التحصيل (حسابات)", hint: "يؤثر على: ترحيل المدفوعات لكل وسيلة دفع في الحسابات" },
      ],
    },
    {
      title: "6. دورة العمل والأدوار",
      items: [
        { to: "kitchen-ops", label: "سياسات تشغيل الصالة", hint: "يؤثر على: التسكين، التنظيف، التنبيهات، ومسارات الأدوار" },
        { to: "role-schedule", label: "جدولة أدوار المستخدمين", hint: "يؤثر على: من يستطيع الدخول والظهور في الوردية اليوم" },
        { to: "waiter-table-assignments", label: "توزيع طاولات الجرسونات", hint: "يؤثر على: الطاولات المرئية والمسموح بها لكل كابتن" },
        { to: "users", label: "مستخدمو التطبيق", hint: "يؤثر على: حسابات الدخول، الأدوار، والصلاحيات" },
        { to: "pos-shared-terminal", label: "نقاط البيع المشتركة", hint: "يؤثر على: الأجهزة المشتركة، PIN، والسلوك الموحد" },
      ],
    },
    {
      title: "7. العملاء والخدمات الإضافية",
      items: [
        { to: "customer-vip", label: "تعريف العملاء والمالكين", hint: "يؤثر على: مالك/VIP/عميل آجل وربطه بالجلسات والفواتير" },
        { to: "delivery-shipping-zones", label: "تعريف مناطق الدليفري والشحن وأسعارها", hint: "مناطق TBL007 تحت خدمات الشحن — السعر والكود والترقيم التلقائي وخيار الضريبة" },
        { to: "kids-area-packages", label: "باقات منطقة الأطفال", hint: "يؤثر على: أسعار الدخول، الباقات، وربطها بالحساب" },
      ],
    },
    {
      title: "8. التدقيق والتكاليف اليومية",
      items: [
        { to: "audit-compliance", label: "التدقيق والامتثال", hint: "يؤثر على: السجلات، المتابعة، والسياسات التشغيلية الحساسة" },
        { to: "costing", label: "التكاليف اليومية", hint: "يؤثر على: إدخال تكلفة المواد الخام والحسابات اليومية" },
        { to: "daily-opening-custody", label: "عهدة أول اليوم", hint: "يؤثر على: رصيد بداية اليوم في الصندوق" },
        { to: "daily-return", label: "المسترد والمرتجعات", hint: "يؤثر على: المرتجعات اليومية وتصفية العهدة" },
        { to: "daily-overhead", label: "مصاريف التشغيل", hint: "يؤثر على: مصروفات الكهرباء، الإيجار، الرواتب، وغيرها" },
        { to: "daily-cost-engine", label: "محرك التكلفة", hint: "يؤثر على: التكلفة الفعلية وربحية الأصناف" },
        { to: "daily-result", label: "النتيجة اليومية", hint: "يؤثر على: صافي الربح أو الخسارة اليومية" },
      ],
    },
  ];

  if (role === "operation_manager") {
    return [
      {
        title: "1. الصالة والمتابعة اليومية",
        items: [
          { to: "playbook", label: "📖 دليل تشغيل النظام", hint: "الدليل الشامل لفهم تأثير كل إعداد على سير العمل" },
          { to: "venue", label: "المكان والطابق", hint: "يؤثر على: إعدادات الصالة المستخدمة فعلياً اليوم" },
          { to: "floor-editor", label: "مخطط الصالة (رسم)", hint: "يؤثر على: توزيع الطاولات على المخطط التشغيلي" },
          { to: "tables", label: "الطاولات والمناطق", hint: "يؤثر على: حالة الطاولة وتوزيعها اليومي" },
          { to: "kitchen-ops", label: "سياسات تشغيل الصالة", hint: "يؤثر على: التسكين، التنبيهات، وسير الخدمة اليومي" },
          { to: "role-schedule", label: "جدولة أدوار المستخدمين", hint: "يؤثر على: من يعمل اليوم ومن يُسمح له بالدخول" },
          { to: "waiter-table-assignments", label: "توزيع طاولات الجرسونات", hint: "يؤثر على: الطاولات المرئية لكل جرسون في الوردية" },
          { to: "pos-shared-terminal", label: "نقاط البيع المشتركة", hint: "يؤثر على: الجهاز المشترك، PIN، ومسار التبديل" },
        ],
      },
      {
        title: "2. المنيو والمطبخ والتجهيز",
        items: [
          { to: "menus", label: "المنيو", hint: "يؤثر على: تفعيل/تعطيل أصناف اليوم" },
          { to: "display-categories", label: "تصنيفات عرض المنيو", hint: "يؤثر على: ترتيب فئات الشاشة للجرسون" },
          { to: "product-images", label: "صور المنتجات", hint: "يؤثر على: وضوح شاشة الطلب اليومية" },
          { to: "price-lists", label: "قوائم الأسعار", hint: "يؤثر على: أسعار البيع الفعلية اليوم" },
          { to: "modifier-groups", label: "إعدادات الشرائح (Wizard)", hint: "يؤثر على: اختيارات الصنف أثناء الطلب" },
          { to: "product-modifier-links", label: "بروفايلات الأصناف", hint: "يؤثر على: الشرائح المربوطة بكل صنف" },
          { to: "addons", label: "الإضافات (كتالوج)", hint: "يؤثر على: الإضافات السريعة في شاشة الطلب" },
          { to: "pos-kds", label: "شاشة المطبخ (KDS)", hint: "يؤثر على: عرض الطلبات والتنبيه عند التباطؤ" },
          { to: "pos-prep-times", label: "زمن التحضير لكل صنف", hint: "يؤثر على: وقت التسليم المتوقع وقياس الأداء" },
          { to: "kitchen-item-stop", label: "إيقاف أصناف المطبخ", hint: "يؤثر على: ظهور الصنف للبيع والطلب" },
        ],
      },
      {
        title: "3. السياسات المالية اليومية",
        items: [
          { to: "minimum-charge", label: "الحد الأدنى للطاولة", hint: "يؤثر على: الحد الأدنى التشغيلي لكل جلسة وحسابها" },
          { to: "pos-tax", label: "الضريبة والخدمة", hint: "يؤثر على: إجمالي الفاتورة في اليوم التشغيلي" },
          { to: "pos-promos", label: "العروض والتخفيضات", hint: "يؤثر على: خصومات اليوم" },
          { to: "payment-routing", label: "ربط التحصيل (حسابات)", hint: "يؤثر على: توجيه التحصيل حسب وسيلة الدفع" },
          { to: "customer-vip", label: "تعريف العملاء والمالكين", hint: "يؤثر على: Owner/VIP خلال التشغيل" },
          { to: "delivery-shipping-zones", label: "تعريف مناطق الدليفري والشحن وأسعارها", hint: "مناطق الشحن وأسعارها في TBL007" },
          { to: "kids-area-packages", label: "باقات منطقة الأطفال", hint: "يؤثر على: تسعير خدمات الأطفال" },
        ],
      },
      {
        title: "4. المراكز والتقارير",
        items: [
          { to: `${roleBase}/manager-approvals`, label: "موافقات المدير", absolute: true, hint: "يؤثر على: الموافقات الحساسة كتحويل الجلسات وحدود الفواتير" },
          { to: `${roleBase}/guest-returns`, label: "مرتجعات الضيوف", absolute: true, hint: "يؤثر على: المرتجعات وربطها بالحسابات والجلسات" },
          { to: `${roleBase}/delivery-hub`, label: "مركز الدليفري", absolute: true, hint: "واتساب/منصات/تحويل طاولة + طابور التسليم" },
          { to: `${roleBase}/delivery-order`, label: "طلب أصناف الدليفري", absolute: true, hint: "منيو + شحن + بيانات العميل للفاتورة" },
          { to: `${roleBase}/reports`, label: "تقارير", absolute: true, hint: "يؤثر على: تحليل الأداء والقرارات التشغيلية" },
          { to: `${roleBase}/flash-report`, label: "تقرير سريع", absolute: true, hint: "يؤثر على: لقطة فورية للوضع الحالي" },
          { to: `${roleBase}/table-sessions-report`, label: "تقرير جلسات الطاولات", absolute: true, hint: "يؤثر على: تحليل الجلسات، الطلبات، وقياسات الزمن" },
          { to: `${roleBase}/pos`, label: "نقطة البيع", absolute: true, hint: "يؤثر على: تشغيل POS اليومي" },
          { to: `${roleBase}/purchases`, label: "المشتريات", absolute: true, hint: "يؤثر على: احتياجات الشراء اليومية" },
          { to: `${roleBase}/cash-expense`, label: "صرف مصروفات", absolute: true, hint: "يؤثر على: المصروفات التشغيلية" },
          { to: `${roleBase}/cashflow`, label: "التدفق النقدي", absolute: true, hint: "يؤثر على: متابعة النقدية" },
        ],
      },
      {
        title: "5. التكاليف اليومية",
        items: [
          { to: "costing", label: "التكاليف اليومية", hint: "يؤثر على: تكلفة التشغيل اليومية" },
          { to: "daily-opening-custody", label: "عهدة أول اليوم", hint: "يؤثر على: رصيد بداية الوردية" },
          { to: "daily-return", label: "المسترد والمرتجعات", hint: "يؤثر على: تسويات اليوم" },
          { to: "daily-overhead", label: "مصاريف التشغيل", hint: "يؤثر على: مصروفات اليوم" },
          { to: "daily-cost-engine", label: "محرك التكلفة", hint: "يؤثر على: تحليل التكلفة اللحظي" },
          { to: "daily-result", label: "النتيجة اليومية", hint: "يؤثر على: ربح/خسارة اليوم" },
        ],
      },
    ];
  }

  if (roleHasSystemSettingsAccess(role)) {
    fullSections.push({
      title: "9. المراكز الإدارية المرتبطة",
      items: [
        { to: `${roleBase}/guest-returns`, label: "مرتجعات الضيوف", absolute: true, hint: "يؤثر على: مرتجعات الضيوف والتسويات" },
        { to: `${roleBase}/delivery-hub`, label: "مركز الدليفري", absolute: true, hint: "واتساب/منصات/تحويل طاولة + طابور التسليم" },
        { to: `${roleBase}/delivery-order`, label: "طلب أصناف الدليفري", absolute: true, hint: "منيو + شحن + بيانات العميل للفاتورة" },
        { to: `${roleBase}/purchases`, label: "المشتريات", absolute: true, hint: "يؤثر على: أوامر الشراء والمخزون" },
        { to: `${roleBase}/cash-expense`, label: "صرف مصروفات", absolute: true, hint: "يؤثر على: المصروفات النقدية اليومية" },
        { to: `${roleBase}/reports`, label: "تقارير الحسابات", absolute: true, hint: "يؤثر على: قراءة الأداء المالي والتشغيلي" },
        { to: `${roleBase}/cashflow`, label: "التدفق النقدي", absolute: true, hint: "يؤثر على: تتبع الداخل والخارج النقدي" },
      ],
    });
  }

  // pos-admin-legacy removed — all features (venue, KDS, tax, promos) now in dedicated pages

  return fullSections;
}

function itemHref(base: string, item: SettingsNavItem): string {
  return item.absolute ? item.to : `${base}/${item.to}`;
}

function findActiveSectionTitle(pathname: string, base: string, sections: SettingsNavSection[]): string | null {
  for (const sec of sections) {
    for (const item of sec.items) {
      const href = itemHref(base, item);
      if (pathname === href || pathname.startsWith(`${href}/`)) {
        return sec.title;
      }
    }
  }
  return sections[0]?.title ?? null;
}

export default function SettingsLayout() {
  const loc = useLocation();
  const role = roleFromPath(loc.pathname);
  const base = role ? `/app/${role}/settings` : "/app/manager/settings";
  const sections = buildSettingsSections(role);
  const asideTitle = role === "operation_manager" ? "إعدادات مدير التشغيل" : "مركز الإعدادات والإدارة";
  const defaultOpenTitle = useMemo(() => findActiveSectionTitle(loc.pathname, base, sections), [loc.pathname, base, sections]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    defaultOpenTitle ? { [defaultOpenTitle]: true } : {},
  );

  useEffect(() => {
    if (!defaultOpenTitle) return;
    setOpenSections((prev) => ({ ...prev, [defaultOpenTitle]: true }));
  }, [defaultOpenTitle]);

  function toggleSection(title: string) {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));
  }

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
          {role === "operation_manager"
            ? "إعدادات يومية سريعة فقط، بدون صفحات التأسيس أو تعريفات النظام أو إدارة المستخدمين."
            : "ترتيب مرقّم للتدريب والتشغيل، مع ضم الشاشات الإدارية المرتبطة داخل مرجع واحد."}
        </div>
        {sections.map((sec) => (
          <div
            key={sec.title}
            style={{
              border: "1px solid rgba(148,163,184,0.14)",
              borderRadius: 12,
              background: openSections[sec.title] ? "rgba(15,23,42,0.18)" : "rgba(255,255,255,0.03)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => toggleSection(sec.title)}
              style={{
                width: "100%",
                border: "none",
                background: "transparent",
                color: "var(--text)",
                cursor: "pointer",
                padding: "0.7rem 0.8rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                fontSize: "0.88rem",
                fontWeight: 900,
                textAlign: "right",
              }}
              aria-expanded={openSections[sec.title] ? "true" : "false"}
            >
              <span>{sec.title}</span>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{openSections[sec.title] ? "▲" : "▼"}</span>
            </button>
            {openSections[sec.title] ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.28rem", padding: "0 0.45rem 0.5rem" }}>
                {sec.items.map((it, itemIndex) => (
                  <NavLink
                    key={`${sec.title}-${it.to}`}
                    to={itemHref(base, it)}
                    title={it.hint || ""}
                    className={({ isActive }) => (isActive ? "nav-link nav-link--active" : "nav-link")}
                    style={{
                      fontSize: "0.9rem",
                      padding: "0.52rem 0.65rem",
                      borderRadius: 10,
                      lineHeight: 1.4,
                    }}
                  >
                    {`${sec.title.split(".")[0]}.${itemIndex + 1} ${it.label}`}
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </aside>
      <section style={{ flex: 1, minWidth: 0 }}>
        <Outlet />
      </section>
    </div>
  );
}


