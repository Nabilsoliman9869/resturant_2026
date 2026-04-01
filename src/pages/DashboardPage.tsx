import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import FloorPlanLive from "../components/FloorPlanLive";
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

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.85rem" }}>
        لوحة الأداء
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        بيانات توضيحية — تُستبدل لاحقاً بـ API (طلبات، فواتير، جلسات طاولات، ساعات ذروة).
        {floorInSettings
          ? " مخطط الصالة والمساحات مُنظَّم ضمن «إعدادات النظام»."
          : " خريطة الصالة أدناه تُحدَّث من الطلبات والجلسات الفعلية."}
      </p>

      {floorInSettings ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p style={{ margin: 0, lineHeight: 1.55 }}>
            <strong>مخطط الصالة الحي</strong> (طابق، شكل الصالة، طاولات SVG) موجود في{" "}
            <NavLink to="../settings/venue" style={{ fontWeight: 700, textDecoration: "underline" }}>
              إعدادات النظام ← المكان والطابق والمساحات
            </NavLink>
            .
          </p>
        </div>
      ) : role === "cashier" ? (
        <FloorPlanLive />
      ) : null}

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
    </div>
  );
}
