import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { getApiBase } from "../lib/apiBase";
import { safeFetch } from "../lib/safeFetch";

type PeriodSummary = {
  invoiceCount: number;
  revenueNetNoTax: number;
  serviceCharge: number;
  taxVat: number;
  revenueWithTax: number;
  tips: number;
  kids: {
    invoiceCount: number;
    revenueNetNoTax: number;
    serviceCharge: number;
    taxVat: number;
    revenueWithTax: number;
  };
  delivery: { invoiceCount: number; revenueNetNoTax: number; revenueWithTax: number };
  expenses: {
    cashierExpenses: number;
    cashierPurchases: number;
    overheadIndirect: number;
    total: number;
  };
  profitVsNetRevenue: number;
  profitVsGrossRevenue: number;
};

type PeriodReport = {
  fromDate: string;
  toDate: string;
  summary: PeriodSummary;
  byItem: Array<{ productGuide?: string; name: string; qty: number; net: number }>;
  byTable: Array<{ tableId?: string; tableLabel: string; invoices: number; net: number; tax: number; grossWithTax: number }>;
  byCaptain: Array<{ captainName: string; invoices: number; net: number; tax: number; grossWithTax: number }>;
  cashOutflows: Array<{ kind: string; category: string; note: string; amount: number; at: string; by: string }>;
  overheadLines: Array<{ date: string; name: string; amount: number; note: string }>;
  message?: string;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}
