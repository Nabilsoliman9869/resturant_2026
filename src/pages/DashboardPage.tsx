import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import FloorPlanLive from "../components/FloorPlanLive";
import { CashierTableStripBoard } from "../components/CashierTableStripBoard";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const meals = [
  { name: "إفطار", orders: 42 },
  { name: "غداء", orders: 128 },
  { name: "عشاء", orders: 96 },
  { name: "سناك", orders: 34 },
];

const topItems = [
  { name: "برجر كلاسيك", qty: 89 },
  { name: "بيتزا مارجريتا", qty: 76 },
  { name: "سلطة سيزر", qty: 54 },
  { name: "مشروب ليمون", qty: 112 },
];

const tableRev = [
  { table: "T1", revenue: 4200 },
  { table: "T2", revenue: 3100 },
  { table: "T3", revenue: 5800 },
  { table: "T4", revenue: 2400 },
  { table: "T5", revenue: 1900 },
];

const staff = [
  { name: "سارة", score: 92 },
  { name: "عمر", score: 88 },
  { name: "ليلى", score: 95 },
  { name: "كريم", score: 79 },
];

const COLORS = ["#f97316", "#22d3ee", "#a78bfa", "#34d399", "#fb7185"];

export default function DashboardPage() {
  const { user } = useAuth();
  const role = user?.role;
  const floorInSettings = role === "manager" || role === "developer";
  const shouldShowLiveFloor = role === "cashier" || role === "waiter" || role === "server" || role === "host" || role === "manager" || role === "developer";

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.85rem" }}>
        لوحة الأداء
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        {role === "cashier"
          ? "لوحة التشغيل الحي للصالة. تسديد حسابات الطاولات يتم من «تسديد فواتير الطاولات» بعد أن يطلب الجرسون الحساب؛ نقطة البيع هنا للبار والسفري والدفع الفوري وليست نفس مسار الطاولة المفتوحة."
          : "بيانات توضيحية — تُستبدل لاحقاً بـ API (طلبات، فواتير، جلسات طاولات، ساعات ذروة)."}
        {floorInSettings
          ? " مخطط الصالة والمساحات مُنظَّم ضمن «إعدادات النظام»."
          : role !== "cashier"
            ? " خريطة الصالة أدناه تُحدَّث من الطلبات والجلسات الفعلية."
            : ""}
      </p>

      {shouldShowLiveFloor && (
        <>
          {role === "cashier" && (
            <>
              <div className="card" style={{ marginBottom: "1rem", lineHeight: 1.75 }}>
                <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>مسار التشغيل (كاشير ↔ صالة)</h3>
                <ol style={{ margin: 0, paddingRight: "1.25rem", color: "var(--muted)" }}>
                  <li>
                    <strong style={{ color: "var(--foreground, inherit)" }}>استقبال</strong> يفتح جلسة؛{" "}
                    <strong style={{ color: "var(--foreground, inherit)" }}>الجرسون</strong> يضيف طلبات (مطبخ، بدون فاتورة كاشير جاهزة).
                  </li>
                  <li>
                    عند طلب العميل الحساب: الجرسون «طلب الحساب» → تظهر الفاتورة في{" "}
                    <NavLink to="../invoices-local" style={{ fontWeight: 700 }}>
                      تسديد فواتير الطاولات
                    </NavLink>
                    .
                  </li>
                  <li>
                    إدارة الجلسات المكررة أو النقل:{" "}
                    <NavLink to="../table-sessions" style={{ fontWeight: 700 }}>
                      جلسات الطاولات
                    </NavLink>
                    .
                  </li>
                  <li>
                    <NavLink to="../pos" style={{ fontWeight: 700 }}>
                      نقطة البيع
                    </NavLink>{" "}
                    لمسارات أخرى (بار، سفري، دفع فوري).
                  </li>
                </ol>
              </div>
              <CashierTableStripBoard />
            </>
          )}
          <FloorPlanLive />
          {floorInSettings && (
            <div className="card" style={{ marginTop: "1rem" }}>
              <p style={{ margin: 0, lineHeight: 1.55 }}>
                لإدارة المخطط: {" "}
                <NavLink to="../settings/venue" style={{ fontWeight: 700, textDecoration: "underline" }}>
                  إعدادات النظام ← المكان والطابق والمساحات
                </NavLink>
              </p>
            </div>
          )}
        </>
      )}

      {role === "cashier" ? null : (
        <div className="grid-2" style={{ marginBottom: "1rem" }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>ملخص الوجبات</h3>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={meals}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155" }}
                  />
                  <Bar dataKey="orders" fill="#f97316" radius={[6, 6, 0, 0]} name="طلبات" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>أكثر الأصناف طلباً</h3>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={topItems}
                    dataKey="qty"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={88}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {topItems.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {role === "cashier" ? null : (
        <div className="grid-2">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>إيراد حسب الطاولة</h3>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={tableRev}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="table" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155" }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    name="إيراد"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>أداء الموظفين (مؤشر جودة)</h3>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={staff} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis type="number" domain={[0, 100]} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="name" width={72} stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155" }}
                  />
                  <Bar dataKey="score" fill="#34d399" radius={[0, 6, 6, 0]} name="النتيجة" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
