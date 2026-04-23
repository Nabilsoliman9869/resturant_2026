import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";

const SUPPLIER_GROUP_GUID = "26CBD95C-98CB-48F3-8EEA-EE5D2B0D0500";

type Item = { CardGuide: string; Name: string };
type GroupOpt = { CardGuide: string; GroupName: string };

export default function MasterDataPage() {
  const base = getApiBase();
  const [products, setProducts] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Item[]>([]);
  const [productGroups, setProductGroups] = useState<GroupOpt[]>([]);
  const [agentGroups, setAgentGroups] = useState<GroupOpt[]>([]);
  const [msg, setMsg] = useState("");

  const [newProduct, setNewProduct] = useState("");
  const [productGroupGuid, setProductGroupGuid] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentKind, setNewAgentKind] = useState<"customer" | "supplier">("customer");
  const [customerGroupGuid, setCustomerGroupGuid] = useState("");

  const loadGroups = useCallback(async () => {
    const [pg, ag] = await Promise.all([
      fetch(`${base}/api/product-groups`),
      fetch(`${base}/api/agent-groups`),
    ]);
    const pj = await pg.json();
    const aj = await ag.json();
    const pgs: GroupOpt[] = (pj.groups || []).map((x: { CardGuide: string; GroupName: string }) => ({
      CardGuide: String(x.CardGuide),
      GroupName: String(x.GroupName || ""),
    }));
    const ags: GroupOpt[] = (aj.groups || []).map((x: { CardGuide: string; GroupName: string }) => ({
      CardGuide: String(x.CardGuide),
      GroupName: String(x.GroupName || ""),
    }));
    setProductGroups(pgs);
    setAgentGroups(ags);
    setProductGroupGuid((g) => g || (pgs[0]?.CardGuide ?? ""));
    setCustomerGroupGuid((g) => g || (ags[0]?.CardGuide ?? ""));
  }, [base]);

  const loadAll = useCallback(async () => {
    setMsg("");
    try {
      await loadGroups();
      const [p, c, s] = await Promise.all([
        fetch(`${base}/api/products`),
        fetch(`${base}/api/agents`),
        fetch(`${base}/api/agents?group_guide=${encodeURIComponent(SUPPLIER_GROUP_GUID)}`),
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
  }, [base, loadGroups]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  async function addProduct() {
    if (!newProduct.trim()) return;
    if (!productGroupGuid) {
      setMsg("اختر مجموعة الصنف من TBL006.");
      return;
    }
    setMsg("");
    try {
      const r = await fetch(`${base}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProductName: newProduct.trim(), GroupGuid: productGroupGuid }),
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
    const mg =
      newAgentKind === "supplier" ? SUPPLIER_GROUP_GUID : customerGroupGuid || "";
    if (!mg) {
      setMsg("اختر مجموعة العميل من TBL015.");
      return;
    }
    setMsg("");
    try {
      const body: Record<string, unknown> = { AgentName: newAgentName.trim(), MainGroupGuide: mg, group_guide: mg };
      const r = await fetch(`${base}/api/agents`, {
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

      <div className="card" style={{ marginBottom: "1rem" }}>
        <button type="button" className="btn btn-primary" onClick={() => void loadAll()}>
          تحميل/تحديث التعريفات
        </button>
      </div>

      <div className="grid-2" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>إضافة صنف</h3>
          <label style={{ display: "block", marginBottom: 8 }}>
            مجموعة الصنف (TBL006)
            <select
              value={productGroupGuid}
              onChange={(e) => setProductGroupGuid(e.target.value)}
              style={{ width: "100%", marginTop: 6 }}
            >
              {productGroups.length === 0 ? <option value="">— لا توجد مجموعات —</option> : null}
              {productGroups.map((g) => (
                <option key={g.CardGuide} value={g.CardGuide}>
                  {g.GroupName}
                </option>
              ))}
            </select>
          </label>
          <input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="اسم الصنف" style={{ width: "100%", marginBottom: 8 }} />
          <button type="button" className="btn" onClick={() => void addProduct()}>
            حفظ الصنف
          </button>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>إضافة عميل/مورد</h3>
          <label style={{ display: "block", marginBottom: 8 }}>
            نوع
            <select
              value={newAgentKind}
              onChange={(e) => setNewAgentKind(e.target.value as "customer" | "supplier")}
              style={{ width: "100%", marginTop: 6 }}
            >
              <option value="customer">عميل</option>
              <option value="supplier">مورد</option>
            </select>
          </label>
          {newAgentKind === "customer" ? (
            <label style={{ display: "block", marginBottom: 8 }}>
              مجموعة العميل (TBL015)
              <select
                value={customerGroupGuid}
                onChange={(e) => setCustomerGroupGuid(e.target.value)}
                style={{ width: "100%", marginTop: 6 }}
              >
                {agentGroups.length === 0 ? <option value="">— لا توجد مجموعات —</option> : null}
                {agentGroups.map((g) => (
                  <option key={g.CardGuide} value={g.CardGuide}>
                    {g.GroupName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: 8 }}>المورد يُسجَّل تحت مجموعة الموردين الثابتة في النظام.</p>
          )}
          <input
            value={newAgentName}
            onChange={(e) => setNewAgentName(e.target.value)}
            placeholder="اسم العميل أو المورد"
            style={{ width: "100%", marginBottom: 8 }}
          />
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
