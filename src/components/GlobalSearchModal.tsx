import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

type SearchResult = {
  title: string;
  path: string;
  subtitle: string;
  keywords: string;
};

const ALL_ITEMS: SearchResult[] = [
  // إعدادات
  { title: "التعريفات الأساسية", path: "master-data", subtitle: "النظام والتعريفات", keywords: "عملة وحدات مجموعات currency units" },
  { title: "اتصال القاعدة", path: "connection", subtitle: "النظام والتعريفات", keywords: "sql server database قاعدة بيانات" },
  { title: "تهيئة SQL", path: "init-db", subtitle: "النظام والتعريفات", keywords: "جداول create tables" },
  { title: "نوع المنشأ (POS)", path: "pos-venue", subtitle: "المنشأ والأساس", keywords: "مطعم كافيه فندق restaurant cafe" },
  { title: "المكان والطابق", path: "venue", subtitle: "المنشأ والأساس", keywords: "اسم المنشأ طوابق" },
  { title: "مخطط الصالة (رسم)", path: "floor-editor", subtitle: "المنشأ والأساس", keywords: "خريطة طاولات رسم map" },
  { title: "الطاولات والمناطق", path: "tables", subtitle: "المنشأ والأساس", keywords: "أرقام طاولات zones" },
  { title: "المنيو", path: "menus", subtitle: "المنيو والمنتجات", keywords: "أصناف menu items" },
  { title: "صور المنتجات", path: "product-images", subtitle: "المنيو والمنتجات", keywords: "upload images رفع صور" },
  { title: "الإضافات (كتالوج)", path: "addons", subtitle: "المنيو والمنتجات", keywords: "extras toppings إضافات" },
  { title: "قوائم الأسعار", path: "price-lists", subtitle: "المنيو والمنتجات", keywords: "prices تسعير" },
  { title: "أساس التكلفة", path: "costing-mode", subtitle: "المنيو والمنتجات", keywords: "cost تكلفة menu pricing" },
  { title: "شاشة المطبخ (KDS)", path: "pos-kds", subtitle: "المطبخ والإنتاج", keywords: "kitchen display طباخين" },
  { title: "زمن التحضير لكل صنف", path: "pos-prep-times", subtitle: "المطبخ والإنتاج", keywords: "prep time وقت تحضير" },
  { title: "إيقاف أصناف المطبخ", path: "kitchen-item-stop", subtitle: "المطبخ والإنتاج", keywords: "stop out of stock نفاد" },
  { title: "الضريبة والخدمة", path: "pos-tax", subtitle: "السياسات المالية", keywords: "vat tax service ضريبة" },
  { title: "الحد الأدنى للطاولة", path: "minimum-charge", subtitle: "السياسات المالية", keywords: "minimum charge حد أدنى" },
  { title: "العروض والتخفيضات", path: "pos-promos", subtitle: "السياسات المالية", keywords: "promotion discount خصم عرض كوبون coupon" },
  { title: "ربط التحصيل (حسابات)", path: "payment-routing", subtitle: "السياسات المالية", keywords: "payment accounts تحصيل" },
  { title: "سياسات تشغيل الصالة", path: "kitchen-ops", subtitle: "دورة العمل والأدوار", keywords: "operations workflow أدوار" },
  { title: "جدولة أدوار المستخدمين", path: "role-schedule", subtitle: "دورة العمل والأدوار", keywords: "schedule shifts وردية" },
  { title: "مستخدمو التطبيق", path: "users", subtitle: "دورة العمل والأدوار", keywords: "users login accounts حسابات" },
  { title: "نقاط البيع المشتركة", path: "pos-shared-terminal", subtitle: "دورة العمل والأدوار", keywords: "printers terminals طابعات" },
  { title: "تعريف العملاء والمالكين", path: "customer-vip", subtitle: "العملاء والخدمات", keywords: "agents customers owners vip عملاء مالكين" },
  { title: "باقات منطقة الأطفال", path: "kids-area-packages", subtitle: "العملاء والخدمات", keywords: "kids children أطفال" },
  { title: "التدقيق والامتثال", path: "audit-compliance", subtitle: "التدقيق والتكاليف", keywords: "audit compliance تدقيق" },
  { title: "التكاليف اليومية", path: "costing", subtitle: "التدقيق والتكاليف", keywords: "daily cost materials raw" },
  { title: "عهدة أول اليوم", path: "daily-opening-custody", subtitle: "التدقيق والتكاليف", keywords: "opening custody صندوق" },
  { title: "المسترد والمرتجعات", path: "daily-return", subtitle: "التدقيق والتكاليف", keywords: "returns مرتجعات" },
  { title: "مصاريف التشغيل", path: "daily-overhead", subtitle: "التدقيق والتكاليف", keywords: "overhead expenses مصاريف" },
  { title: "محرك التكلفة", path: "daily-cost-engine", subtitle: "التدقيق والتكاليف", keywords: "cost engine محرك" },
  { title: "النتيجة اليومية", path: "daily-result", subtitle: "التدقيق والتكاليف", keywords: "daily result profit loss" },
  // صفحات تشغيلية
  { title: "داشبورد", path: "/app/manager", subtitle: "الرئيسية", keywords: "dashboard home رئيسية" },
  { title: "شريحات الطاولات", path: "table-slides", subtitle: "الصالة", keywords: "tables طاولات شرائح" },
  { title: "طلب للطاولة", path: "order", subtitle: "الصالة", keywords: "order طلب" },
  { title: "مرتجعات الضيوف", path: "/app/manager/guest-returns", subtitle: "مراكز إدارية", keywords: "guest returns مرتجعات" },
  { title: "Call Center (دليفري)", path: "/app/manager/call-center", subtitle: "مراكز إدارية", keywords: "delivery call center دليفري" },
  { title: "إدارة الدليفري", path: "/app/manager/delivery-management", subtitle: "مراكز إدارية", keywords: "delivery إدارة" },
  { title: "نقطة البيع", path: "/app/manager/pos", subtitle: "مراكز إدارية", keywords: "pos point of sale" },
  { title: "المشتريات", path: "/app/manager/purchases", subtitle: "مراكز إدارية", keywords: "purchases مشتريات" },
  { title: "صرف مصروفات", path: "/app/manager/cash-expense", subtitle: "مراكز إدارية", keywords: "expense cash صرف" },
  { title: "تقارير الحسابات", path: "/app/manager/reports", subtitle: "مراكز إدارية", keywords: "reports تقارير" },
  { title: "التدفق النقدي", path: "/app/manager/cashflow", subtitle: "مراكز إدارية", keywords: "cashflow نقدي" },
];

