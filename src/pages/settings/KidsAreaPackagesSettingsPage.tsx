import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import { safeFetch } from "../../lib/safeFetch";

type KItem = {
  productGuide: string;
  name: string;
  price: number;
  isKitchen: boolean;
  minutes: number;
};

type KPackage = {
  packageGuide: string;
  packageName: string;
  latinName: string;
  items: KItem[];
  totalPrice: number;
  durationMinutes: number;
};

const fmt = (n: number) => Number(n || 0).toFixed(2);

const STYLES = `
.kspkgs { padding:14px; direction:rtl; color: var(--text); }
.kspkgs__hdr { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:14px;
  padding:14px; border-radius:12px;
  background: linear-gradient(135deg, rgba(167,139,250,0.18), rgba(34,211,238,0.10));
  border:1px solid var(--border); }
.kspkgs__hdr h2 { margin:0; font-family: var(--display); font-size:1.2rem; }
.kspkgs__hdr p { margin:2px 0 0; color: var(--muted); font-size:13px; }

.kspkgs__alert { padding:10px 14px; border-radius:10px; margin-bottom:12px; border:1px solid var(--border); font-weight:600; }
.kspkgs__alert--ok  { background:rgba(52,211,153,0.12); color:var(--ok); border-color:rgba(52,211,153,0.25); }
.kspkgs__alert--err { background:rgba(251,113,133,0.14); color:var(--danger); border-color:rgba(251,113,133,0.30); }

.kspkgs__newcard { background: var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; margin-bottom:14px; }
.kspkgs__newcard h3 { margin:0 0 10px; font-size:1.05rem; color: var(--accent2); }
.kspkgs__row { display:grid; grid-template-columns: 2fr 1fr 1fr 80px; gap:10px; align-items:end; }
.kspkgs__row.head { color: var(--muted); font-size:12px; font-weight:700; }
.kspkgs__field label { display:block; font-size:12px; color: var(--muted); margin-bottom:4px; }
.kspkgs__field input { width:100%; padding:8px 10px; }
.kspkgs__check { display:flex; align-items:center; gap:6px; font-size:12px; }
.kspkgs__items-grid { display:grid; gap:8px; margin-top:10px; }

.kspkgs__list { display:grid; gap:14px; }
.kspkgs__pkg { background: var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; }
.kspkgs__pkg-h { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:10px; }
.kspkgs__pkg-h h4 { margin:0; font-size:1.05rem; color: var(--accent); }
.kspkgs__pkg-meta { font-size:12px; color: var(--muted); }

.kspkgs__items table { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
.kspkgs__items th, .kspkgs__items td { padding:8px 10px; border-bottom:1px solid var(--border); }
.kspkgs__items th { background: rgba(255,255,255,0.04); color: var(--muted); font-weight:700; text-align:right; }
.kspkgs__items td.num { text-align:left; font-variant-numeric: tabular-nums; }

.kspkgs__btn-row { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; margin-top:10px; }
`;

