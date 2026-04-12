import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";

type AlertRow = {
  id: string;
  type?: string;
  title?: string;
  body?: string | null;
  tableId?: string | null;
  sessionId?: string | null;
  orderId?: string | null;
  createdAt?: string;
};

const POLL_MS = 30000;

export function CashierAlertsBar() {
  const base = getApiBase();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/alerts`);
      const txt = await r.text();
      const j = tryParseJson<{ alerts?: AlertRow[] }>(txt) ?? {};
      if (r.ok) setRows(Array.isArray(j.alerts) ? j.alerts : []);
    } catch {
      /* صامت — لا نُعطّل الشاشة */
    }
  }, [base]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const dismiss = async (id: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/alerts/${encodeURIComponent(id)}/dismiss`, { method: "PATCH" });
      if (r.ok) await load();
    } finally {
      setBusyId(null);
    }
  };

  const n = rows.length;
  if (n === 0) return null;

  return (
    <div
      style={{
        marginBottom: "1rem",
        borderRadius: 10,
        border: "1px solid rgba(239, 68, 68, 0.35)",
        background: "rgba(239, 68, 68, 0.07)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "right",
          padding: "0.5rem 0.85rem",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontWeight: 800,
          fontSize: "0.88rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>
          تنبيهات الكاشير <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>({n})</span>
        </span>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{open ? "▼" : "◀"}</span>
      </button>
      {open ? (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 0.75rem 0.65rem", maxHeight: 220, overflowY: "auto" }}>
          {rows.map((a) => (
            <li
              key={a.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-start",
                gap: 8,
                padding: "0.45rem 0",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                fontSize: "0.82rem",
              }}
            >
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{a.title || a.type || "تنبيه"}</div>
                {a.body ? <div style={{ color: "var(--muted)", marginTop: 2 }}>{a.body}</div> : null}
                <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4 }}>
                  {(a.createdAt || "").replace("T", " ").slice(0, 19)}
                  {a.tableId ? ` · طاولة ${String(a.tableId).slice(0, 8)}` : ""}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: "0.72rem", padding: "4px 8px", flexShrink: 0 }}
                disabled={busyId === a.id}
                onClick={() => void dismiss(a.id)}
              >
                {busyId === a.id ? "…" : "تجاهل"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
