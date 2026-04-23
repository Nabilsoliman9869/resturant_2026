import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type Product = { CardGuide: string; ProductName: string; GroupGuid?: string; Price?: number };
type Group = { CardGuide: string; GroupName: string };
type StopItem = { productGuide: string; stopped?: boolean; note?: string };

export default function KitchenItemStopPage() {
  const base = getApiBase();
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [stopMap, setStopMap] = useState<Map<string, string>>(() => new Map());
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");

  async function loadAll() {
    setMsg("");
    try {
      const [pr, gr, sr] = await Promise.all([
        fetch(`${base}/api/products`),
        fetch(`${base}/api/product-groups`),
        fetch(`${base}/api/restaurant/kitchen/item-stops?active_only=true`),
      ]);
      const pj = await pr.json().catch(() => ({}));
      const gj = await gr.json().catch(() => ({}));
      const sj = await sr.json().catch(() => ({}));
      const plist: Product[] = Array.isArray(pj.products) ? pj.products : [];
      const glist: Group[] = Array.isArray(gj.groups) ? gj.groups : [];
      const slist: StopItem[] = Array.isArray(sj.items) ? sj.items : [];
      const sm = new Map<string, string>();
      for (const s of slist) if (s?.productGuide && s.stopped) sm.set(String(s.productGuide), String(s.note || ""));
      setProducts(plist);
      setGroups(glist);
      setStopMap(sm);
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useMemo(() => {
    let arr = products;
    if (group !== "all") arr = arr.filter((p) => String(p.GroupGuid || "") === group);
    const qq = q.trim().toLowerCase();
    if (qq) arr = arr.filter((p) => String(p.ProductName || "").toLowerCase().includes(qq));
    return arr;
  }, [products, group, q]);

  async function toggle(p: Product, stopped: boolean) {
    try {
      const note = stopped ? prompt(`سبب الإيقاف للصنف: ${p.ProductName}`, "نفد من المطبخ") || "نفد من المطبخ" : "";
      const r = await fetch(`${base}/api/restaurant/kitchen/item-stops/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productGuide: p.CardGuide, productName: p.ProductName, stopped, note, byUser: "kitchen" }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
      setStopMap((prev) => {
        const n = new Map(prev);
        if (stopped) n.set(p.CardGuide, note || ""); else n.delete(p.CardGuide);
        return n;
      });
      setMsg(stopped ? `تم إيقاف الصنف: ${p.ProductName}` : `تم إعادة فتح الصنف: ${p.ProductName}`);
    } catch (e) {
      setMsg(`فشل تحديث حالة الصنف: ${String(e)}`);
    }
  }

  return (
    <div className="page" style={{ direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>إعدادات المطبخ - إيقاف الأصناف (وقتي)</h2>
      <div className="card" style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          المجموعة
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">الكل</option>
            {groups.map((g) => <option key={g.CardGuide} value={g.CardGuide}>{g.GroupName}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          بحث
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الصنف" />
        </label>
        <button className="btn btn-ghost" onClick={() => void loadAll()}>تحديث</button>
      </div>
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={{ padding: 6 }}>الصنف</th>
              <th style={{ padding: 6 }}>الحالة</th>
              <th style={{ padding: 6 }}>الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {view.map((p) => {
              const stopped = stopMap.has(p.CardGuide);
              return (
                <tr key={p.CardGuide} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <td style={{ padding: 6 }}>{p.ProductName}</td>
                  <td style={{ padding: 6, color: stopped ? "#ef4444" : "#22c55e", fontWeight: 800 }}>{stopped ? "موقوف" : "متاح"}</td>
                  <td style={{ padding: 6 }}>
                    {stopped ? (
                      <button className="btn btn-ghost" onClick={() => void toggle(p, false)}>إعادة فتح</button>
                    ) : (
                      <button className="btn btn-primary" onClick={() => void toggle(p, true)}>إيقاف</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {msg ? <div style={{ marginTop: 10, color: msg.startsWith("فشل") || msg.startsWith("تعذر") ? "#ef4444" : "#22c55e" }}>{msg}</div> : null}
    </div>
  );
}