function monthStartISO() {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-01`;
}
const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PeriodFinanceReportsPage() {
  const base = getApiBase();
  const [fromDate, setFromDate] = useState(monthStartISO);
  const [toDate, setToDate] = useState(todayISO);
  const [channel, setChannel] = useState("all");
  const [tableId, setTableId] = useState("");
  const [captain, setCaptain] = useState("");
  const [productGuide, setProductGuide] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<PeriodReport | null>(null);
  const [mode, setMode] = useState<"net" | "gross">("net");

  const run = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const q = new URLSearchParams();
      q.set("from_date", fromDate);
      q.set("to_date", toDate);
      q.set("channel", channel);
      if (tableId.trim()) q.set("table_id", tableId.trim());
      if (captain.trim()) q.set("captain", captain.trim());
      if (productGuide.trim()) q.set("product_guide", productGuide.trim());
      const r = await safeFetch(`${base}/api/reports/period-finance?${q}`);
      const j = (await r.json().catch(() => ({}))) as PeriodReport & { detail?: string };
      if (!r.ok) throw new Error(j.detail || `فشل التقرير (${r.status})`);
      setData(j);
    } catch (e) {
      setData(null);
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [base, fromDate, toDate, channel, tableId, captain, productGuide]);

  const s = data?.summary;

  return (
    <div style={{ direction: "rtl", padding: "0.5rem 0.25rem 2rem", maxWidth: 1100 }}>
      <h2 style={{ margin: "0 0 6px" }}>تقارير الإيراد والمصروفات</h2>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: ".9rem", lineHeight: 1.6 }}>
        إيراد بدون ضريبة / مع ضريبة عن فترة، مع فلاتر الصنف والطاولة والكابتن، ودخل الكيدز، ومقابلة المصروفات
        (صندوق + مصاريف عمومية غير مباشرة).
      </p>

      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "1rem",
          background: "rgba(0,0,0,0.18)",
          marginBottom: "1rem",
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        }}
      >
        <label>
          من
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inp} />
        </label>
        <label>
          إلى
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inp} />
        </label>
        <label>
          القناة
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={inp}>
            <option value="all">الكل</option>
            <option value="dine_in">صالة</option>
            <option value="delivery">دليفري</option>
            <option value="kids">كيدز أيريا</option>
          </select>
        </label>
        <label>
          طاولة (اسم/رقم)
          <input value={tableId} onChange={(e) => setTableId(e.target.value)} placeholder="مثال T12" style={inp} />
        </label>
        <label>
          كابتن
          <input value={captain} onChange={(e) => setCaptain(e.target.value)} placeholder="اسم أو جزء منه" style={inp} />
        </label>
        <label>
          صنف (GUID)
          <input value={productGuide} onChange={(e) => setProductGuide(e.target.value)} placeholder="اختياري" style={inp} />
        </label>
        <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
            {busy ? "جاري…" : "تشغيل التقرير"}
          </button>
        </div>
      </section>

      {err ? <p style={{ color: "#f87171" }}>{err}</p> : null}

      {s ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" className={`btn ${mode === "net" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("net")}>
              عرض بدون ضريبة
            </button>
            <button type="button" className={`btn ${mode === "gross" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("gross")}>
              عرض مع ضريبة (+ خدمة)
            </button>
          </div>

          <div style={cards}>
            <Stat title="فواتير" value={String(s.invoiceCount)} />
            <Stat title="إيراد بدون ضريبة" value={`${fmt(s.revenueNetNoTax)} ج.م`} accent="#34d399" />
            <Stat title="ضريبة VAT" value={`${fmt(s.taxVat)} ج.م`} />
            <Stat title="خدمة" value={`${fmt(s.serviceCharge)} ج.م`} />
            <Stat title="إيراد مع ضريبة" value={`${fmt(s.revenueWithTax)} ج.م`} accent="#38bdf8" />
            <Stat title="مصروفات إجمالية" value={`${fmt(s.expenses.total)} ج.م`} accent="#fbbf24" />
            <Stat
              title={mode === "net" ? "صافي (إيراد بلا ضريبة − مصروف)" : "صافي (إيراد مع ضريبة − مصروف)"}
              value={`${fmt(mode === "net" ? s.profitVsNetRevenue : s.profitVsGrossRevenue)} ج.م`}
              accent="#a78bfa"
            />
          </div>

          <h3 style={h3}>دخل الكيدز أيريا</h3>
          <div style={cards}>
            <Stat title="فواتير كيدز" value={String(s.kids.invoiceCount)} />
            <Stat title="إيراد كيدز بلا ضريبة" value={`${fmt(s.kids.revenueNetNoTax)} ج.م`} />
            <Stat title="إيراد كيدز مع ضريبة" value={`${fmt(s.kids.revenueWithTax)} ج.م`} />
          </div>

          <h3 style={h3}>الدليفري</h3>
          <div style={cards}>
            <Stat title="فواتير دليفري" value={String(s.delivery.invoiceCount)} />
            <Stat title="إيراد بلا ضريبة" value={`${fmt(s.delivery.revenueNetNoTax)} ج.م`} />
            <Stat title="إيراد مع ضريبة" value={`${fmt(s.delivery.revenueWithTax)} ج.م`} />
          </div>

          <h3 style={h3}>تفصيل المصروفات (الظاهرة والخفية)</h3>
          <div style={cards}>
            <Stat title="صرف صندوق (مصروف)" value={`${fmt(s.expenses.cashierExpenses)} ج.م`} />
            <Stat title="مشتريات من الصندوق" value={`${fmt(s.expenses.cashierPurchases)} ج.م`} />
            <Stat title="عمومية / غير مباشرة" value={`${fmt(s.expenses.overheadIndirect)} ج.م`} accent="#fb7185" />
          </div>

          <TwoCol
            leftTitle="حسب الطاولة"
            rightTitle="حسب الكابتن"
            left={
              <SimpleTable
                cols={["الطاولة", "فواتير", mode === "net" ? "صافي" : "مع ضريبة"]}
                rows={(data?.byTable || []).map((r) => [
                  r.tableLabel || r.tableId || "—",
                  String(r.invoices),
                  fmt(mode === "net" ? r.net : r.grossWithTax),
                ])}
              />
            }
            right={
              <SimpleTable
                cols={["الكابتن", "فواتير", mode === "net" ? "صافي" : "مع ضريبة"]}
                rows={(data?.byCaptain || []).map((r) => [
                  r.captainName || "—",
                  String(r.invoices),
                  fmt(mode === "net" ? r.net : r.grossWithTax),
                ])}
              />
            }
          />

          <h3 style={h3}>حسب الصنف</h3>
          <SimpleTable
            cols={["الصنف", "كمية", "صافي"]}
            rows={(data?.byItem || []).map((r) => [r.name, String(r.qty), fmt(r.net)])}
          />

          <h3 style={h3}>بنود المصاريف العمومية (غير مباشرة)</h3>
          <SimpleTable
            cols={["التاريخ", "البند", "المبلغ", "ملاحظة"]}
            rows={(data?.overheadLines || []).map((r) => [r.date, r.name, fmt(r.amount), r.note || "—"])}
          />

          <h3 style={h3}>صرف الصندوق في الفترة</h3>
          <SimpleTable
            cols={["وقت", "نوع", "فئة", "مبلغ", "بواسطة"]}
            rows={(data?.cashOutflows || []).map((r) => [
              r.at.replace("T", " "),
              r.kind,
              r.category || "—",
              fmt(r.amount),
              r.by || "—",
            ])}
          />

          {data?.message ? <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>{data.message}</p> : null}
        </>
      ) : null}
    </div>
  );
}

function Stat({ title, value, accent }: { title: string; value: string; accent?: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "rgba(15,23,42,0.35)" }}>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>{title}</div>
      <div style={{ fontWeight: 800, fontSize: "1.05rem", color: accent || "var(--text)" }}>{value}</div>
    </div>
  );
}

function TwoCol({ leftTitle, rightTitle, left, right }: { leftTitle: string; rightTitle: string; left: ReactNode; right: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
      <div>
        <h3 style={h3}>{leftTitle}</h3>
        {left}
      </div>
      <div>
        <h3 style={h3}>{rightTitle}</h3>
        {right}
      </div>
    </div>
  );
}

function SimpleTable({ cols, rows }: { cols: string[]; rows: string[][] }) {
  if (!rows.length) return <p style={{ color: "var(--muted)", fontSize: 13 }}>لا بيانات</p>;
  return (
    <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={th}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={td}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inp: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2, #1e293b)",
  color: "var(--text)",
};
const cards: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 10,
  marginBottom: 16,
};
const h3: CSSProperties = { margin: "18px 0 8px", fontSize: "1rem" };
const th: CSSProperties = {
  textAlign: "right",
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  background: "rgba(0,0,0,0.25)",
  whiteSpace: "nowrap",
};
const td: CSSProperties = {
  padding: "7px 10px",
  borderBottom: "1px solid rgba(148,163,184,0.15)",
  whiteSpace: "nowrap",
};
