import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getApiBase } from "../../lib/apiBase";
import { tryParseJson } from "../../lib/tryParseJson";

type Zone = {
  CardGuide: string;
  ProductName: string;
  Price: number;
  CardCode?: string;
  NotTaxable?: boolean;
  GroupGuid?: string;
};

/**
 * تعريف مناطق الدليفري والشحن وأسعارها — أصناف TBL007 تحت مجموعة خدمات الشحن.
 * افتراضي: بدون ضريبة قيمة مضافة (NotTaxable)، مع خيار لتطبيق الضريبة.
 */
export default function DeliveryShippingZonesSettingsPage() {
  const base = getApiBase();
  const [params, setParams] = useSearchParams();
  const [zones, setZones] = useState<Zone[]>([]);
  const [groupName, setGroupName] = useState("خدمات الشحن");
  const [groupGuide, setGroupGuide] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [filter, setFilter] = useState("");

  const [name, setName] = useState("");
  const [price, setPrice] = useState("100");
  const [applyTax, setApplyTax] = useState(false);
  const [editGuid, setEditGuid] = useState<string | null>(null);

  const prefill = String(params.get("prefill") || params.get("zone") || "").trim();

  const showMsg = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    window.setTimeout(() => setMsg((c) => (c && c.text === text ? null : c)), 4500);
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/delivery/shipping-services?ensure_group=true`, {
        cache: "no-store",
      });
      const j =
        tryParseJson<{
          services?: Zone[];
          groupName?: string;
          groupGuide?: string;
          hint?: string;
          detail?: string;
        }>(await r.text()) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "تعذر التحميل");
      setZones(Array.isArray(j.services) ? j.services : []);
      if (j.groupName) setGroupName(String(j.groupName));
      if (j.groupGuide) setGroupGuide(String(j.groupGuide));
      setHint(j.hint || null);
    } catch (e) {
      showMsg("err", String(e));
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!prefill) return;
    setName(prefill.startsWith("شحن") || prefill.includes("شحن") ? prefill : `خدمات شحن ${prefill}`);
    setEditGuid(null);
    // مسح prefill من الرابط بعد التعبئة
    const next = new URLSearchParams(params);
    next.delete("prefill");
    next.delete("zone");
    setParams(next, { replace: true });
  }, [prefill, params, setParams]);

  const filtered = useMemo(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return zones;
    return zones.filter(
      (z) =>
        z.ProductName.toLowerCase().includes(t) ||
        String(z.CardCode || "")
          .toLowerCase()
          .includes(t),
    );
  }, [zones, filter]);

  function startEdit(z: Zone) {
    setEditGuid(z.CardGuide);
    setName(z.ProductName);
    setPrice(String(z.Price ?? 0));
    setApplyTax(z.NotTaxable === false);
  }

  function resetForm() {
    setEditGuid(null);
    setName("");
    setPrice("100");
    setApplyTax(false);
  }

  async function save() {
    const nm = name.trim();
    if (!nm) {
      showMsg("err", "اسم المنطقة مطلوب");
      return;
    }
    const pr = Number(price);
    if (!Number.isFinite(pr) || pr < 0) {
      showMsg("err", "السعر غير صالح");
      return;
    }
    setBusy(true);
    try {
      if (editGuid) {
        const r = await fetch(`${base}/api/restaurant/delivery/shipping-zones/${encodeURIComponent(editGuid)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ProductName: nm,
            Price: pr,
            applyTax,
          }),
        });
        const t = await r.text();
        const j = tryParseJson<{ detail?: string }>(t) ?? {};
        if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t);
        showMsg("ok", "تم تحديث المنطقة");
      } else {
        const r = await fetch(`${base}/api/restaurant/delivery/shipping-zones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ProductName: nm,
            Price: pr,
            applyTax,
          }),
        });
        const t = await r.text();
        const j = tryParseJson<{ detail?: string; created?: boolean; CardCode?: string; hint?: string }>(t) ?? {};
        if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t);
        showMsg(
          "ok",
          j.created === false
            ? j.hint || "المنطقة موجودة مسبقاً"
            : `تم إضافة المنطقة${j.CardCode ? ` · كود ${j.CardCode}` : ""}`,
        );
      }
      resetForm();
      await load();
    } catch (e) {
      showMsg("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(z: Zone) {
    if (!window.confirm(`إيقاف المنطقة «${z.ProductName}»؟`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/delivery/shipping-zones/${encodeURIComponent(z.CardGuide)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ NotActive: true }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      showMsg("ok", "تم إيقاف المنطقة");
      await load();
    } catch (e) {
      showMsg("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shipzones" dir="rtl">
      <style>{STYLES}</style>
      <header className="shipzones__hdr">
        <div>
          <h2>تعريف مناطق الدليفري والشحن وأسعارها</h2>
          <p>
            أصناف في TBL007 ضمن مجموعة «{groupName}»
            {groupGuide ? ` · ${groupGuide.slice(0, 8)}…` : ""} — الترقيم تلقائي (آخر CardCode + 1). الشحن بدون ضريبة
            افتراضياً.
          </p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => void load()}>
          تحديث
        </button>
      </header>

      {msg ? <div className={`shipzones__alert shipzones__alert--${msg.type}`}>{msg.text}</div> : null}
      {hint ? <div className="shipzones__hint">{hint}</div> : null}

      <section className="shipzones__form">
        <h3>{editGuid ? "تعديل منطقة" : "إضافة منطقة شحن"}</h3>
        <div className="shipzones__grid">
          <label>
            اسم المنطقة *
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: خدمات شحن للمقطم"
              autoFocus
            />
          </label>
          <label>
            سعر الشحن (سعر البيع)
            <input type="number" min={0} step={0.5} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="shipzones__check">
            <input type="checkbox" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} />
            تطبيق ضريبة قيمة مضافة على هذه المنطقة
          </label>
        </div>
        <div className="shipzones__actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {editGuid ? "حفظ التعديل" : "إضافة للمنطقة"}
          </button>
          {editGuid ? (
            <button type="button" className="btn" disabled={busy} onClick={resetForm}>
              إلغاء التعديل
            </button>
          ) : null}
        </div>
      </section>

      <section className="shipzones__list-wrap">
        <div className="shipzones__list-top">
          <h3>المناطق المعرّفة ({filtered.length})</h3>
          <input
            className="shipzones__filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="تصفية بالاسم أو الكود…"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="shipzones__empty">لا مناطق بعد — أضف أول منطقة أعلاه (مثل: خدمات شحن للمقطم بسعر 100).</p>
        ) : (
          <table className="shipzones__table">
            <thead>
              <tr>
                <th>الكود</th>
                <th>المنطقة</th>
                <th>السعر</th>
                <th>الضريبة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((z) => (
                <tr key={z.CardGuide}>
                  <td className="num">{z.CardCode || "—"}</td>
                  <td>{z.ProductName}</td>
                  <td className="num">{Number(z.Price || 0).toFixed(2)}</td>
                  <td>{z.NotTaxable === false ? "تُطبَّق" : "معفاة"}</td>
                  <td className="shipzones__row-actions">
                    <button type="button" className="btn" onClick={() => startEdit(z)}>
                      تعديل
                    </button>
                    <button type="button" className="btn" onClick={() => void deactivate(z)}>
                      إيقاف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const STYLES = `
.shipzones { padding: 0.25rem 0.15rem 1.5rem; }
.shipzones__hdr {
  display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:flex-end;
  margin-bottom:14px; padding:14px 16px; border-radius:14px;
  border:1px solid rgba(56,189,248,0.35);
  background: linear-gradient(135deg, rgba(8,47,73,0.55), rgba(16,185,129,0.08));
}
.shipzones__hdr h2 { margin:0; font-size:1.2rem; }
.shipzones__hdr p { margin:4px 0 0; color:var(--muted); font-size:0.88rem; max-width:52rem; }
.shipzones__alert { padding:10px 14px; border-radius:10px; margin-bottom:12px; font-weight:700; border:1px solid var(--border); }
.shipzones__alert--ok { background:rgba(52,211,153,0.12); color:var(--ok); }
.shipzones__alert--err { background:rgba(251,113,133,0.14); color:var(--danger); }
.shipzones__hint { margin:0 0 12px; font-size:0.85rem; color:var(--muted); }
.shipzones__form {
  background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; margin-bottom:14px;
}
.shipzones__form h3 { margin:0 0 10px; font-size:1.05rem; color:var(--accent2); }
.shipzones__grid {
  display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; align-items:end;
}
.shipzones__grid label { display:flex; flex-direction:column; gap:4px; font-size:0.8rem; font-weight:700; }
.shipzones__grid input { font:inherit; font-weight:500; padding:8px 10px; border-radius:8px;
  border:1px solid var(--border); background:rgba(15,23,42,0.4); color:inherit; }
.shipzones__check { flex-direction:row !important; align-items:center; gap:8px !important; margin-top:18px; }
.shipzones__actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
.shipzones__list-wrap { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; }
.shipzones__list-top { display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; align-items:center; margin-bottom:10px; }
.shipzones__list-top h3 { margin:0; font-size:1.05rem; }
.shipzones__filter { min-width:200px; padding:8px 10px; border-radius:8px; border:1px solid var(--border);
  background:rgba(15,23,42,0.4); color:inherit; font:inherit; }
.shipzones__empty { color:var(--muted); margin:8px 0; }
.shipzones__table { width:100%; border-collapse:separate; border-spacing:0; font-size:0.9rem; }
.shipzones__table th, .shipzones__table td { padding:8px 10px; border-bottom:1px solid var(--border); text-align:right; }
.shipzones__table th { color:var(--muted); font-weight:700; background:rgba(255,255,255,0.03); }
.shipzones__table td.num { font-variant-numeric:tabular-nums; }
.shipzones__row-actions { display:flex; gap:6px; justify-content:flex-end; }
`;
