import { getApiBase } from "../lib/apiBase";

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
        }}
      >
        <div style={{ fontWeight: 700 }}>التدفق النقدي</div>
      </div>
      <iframe
        title="cashflow"
        src={src}
        style={{ flex: 1, width: "100%", minHeight: 0, border: "none", background: "#0b1020" }}
      />
    </div>
  );
}

