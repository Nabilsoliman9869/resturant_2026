import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type GroupRow = { CardGuide: string; GroupName: string; LatinName?: string };
type ProductRow = {
  productGuide: string;
  cardCode: string;
  productName: string;
  latinName: string;
  oldPrice: number;
  newPrice?: number;
};

export default function PriceListSettingsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupGuid, setGroupGuid] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [nameAr, setNameAr] = useState("قائمة الأسعار المعتمدة");
  const [nameEn, setNameEn] = useState("Approved Price List");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [decisionNo, setDecisionNo] = useState("");
  const [decisionDate, setDecisionDate] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [increasePercent, setIncreasePercent] = useState<number>(0);
  const [mode, setMode] = useState<"set" | "percent">("set");

  async function loadGroups() {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/costing/finished-groups`);
      const j = await r.json().catch(() => ({}));
      const gl: GroupRow[] = Array.isArray(j.groups) ? j.groups : [];
      setGroups(gl);
      if (!groupGuid && gl.length) setGroupGuid(gl[0].CardGuide);
    } catch (e) {
      setMsg(`تعذر تحميل المجموعات: ${String(e)}`);
    }
  }

  async function loadProducts(gg: string) {
    if (!gg) {
      setRows([]);
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/costing/finished-products?group_guid=${encodeURIComponent(gg)}`);
      const j = await r.json().catch(() => ({}));
      const p: ProductRow[] = Array.isArray(j.products) ? j.products : [];
      setRows(p.map((x) => ({ ...x, newPrice: x.oldPrice || 0 })));
    } catch (e) {
      setMsg(`تعذر تحميل الأصناف: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadProducts(groupGuid);
  }, [groupGuid]);

  const selectedGroup = useMemo(() => groups.find((g) => g.CardGuide === groupGuid) || null, [groups, groupGuid]);

  function applyPercentPreview() {
    const pct = Number(increasePercent || 0);
    setRows((prev) =>
      prev.map((r) => {
        if ((r.oldPrice || 0) <= 0) return r;
        const np = Number((r.oldPrice + r.oldPrice * (pct / 100)).toFixed(2));
        return { ...r, newPrice: np };
      }),
    );
  }

  async function applyPriceList() {
    if (!groupGuid) return;
    setMsg("");
    try {
      const payload = {
        nameAr,
        nameEn,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        decisionNo: decisionNo || null,
        decisionDate: decisionDate || null,
        decisionText: decisionText || null,
        increasePercent: Number(increasePercent || 0),
        groupGuid,
        items: rows.map((r) => ({
          productGuide: r.productGuide,
          oldPrice: Number(r.oldPrice || 0),
          newPrice: Number(r.newPrice || 0),
          mode,
        })),
      };
      const resp = await fetch(`${getApiBase()}/api/costing/price-lists/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const txt = await resp.text();
      if (!resp.ok) throw new Error(txt || `HTTP ${resp.status}`);
      const j = JSON.parse(txt || "{}");
      setMsg(`تم اعتماد قائمة الأسعار. تم تحديث ${j.updated ?? 0} صنف، وتخطي ${j.skippedZero ?? 0} صنف بسعر سابق صفر.`);
      await loadProducts(groupGuid);
    } catch (e) {
      setMsg(`فشل اعتماد الأسعار: ${String(e)}`);
    }
  }

  return (
    <div className="page" style={{ direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>إعدادات التكاليف - قائمة الأسعار</h2>
      <p style={{ color: "var(--muted)" }}>
        تحديث <strong>سعر المستهلك</strong> للمنتجات التامة حسب المجموعة. عند الزيادة النسبية، الأصناف ذات السعر السابق صفر يتم تخطيها تلقائياً.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            الاسم العربي
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            الاسم الإنجليزي
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            من تاريخ
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            إلى تاريخ
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            قرار الإدارة رقم
            <input value={decisionNo} onChange={(e) => setDecisionNo(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            صادر بتاريخ
            <input type="date" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
            نص القرار والزيادة
            <textarea rows={2} value={decisionText} onChange={(e) => setDecisionText(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 180px 200px auto auto", gap: 8, alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            المجموعة
            <select value={groupGuid} onChange={(e) => setGroupGuid(e.target.value)}>
              <option value="">— اختر المجموعة —</option>
              {groups.map((g) => (
                <option key={g.CardGuide} value={g.CardGuide}>
                  {g.GroupName}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            نمط التحديث
            <select value={mode} onChange={(e) => setMode(e.target.value as "set" | "percent")}>
              <option value="set">سعر جديد مباشر</option>
              <option value="percent">نسبة زيادة</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            نسبة الزيادة (%)
            <input type="number" step="any" value={increasePercent} onChange={(e) => setIncreasePercent(Number(e.target.value || 0))} />
          </label>
          <button type="button" className="btn btn-ghost" onClick={applyPercentPreview}>
            تطبيق الزيادة على العرض
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void applyPriceList()}>
            اعتماد وتحديث الأسعار
          </button>
        </div>
        {selectedGroup && (
          <div style={{ marginTop: 8, color: "var(--muted)" }}>
            المجموعة المختارة: {selectedGroup.GroupName}
            {selectedGroup.LatinName ? ` / ${selectedGroup.LatinName}` : ""}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                <th style={{ padding: "6px 8px" }}>الكود</th>
                <th style={{ padding: "6px 8px" }}>الصنف</th>
                <th style={{ padding: "6px 8px" }}>السعر الحالي (المستهلك)</th>
                <th style={{ padding: "6px 8px" }}>السعر الجديد</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productGuide} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <td style={{ padding: "6px 8px" }}>{r.cardCode || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{r.productName}</td>
                  <td style={{ padding: "6px 8px" }}>{Number(r.oldPrice || 0).toFixed(2)}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <input
                      type="number"
                      step="any"
                      value={Number(r.newPrice || 0)}
                      disabled={mode === "percent"}
                      onChange={(e) =>
                        setRows((prev) => prev.map((x) => (x.productGuide === r.productGuide ? { ...x, newPrice: Number(e.target.value || 0) } : x)))
                      }
                      style={{ width: 140 }}
                    />
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} style={{ padding: "10px", color: "var(--muted)", textAlign: "center" }}>
                    {loading ? "جاري التحميل..." : "لا توجد أصناف في هذه المجموعة"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {msg ? <div style={{ marginTop: "0.75rem", color: msg.startsWith("فشل") ? "#ef4444" : "#22c55e" }}>{msg}</div> : null}
    </div>
  );
}

