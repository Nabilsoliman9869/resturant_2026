import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type Row = { CardGuide: string; ProductName: string; Hieght3: number };

export default function KdsPrepTimesSettingsPage() {
  const base = getApiBase();
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/products`);
      const j = await r.json();
      const list: Row[] = Array.isArray(j.products)
        ? j.products.map((p: { CardGuide?: string; ProductName?: string; PrepMinutes?: number; Hieght3?: number }) => ({
            CardGuide: String(p.CardGuide || ""),
            ProductName: String(p.ProductName || ""),
            Hieght3: Number(p.PrepMinutes ?? p.Hieght3 ?? 0) || 0,
          }))
        : [];
      setRows(list.filter((x) => x.CardGuide));
    } catch (e) {
      setMsg(String(e));
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveOne(cardGuide: string, minutes: number) {
    setBusy(cardGuide);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/products/${encodeURIComponent(cardGuide)}/prep-minutes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PrepMinutes: minutes, Hieght3: minutes }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg("تم الحفظ.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>أزمنة التحضير لكل صنف</h2>
      <button type="button" className="btn btn-ghost" style={{ marginBottom: "0.75rem" }} onClick={() => void load()}>
        تحديث
      </button>
      <div className="card" style={{ overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "right", color: "var(--muted)" }}>
              <th style={{ padding: 8 }}>الصنف</th>
              <th style={{ padding: 8, width: 140 }}>دقائق</th>
              <th style={{ padding: 8, width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.CardGuide} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: 8 }}>{r.ProductName}</td>
                <td style={{ padding: 8 }}>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={r.Hieght3}
                    onChange={(e) => {
                      const n = Number(e.target.value) || 0;
                      setRows((prev) => prev.map((x) => (x.CardGuide === r.CardGuide ? { ...x, Hieght3: n } : x)));
                    }}
                    style={{ width: "100%" }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy === r.CardGuide}
                    onClick={() => void saveOne(r.CardGuide, r.Hieght3)}
                  >
                    {busy === r.CardGuide ? "…" : "حفظ"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg ? <p style={{ marginTop: 10, color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}
