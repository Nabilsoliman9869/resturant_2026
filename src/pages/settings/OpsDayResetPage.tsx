import { useState, type CSSProperties } from "react";
import { safeFetch } from "../../lib/safeFetch";
import { buildMat3amActor } from "../../lib/mat3amActor";
import { useAuth } from "../../auth/AuthContext";
import { getApiBase } from "../../lib/apiBase";

export default function OpsDayResetPage() {
  const { user } = useAuth();
  const base = getApiBase();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [clearInvoices, setClearInvoices] = useState(false);

  const runReset = async () => {
    const ok = window.confirm(
      "تأكيد بدء يوم عمل جديد؟\n\nسيتم مسح: الجلسات، الطلبات، الموافقات، التنبيهات، الوارد، تحويلات الكابتن، المرتجعات المعلّقة، وتذاكر الدليفري — وإرجاع كل الطاولات إلى جاهزة.\n\nلن تُمس: المنيو، المستخدمون، الإعدادات، مخطط الصالة، وتوزيع الطاولات.",
    );
    if (!ok) return;
    const typed = window.prompt('اكتب RESET_DAY للتأكيد النهائي:', "");
    if (String(typed || "").trim() !== "RESET_DAY") {
      setErr("أُلغي التصفير — لم يُكتب RESET_DAY");
      return;
    }
    setBusy(true);
    setMsg(null);
    setErr(null);
    setResult(null);
    try {
      const r = await safeFetch(`${base}/api/restaurant/ops-day-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "RESET_DAY",
          purgeHistory: true,
          clearDelivery: true,
          clearInvoices,
          reason: "بدء يوم عمل جديد من الإعدادات",
          mat3amActor: buildMat3amActor(user),
        }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
      const j = JSON.parse(t) as Record<string, unknown>;
      setResult(j);
      setMsg("تم تصفير يوم العمل — يمكنك البدء من الصفر.");
      try {
        window.dispatchEvent(new CustomEvent("mat3am:ops-day-reset"));
      } catch {
        /* ignore */
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ direction: "rtl", padding: "0.5rem 0.25rem 2rem", maxWidth: 720 }}>
      <h2 style={{ margin: "0 0 6px" }}>بدء يوم عمل جديد</h2>
      <p style={{ color: "var(--muted)", fontSize: ".9rem", marginTop: 0, lineHeight: 1.65 }}>
        تصفير تشغيلي كامل لما يظهر في التقارير والشاشات الحية: جلسات نشطة، طلبات مطبخ، موافقات معلّقة، وتنبيهات.
      </p>

      <section style={card}>
        <h3 style={h3}>ما الذي يُمسَح؟</h3>
        <ul style={{ margin: 0, paddingInlineStart: "1.2rem", fontSize: ".88rem", lineHeight: 1.75 }}>
          <li>جلسات الطاولات (نشطة وسابقة)</li>
          <li>الطلبات التشغيلية</li>
          <li>موافقات المدير المعلّقة والسجل</li>
          <li>تنبيهات الكاشير ووارد الأدوار</li>
          <li>تحويلات الكابتن المؤقتة وطلبات الإرجاع</li>
          <li>تذاكر الدليفري + جلسات منطقة الأطفال</li>
          <li>إرجاع كل الطاولات إلى حالة «جاهزة»</li>
        </ul>
        <p style={{ margin: "12px 0 0", fontSize: ".86rem", color: "var(--muted)" }}>
          يبقى كما هو: المنيو، الصور، المستخدمون، الإعدادات، مخطط الصالة، توزيع الطاولات، وإعدادات تليجرام.
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, fontSize: ".88rem" }}>
          <input type="checkbox" checked={clearInvoices} onChange={(e) => setClearInvoices(e.target.checked)} />
          مسح الفواتير المحلية أيضاً (للتجربة فقط — غير مُستحسن في الإنتاج)
        </label>
        <div style={{ marginTop: 16 }}>
          <button type="button" style={dangerBtn} disabled={busy} onClick={() => void runReset()}>
            {busy ? "جاري التصفير…" : "تصفير وبدء يوم عمل جديد"}
          </button>
        </div>
      </section>

      {msg ? <p style={{ color: "#34d399" }}>{msg}</p> : null}
      {err ? <p style={{ color: "#f87171", whiteSpace: "pre-wrap" }}>{err}</p> : null}
      {result ? (
        <pre style={pre}>{JSON.stringify(result, null, 2)}</pre>
      ) : null}
    </div>
  );
}

const card: CSSProperties = {
  border: "1px solid rgba(248,113,113,0.35)",
  borderRadius: 12,
  padding: "1rem 1.1rem",
  background: "rgba(127,29,29,0.12)",
  marginBottom: "1rem",
};
const h3: CSSProperties = { margin: "0 0 10px", fontSize: "1rem" };
const dangerBtn: CSSProperties = {
  background: "#b91c1c",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "0.65rem 1.1rem",
  fontWeight: 700,
  cursor: "pointer",
};
const pre: CSSProperties = {
  background: "rgba(0,0,0,0.35)",
  borderRadius: 10,
  padding: "0.75rem 1rem",
  fontSize: 12,
  overflow: "auto",
  direction: "ltr",
  textAlign: "left",
};
