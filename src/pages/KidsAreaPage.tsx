import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";

type KPackage = { id: string; nameAr: string; pricePerHour: number };
type KSettings = { packages: KPackage[]; defaultPackageId?: string };

type SaleLine = {
  lineId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  productGuide?: string;
};

type KSession = {
  id: string;
  status: string;
  childName: string;
  fatherName: string;
  phone: string;
  packageId: string;
  companionsNote?: string;
  linkedTableSessionId?: string | null;
  entryAt: string;
  exitAt?: string | null;
  salesLines?: SaleLine[];
  areaFeeComputed?: number;
  hoursComputed?: number;
  salesTotal?: number;
  grandTotal?: number;
};

type TableSessionRow = {
  id: string;
  tableId?: string;
  status?: string;
  tableDisplayName?: string;
};

export default function KidsAreaPage() {
  const base = getApiBase();
  const [settings, setSettings] = useState<KSettings | null>(null);
  const [sessions, setSessions] = useState<KSession[]>([]);
  const [tableSessions, setTableSessions] = useState<TableSessionRow[]>([]);
  const [msg, setMsg] = useState("");

  const [childName, setChildName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [phone, setPhone] = useState("");
  const [packageId, setPackageId] = useState("");
  const [companionsNote, setCompanionsNote] = useState("");
  const [linkedTableSessionId, setLinkedTableSessionId] = useState("");

  const [saleSessionId, setSaleSessionId] = useState<string | null>(null);
  const [saleSearch, setSaleSearch] = useState("");
  const [saleHits, setSaleHits] = useState<Array<{ CardGuide: string; ProductName: string; Price?: number }>>([]);
  const [saleQty, setSaleQty] = useState(1);
  const [salePrice, setSalePrice] = useState(0);
  const [saleName, setSaleName] = useState("");
  const [saleProductGuide, setSaleProductGuide] = useState("");

  const [closeMode, setCloseMode] = useState<"cash" | "table">("cash");
  const [closeSessionId, setCloseSessionId] = useState<string | null>(null);
  const [closeTableSessionId, setCloseTableSessionId] = useState("");

  const loadAll = useCallback(async () => {
    setMsg("");
    try {
      const [s, sess, ts] = await Promise.all([
        fetch(`${base}/api/restaurant/kids-area/settings`),
        fetch(`${base}/api/restaurant/kids-area/sessions`),
        fetch(`${base}/api/restaurant/table-sessions?status=active&today_only=false`),
      ]);
      const sj = await s.json();
      const cj = await sess.json();
      const tj = await ts.json();
      setSettings(sj as KSettings);
      setPackageId((pid) => pid || (sj as KSettings).defaultPackageId || ((sj as KSettings).packages?.[0]?.id ?? ""));
      setSessions(Array.isArray(cj.sessions) ? cj.sessions : []);
      setTableSessions(Array.isArray(tj.sessions) ? tj.sessions : []);
    } catch (e) {
      setMsg(String(e));
    }
  }, [base]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const searchProducts = useCallback(async () => {
    const q = saleSearch.trim();
    if (!q) {
      setSaleHits([]);
      return;
    }
    try {
      const r = await fetch(`${base}/api/products/search?search_text=${encodeURIComponent(q)}`);
      const j = await r.json();
      const arr = Array.isArray(j.products) ? j.products : [];
      setSaleHits(
        arr.slice(0, 40).map((p: { CardGuide?: string; ProductName?: string; Price?: number; AgentPrice?: number }) => ({
          CardGuide: String(p.CardGuide || ""),
          ProductName: String(p.ProductName || ""),
          Price: Number(p.Price ?? p.AgentPrice ?? 0) || 0,
        })),
      );
    } catch {
      setSaleHits([]);
    }
  }, [base, saleSearch]);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/kids-area/sessions/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childName: childName.trim(),
          fatherName: fatherName.trim(),
          phone: phone.trim(),
          packageId: packageId || settings?.defaultPackageId,
          companionsNote: companionsNote.trim(),
          linkedTableSessionId: linkedTableSessionId || undefined,
        }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setChildName("");
      setFatherName("");
      setPhone("");
      setCompanionsNote("");
      setLinkedTableSessionId("");
      setMsg("تم تسجيل الدخول.");
      await loadAll();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function addSaleLine() {
    if (!saleSessionId || !saleName.trim()) return;
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/kids-area/sessions/${encodeURIComponent(saleSessionId)}/sale-line`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saleName.trim(),
          quantity: saleQty,
          unitPrice: salePrice,
          productGuide: saleProductGuide.trim(),
        }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setSaleSearch("");
      setSaleHits([]);
      setSaleName("");
      setSaleProductGuide("");
      setSaleQty(1);
      setSalePrice(0);
      setMsg("تمت إضافة بند البيع.");
      await loadAll();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function closeSession() {
    if (!closeSessionId) return;
    setMsg("");
    try {
      const body: Record<string, unknown> = { paymentMode: closeMode };
      if (closeMode === "table") {
        body.tableSessionId = closeTableSessionId || undefined;
      }
      const r = await fetch(`${base}/api/restaurant/kids-area/sessions/${encodeURIComponent(closeSessionId)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      const j = JSON.parse(t) as { message?: string };
      setMsg(j.message || "تم الإغلاق.");
      setCloseSessionId(null);
      setCloseTableSessionId("");
      await loadAll();
    } catch (e) {
      setMsg(String(e));
    }
  }

  const active = sessions.filter((x) => x.status === "active");
  const closed = sessions.filter((x) => x.status === "closed").slice(0, 25);

  return (
    <div className="page" style={{ direction: "rtl", maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>
        منطقة الأطفال (Kids Area)
      </h1>
      <p style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
        استقبال، باقات بالساعة، مبيعات للطفل، وإغلاق نقدي أو تحويل لطلب الطاولة.
      </p>

      {msg ? (
        <p style={{ color: msg.includes("تم") || msg.includes("تحويل") ? "var(--accent2)" : "var(--danger)" }}>{msg}</p>
      ) : null}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>تسجيل دخول</h3>
        <form onSubmit={submitEntry} style={{ display: "grid", gap: "0.75rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
            <label>
              اسم الطفل
              <input required value={childName} onChange={(e) => setChildName(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
            </label>
            <label>
              اسم الوالد
              <input required value={fatherName} onChange={(e) => setFatherName(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
            </label>
            <label>
              الهاتف
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
            </label>
            <label>
              الباقة (بالساعة)
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
                {(settings?.packages || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameAr} — {p.pricePerHour}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            مرافقون / ملاحظات (خادمة، أخ، أخت…)
            <input value={companionsNote} onChange={(e) => setCompanionsNote(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
          </label>
          <label>
            ربط مسبق بجلسة طاولة (اختياري)
            <select value={linkedTableSessionId} onChange={(e) => setLinkedTableSessionId(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
              <option value="">— بدون —</option>
              {tableSessions
                .filter((t) => str(t.status) === "active")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tableDisplayName || t.tableId || t.id}
                  </option>
                ))}
            </select>
          </label>
          <div>
            <button type="submit" className="btn btn-primary">
              تسجيل الدخول
            </button>
            <button type="button" className="btn btn-ghost" style={{ marginInlineStart: 8 }} onClick={() => void loadAll()}>
              تحديث
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>جلسات نشطة ({active.length})</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "right" }}>
                <th style={{ padding: 8 }}>الطفل</th>
                <th style={{ padding: 8 }}>الوالد</th>
                <th style={{ padding: 8 }}>هاتف</th>
                <th style={{ padding: 8 }}>دخول</th>
                <th style={{ padding: 8 }}>باقة</th>
                <th style={{ padding: 8 }}>مبيعات</th>
                <th style={{ padding: 8 }}></th>
              </tr>
            </thead>
            <tbody>
              {active.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: 8 }}>{s.childName}</td>
                  <td style={{ padding: 8 }}>{s.fatherName}</td>
                  <td style={{ padding: 8 }}>{s.phone}</td>
                  <td style={{ padding: 8 }}>{s.entryAt?.slice(11, 19) || "—"}</td>
                  <td style={{ padding: 8 }}>{s.packageId}</td>
                  <td style={{ padding: 8 }}>{(s.salesLines || []).length}</td>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-ghost" onClick={() => setSaleSessionId(s.id)}>
                      + بيع
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => setCloseSessionId(s.id)}>
                      إغلاق
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {saleSessionId ? (
        <div className="card" style={{ marginBottom: "1rem", border: "1px solid rgba(14,165,233,0.35)" }}>
          <h3 style={{ marginTop: 0 }}>بيع للطفل — جلسة</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 8 }}>
            <input placeholder="بحث صنف…" value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} style={{ minWidth: 200 }} />
            <button type="button" className="btn btn-ghost" onClick={() => void searchProducts()}>
              بحث
            </button>
          </div>
          {saleHits.length > 0 ? (
            <select
              style={{ width: "100%", marginBottom: 8 }}
              onChange={(e) => {
                const g = e.target.value;
                const p = saleHits.find((x) => x.CardGuide === g);
                if (p) {
                  setSaleName(p.ProductName);
                  setSalePrice(p.Price || 0);
                  setSaleProductGuide(p.CardGuide);
                }
              }}
            >
              <option value="">— اختر من نتائج البحث —</option>
              {saleHits.map((p) => (
                <option key={p.CardGuide} value={p.CardGuide}>
                  {p.ProductName} ({p.Price})
                </option>
              ))}
            </select>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            <label>
              الاسم
              <input value={saleName} onChange={(e) => setSaleName(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              كمية
              <input type="number" min={0.01} step="any" value={saleQty} onChange={(e) => setSaleQty(Number(e.target.value) || 1)} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>
              سعر الوحدة
              <input type="number" step="any" value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value) || 0)} style={{ width: "100%", marginTop: 4 }} />
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => void addSaleLine()}>
              إضافة للجلسة
            </button>
            <button type="button" className="btn btn-ghost" style={{ marginInlineStart: 8 }} onClick={() => setSaleSessionId(null)}>
              إلغاء
            </button>
          </div>
        </div>
      ) : null}

      {closeSessionId ? (
        <div className="card" style={{ marginBottom: "1rem", border: "1px solid rgba(52,211,153,0.35)" }}>
          <h3 style={{ marginTop: 0 }}>إغلاق جلسة</h3>
          <label style={{ display: "block", marginBottom: 8 }}>
            طريقة التسوية
            <select value={closeMode} onChange={(e) => setCloseMode(e.target.value as "cash" | "table")} style={{ width: "100%", marginTop: 6 }}>
              <option value="cash">نقدي / منفصل (لا يُدمج مع الطاولة)</option>
              <option value="table">تحويل لطلب الطاولة (دمج)</option>
            </select>
          </label>
          {closeMode === "table" ? (
            <label style={{ display: "block", marginBottom: 8 }}>
              جلسة الطاولة
              <select value={closeTableSessionId} onChange={(e) => setCloseTableSessionId(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
                <option value="">— اختر —</option>
                {tableSessions
                  .filter((t) => str(t.status) === "active")
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.tableDisplayName || t.tableId || t.id}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={() => void closeSession()}>
            تأكيد الإغلاق
          </button>
          <button type="button" className="btn btn-ghost" style={{ marginInlineStart: 8 }} onClick={() => setCloseSessionId(null)}>
            رجوع
          </button>
        </div>
      ) : null}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>آخر جلسات منتهية</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "right" }}>
                <th style={{ padding: 6 }}>الطفل</th>
                <th style={{ padding: 6 }}>خروج</th>
                <th style={{ padding: 6 }}>أجر المنطقة</th>
                <th style={{ padding: 6 }}>مبيعات</th>
                <th style={{ padding: 6 }}>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: 6 }}>{s.childName}</td>
                  <td style={{ padding: 6 }}>{s.exitAt?.slice(0, 16) || "—"}</td>
                  <td style={{ padding: 6 }}>{Number(s.areaFeeComputed || 0).toFixed(2)}</td>
                  <td style={{ padding: 6 }}>{Number(s.salesTotal || 0).toFixed(2)}</td>
                  <td style={{ padding: 6 }}>{Number(s.grandTotal || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function str(x: unknown): string {
  return String(x ?? "").toLowerCase();
}