export default function KidsAreaPackagesSettingsPage() {
  const base = getApiBase();
  const [packages, setPackages] = useState<KPackage[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // نموذج الإنشاء (باقة جديدة)
  const [newName, setNewName] = useState("");
  const [newLatin, setNewLatin] = useState("");
  const [newItems, setNewItems] = useState<{ name: string; price: string; minutes: string; kitchen: boolean }[]>([
    { name: "ساعة كيدز ايريا", price: "100", minutes: "60", kitchen: false },
  ]);

  const showMsg = (type: "ok" | "err", text: string, ms = 4500) => {
    setMsg({ type, text });
    if (ms > 0) window.setTimeout(() => setMsg((cur) => (cur && cur.text === text ? null : cur)), ms);
  };

  const load = useCallback(async () => {
    try {
      const r = await safeFetch(`${base}/api/kids/packages?bootstrap=true`);
      if (!r.ok) {
        showMsg("err", `تعذّر تحميل الباقات (${r.status})`);
        return;
      }
      const j = await r.json();
      setPackages(Array.isArray(j?.packages) ? j.packages : []);
    } catch (e) {
      showMsg("err", `فشل: ${String((e as Error)?.message || e)}`);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const submitNewPkg = async () => {
    if (!newName.trim()) return showMsg("err", "اسم الباقة مطلوب");
    const items = newItems
      .filter((x) => x.name.trim())
      .map((x) => ({
        name: x.name.trim(),
        price: Number(x.price) || 0,
        minutes: Number(x.minutes) || 0,
        kitchen: !!x.kitchen,
      }));
    if (items.length === 0) return showMsg("err", "أضف بنداً واحداً على الأقل");
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/packages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), latinName: newLatin.trim() || newName.trim(), items }),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string; packageGuide?: string };
      if (!r.ok) return showMsg("err", j?.detail || `فشل (${r.status})`);
      showMsg("ok", "أُنشئت الباقة بنجاح");
      setNewName(""); setNewLatin(""); setNewItems([{ name: "", price: "", minutes: "", kitchen: false }]);
      await load();
    } finally { setBusy(false); }
  };

  const deletePkg = async (p: KPackage) => {
    if (!window.confirm(`حذف الباقة «${p.packageName}»؟ سيتم إخفاء بنودها (لن تُحذف الفواتير القديمة).`)) return;
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/packages/${p.packageGuide}`, { method: "DELETE" });
      if (!r.ok) return showMsg("err", `فشل الحذف (${r.status})`);
      showMsg("ok", "تم حذف الباقة");
      await load();
    } finally { setBusy(false); }
  };

  const renamePkg = async (p: KPackage) => {
    const name = window.prompt("الاسم الجديد:", p.packageName);
    if (name === null || !name.trim()) return;
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/packages/${p.packageGuide}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) return showMsg("err", `فشل (${r.status})`);
      showMsg("ok", "تم التعديل");
      await load();
    } finally { setBusy(false); }
  };

  const addItem = async (p: KPackage) => {
    const name = window.prompt("اسم البند:", "");
    if (!name || !name.trim()) return;
    const price = Number(window.prompt("السعر:", "50") || 0);
    const minutes = Number(window.prompt("المدة بالدقائق (0 إن لم يكن بند مدة):", "0") || 0);
    const kitchen = window.confirm("هل هذا البند يُرسَل للمطبخ؟ (نعم=وجبة/مشروب، لا=مدة)");
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/packages/${p.packageGuide}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), price, minutes, kitchen }),
      });
      if (!r.ok) return showMsg("err", `فشل (${r.status})`);
      showMsg("ok", "أُضيف البند");
      await load();
    } finally { setBusy(false); }
  };

  const editItem = async (it: KItem) => {
    const name = window.prompt("الاسم:", it.name) ?? it.name;
    const price = Number(window.prompt("السعر:", String(it.price)) ?? it.price);
    const minutes = Number(window.prompt("المدة بالدقائق:", String(it.minutes)) ?? it.minutes);
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/packages/items/${it.productGuide}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price, minutes }),
      });
      if (!r.ok) return showMsg("err", `فشل (${r.status})`);
      showMsg("ok", "تم التعديل");
      await load();
    } finally { setBusy(false); }
  };

  const removeItem = async (it: KItem) => {
    if (!window.confirm(`إخفاء البند «${it.name}»؟`)) return;
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/packages/items/${it.productGuide}`, { method: "DELETE" });
      if (!r.ok) return showMsg("err", `فشل (${r.status})`);
      showMsg("ok", "أُخفي البند");
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="kspkgs">
      <style>{STYLES}</style>

      <header className="kspkgs__hdr">
        <div>
          <h2>إعدادات باقات منطقة الأطفال</h2>
          <p>كل باقة = مجموعة فرعية في TBL006 + بنودها في TBL007. الـHieght3 = مدة بند الوقت بالدقائق، Custom5="55555" = بند يُرسَل للمطبخ.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={busy}>تحديث</button>
      </header>

      {msg ? <div className={`kspkgs__alert kspkgs__alert--${msg.type}`}>{msg.text}</div> : null}

      {/* —— باقة جديدة —— */}
      <div className="kspkgs__newcard">
        <h3>＋ باقة جديدة</h3>
        <div className="kspkgs__row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="kspkgs__field">
            <label>اسم الباقة بالعربية</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="مثال: باقة 60 دقيقة" />
          </div>
          <div className="kspkgs__field">
            <label>الاسم اللاتيني (اختياري)</label>
            <input value={newLatin} onChange={(e) => setNewLatin(e.target.value)} placeholder="Pkg 60min" />
          </div>
        </div>

        <h4 style={{ margin: "12px 0 6px", fontSize: 13, color: "var(--muted)" }}>البنود</h4>
        <div className="kspkgs__row head">
          <div>الاسم</div>
          <div>السعر</div>
          <div>الدقائق</div>
          <div>مطبخ؟</div>
        </div>
        <div className="kspkgs__items-grid">
          {newItems.map((it, idx) => (
            <div key={idx} className="kspkgs__row">
              <input
                value={it.name}
                onChange={(e) => setNewItems((p) => p.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))}
                placeholder="مثلاً: ساعة كيدز / بيتزا / عصير"
              />
              <input
                inputMode="decimal" value={it.price}
                onChange={(e) => setNewItems((p) => p.map((x, j) => (j === idx ? { ...x, price: e.target.value } : x)))}
              />
              <input
                inputMode="numeric" value={it.minutes}
                onChange={(e) => setNewItems((p) => p.map((x, j) => (j === idx ? { ...x, minutes: e.target.value } : x)))}
              />
              <label className="kspkgs__check">
                <input
                  type="checkbox" checked={it.kitchen}
                  onChange={(e) => setNewItems((p) => p.map((x, j) => (j === idx ? { ...x, kitchen: e.target.checked } : x)))}
                />
                مطبخ
              </label>
            </div>
          ))}
        </div>
        <div className="kspkgs__btn-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setNewItems((p) => [...p, { name: "", price: "", minutes: "", kitchen: false }])}
          >＋ بند آخر</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submitNewPkg()}
            disabled={busy || !newName.trim()}
          >
            {busy ? "جارٍ…" : "حفظ الباقة"}
          </button>
        </div>
      </div>

      {/* —— الباقات الحالية —— */}
      <div className="kspkgs__list">
        {packages.length === 0 ? (
          <div className="kspkgs__newcard" style={{ textAlign: "center", color: "var(--muted)" }}>
            لا توجد باقات بعد.
          </div>
        ) : null}
        {packages.map((p) => (
          <div key={p.packageGuide} className="kspkgs__pkg">
            <div className="kspkgs__pkg-h">
              <div>
                <h4>{p.packageName}</h4>
                <div className="kspkgs__pkg-meta">
                  {p.latinName} · مدّة: {p.durationMinutes} د · إجمالي: {fmt(p.totalPrice)} ج.م
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-ghost" onClick={() => void renamePkg(p)} disabled={busy}>تسمية</button>
                <button type="button" className="btn btn-ghost" onClick={() => void addItem(p)} disabled={busy}>＋ بند</button>
                <button type="button" className="btn btn-secondary" onClick={() => void deletePkg(p)} disabled={busy}>حذف</button>
              </div>
            </div>
            <div className="kspkgs__items">
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th style={{ textAlign: "left" }}>السعر</th>
                    <th style={{ textAlign: "center" }}>دقائق</th>
                    <th style={{ textAlign: "center" }}>مطبخ</th>
                    <th style={{ textAlign: "center" }}>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {p.items.map((it) => (
                    <tr key={it.productGuide}>
                      <td>{it.name}</td>
                      <td className="num">{fmt(it.price)}</td>
                      <td className="num" style={{ textAlign: "center" }}>{it.minutes || "—"}</td>
                      <td style={{ textAlign: "center" }}>{it.isKitchen ? "🍽" : "—"}</td>
                      <td style={{ textAlign: "center" }}>
                        <button type="button" className="btn btn-ghost" onClick={() => void editItem(it)} disabled={busy}>تعديل</button>{" "}
                        <button type="button" className="btn btn-secondary" onClick={() => void removeItem(it)} disabled={busy}>إخفاء</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