function score(q: string, it: SearchResult): number {
  const s = q.trim();
  if (!s) return 0;
  const t = `${it.title} ${it.subtitle} ${it.keywords}`.toLowerCase();
  if (t.includes(s)) return 10;
  const words = s.split(/\s+/);
  let hits = 0;
  for (const w of words) {
    if (t.includes(w)) hits++;
  }
  return hits;
}

export default function GlobalSearchModal({ role }: { role: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const scored = ALL_ITEMS.map((it) => ({ it, sc: score(query.toLowerCase(), it) })).filter((x) => x.sc > 0);
    scored.sort((a, b) => b.sc - a.sc);
    return scored.slice(0, 12).map((x) => x.it);
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const go = (path: string) => {
    const base = `/app/${role}`;
    const url = path.startsWith("/") ? path : `${base}/settings/${path}`;
    navigate(url);
    setOpen(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "8vh"
    }} onClick={() => setOpen(false)}>
      <div style={{
        width: "min(680px, 92vw)", background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden"
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 18, opacity: 0.6 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && results.length) go(results[0].path); }}
            placeholder="ابحث في الإعدادات والصفحات... (مثال: عميل، KDS، ضريبة)"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, color: "var(--text)" }}
          />
          <kbd style={{ fontSize: 12, opacity: 0.5, background: "var(--surface)", padding: "2px 8px", borderRadius: 6 }}>Esc</kbd>
        </div>
        <div style={{ maxHeight: "52vh", overflow: "auto" }}>
          {results.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
              {query.trim() ? "لا توجد نتائج" : "اكتب للبحث..."}
            </div>
          ) : (
            results.map((r) => (
              <button key={r.path + r.title} type="button" onClick={() => go(r.path)} style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "right",
                padding: "10px 16px", border: "none", background: "transparent", cursor: "pointer",
                borderBottom: "1px solid rgba(15,23,42,0.04)", fontSize: 14, color: "var(--text)"
              }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(37,99,235,0.08)"; }}
                 onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <span style={{ fontSize: 18, opacity: 0.5 }}>→</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.subtitle}</div>
                </div>
              </button>
            ))
          )}
        </div>
        <div style={{ padding: "8px 16px", fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
          <span>Ctrl+K للفتح</span>
          <span>{results.length} نتيجة</span>
        </div>
      </div>
    </div>
  );
}
