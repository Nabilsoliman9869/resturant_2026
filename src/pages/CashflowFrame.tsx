import { getApiBase } from "../lib/apiBase";

/**
 * واجهة التدفق النقدي (Smart CashFlow) من خادم إكسترا — نفس ملف ui/modules/cashflow.
 * يتصل بـ /api/* على نفس منفذ الـ API (طلبات نسبية من داخل الـ iframe).
 */
export default function CashflowFrame() {
  const base = getApiBase();
  const src = `${base}/modules/cashflow/index.html?api_base=${encodeURIComponent(base)}`;

  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: "hidden",
        height: "calc(100vh - 5rem)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
        }}
      >
        <div style={{ fontWeight: 700 }}>التدفق النقدي</div>
        <div style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.5 }}>
          الواجهة داخل iframe، والأزرار تعتمد على واجهات API على <code style={{ color: "var(--text)" }}>VITE_XTRA_API</code>.
          (نفس إعداد قاعدة البيانات في <code style={{ color: "var(--text)" }}>config/settings.json</code>.)
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--muted)",
            wordBreak: "break-all",
            direction: "ltr",
            unicodeBidi: "isolate",
            background: "rgba(0,0,0,0.28)",
            borderRadius: 8,
            padding: "0.45rem 0.6rem",
            fontFamily: "ui-monospace, monospace",
          }}
          title="عنوان تحميل الواجهة داخل الإطار"
        >
          {src}
        </div>
      </div>
      <iframe
        title="cashflow"
        src={src}
        style={{ flex: 1, width: "100%", minHeight: 0, border: "none", background: "#0b1020" }}
      />
    </div>
  );
}

