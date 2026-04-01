import { useState } from "react";
import { getApiBase } from "../lib/apiBase";
const SUPPLIER_GROUP_GUID = "26CBD95C-98CB-48F3-8EEA-EE5D2B0D0500";

type Item = { CardGuide: string; Name: string };

export default function MasterDataPage() {
  const [products, setProducts] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");

  const [newProduct, setNewProduct] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentKind, setNewAgentKind] = useState<"customer" | "supplier">("customer");

  async function loadAll() {
    setMsg("");
    try {
      const [p, c, s] = await Promise.all([
        fetch(`${getApiBase()}/api/products`),
        fetch(`${getApiBase()}/api/agents`),
        fetch(`${getApiBase()}/api/agents?group_guide=${encodeURIComponent(SUPPLIER_GROUP_GUID)}`),
      ]);
      const pj = await p.json();
      const cj = await c.json();
      const sj = await s.json();
      setProducts((pj.products || []).map((x: { CardGuide: string; ProductName: string }) => ({ CardGuide: x.CardGuide, Name: x.ProductName })));
      setCustomers((cj.agents || []).map((x: { CardGuide: string; AgentName: string }) => ({ CardGuide: x.CardGuide, Name: x.AgentName })));
      setSuppliers((sj.agents || []).map((x: { CardGuide: string; AgentName: string }) => ({ CardGuide: x.CardGuide, Name: x.AgentName })));
      setMsg("تم تحميل التعريفات بنجاح.");
    } catch (e) {
      setMsg(`تعذر تحميل البيانات: ${String(e)}`);
    }
  }

  async function addProduct() {
    if (!newProduct.trim()) return;
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProductName: newProduct.trim() }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setNewProduct("");
      await loadAll();
    } catch (e) {
      setMsg(`فشل إضافة الصنف: ${String(e)}`);
    }
  }

  async function addAgent() {
    if (!newAgentName.trim()) return;
    setMsg("");
    try {
      const body: Record<string, unknown> = { AgentName: newAgentName.trim() };
      if (newAgentKind === "supplier") body.MainGroupGuide = SUPPLIER_GROUP_GUID;
      const r = await fetch(`${getApiBase()}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setNewAgentName("");
      await loadAll();
    } catch (e) {
      setMsg(`فشل إضافة العميل/المورد: ${String(e)}`);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>تعريفات الأصناف والعملاء والموردين</h2>
      <p style={{ color: "var(--muted)" }}>
        شاشة تشغيلية سريعة للمحاسب والمدير لتحديث التعريفات الأساسية من API مباشرة.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
          تحميل/تحديث التعريفات
        </button>
      </div>

      <div className="grid-2" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>إضافة صنف</h3>
          <input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="اسم الصنف" style={{ width: "100%", marginBottom: 8 }} />
          <button type="button" className="btn" onClick={() => void addProduct()}>
            حفظ الصنف
          </button>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>إضافة عميل/مورد</h3>
          <input
            value={newAgentName}
            onChange={(e) => setNewAgentName(e.target.value)}
            placeholder="اسم العميل أو المورد"
            style={{ width: "100%", marginBottom: 8 }}
          />
          <select value={newAgentKind} onChange={(e) => setNewAgentKind(e.target.value as "customer" | "supplier")} style={{ width: "100%", marginBottom: 8 }}>
            <option value="customer">عميل</option>
            <option value="supplier">مورد</option>
          </select>
          <button type="button" className="btn" onClick={() => void addAgent()}>
            حفظ
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>الأصناف</h3>
          <div style={{ maxHeight: 260, overflow: "auto", color: "var(--muted)" }}>
            {products.length === 0 ? "لا أصناف" : products.map((p) => <div key={p.CardGuide}>• {p.Name}</div>)}
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>العملاء</h3>
          <div style={{ maxHeight: 260, overflow: "auto", color: "var(--muted)" }}>
            {customers.length === 0 ? "لا عملاء" : customers.map((c) => <div key={c.CardGuide}>• {c.Name}</div>)}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>الموردون</h3>
        <div style={{ maxHeight: 260, overflow: "auto", color: "var(--muted)" }}>
          {suppliers.length === 0 ? "لا موردين" : suppliers.map((s) => <div key={s.CardGuide}>• {s.Name}</div>)}
        </div>
      </div>

      {msg && <p style={{ color: "var(--accent2)" }}>{msg}</p>}
    </div>
  );
}

