import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import SmartProductSearch from "../../components/SmartProductSearch";
import SettingRow from "../../components/SettingRow";

/** إعدادات المطبخ فقط */
type KitchenOps = {
  kitchenOutputMode: string;
  kitchenPrepBoardLayout: string;
  kitchenExecutionMode: string;
  kitchenSpecialistStationsJson: string;
  kitchenSpecialistChefsJson: string;
  kitchenPrintTicketMode: string;
  kitchenPrintShowTableChip: string;
  kitchenPrinterDeviceHint: string;
};

const DEFAULTS: KitchenOps = {
  kitchenOutputMode: "screens",
  kitchenPrepBoardLayout: "per_station",
  kitchenExecutionMode: "current",
  kitchenSpecialistStationsJson: "[]",
  kitchenSpecialistChefsJson: "[]",
  kitchenPrintTicketMode: "batch_only",
  kitchenPrintShowTableChip: "on",
  kitchenPrinterDeviceHint: "",
};

type StationRow = { id: string; label: string; jobTitle: string; active: boolean; stationCode: string };
type ChefRow = { id: string; label: string; jobTitle: string; active: boolean; stationCode: string; userId: string; userLogin: string; productGuids: string[] };

function normalizeStationCode(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 80).replace(/^_+|_+$/g, "");
}

export default function KitchenOpsSettingsPage() {
  const base = getApiBase();
  const [s, setS] = useState<KitchenOps>(DEFAULTS);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [printerMsg, setPrinterMsg] = useState("");
  const [products, setProducts] = useState<{ CardGuide: string; ProductName: string }[]>([]);
  const [productsMsg, setProductsMsg] = useState("");

  async function load() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setS({ ...DEFAULTS, ...(j as object) });
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => { void load(); }, []);

  async function loadProducts() {
    setProductsMsg("");
    try {
      const r = await fetch(`${base}/api/products`);
      const j = (await r.json().catch(() => ({}))) as { products?: { CardGuide: string; ProductName: string }[] };
      setProducts(Array.isArray(j.products) ? j.products : []);
    } catch (e) {
      setProductsMsg(`تعذر تحميل الأصناف: ${String(e)}`);
    }
  }

  useEffect(() => { void loadProducts(); }, [base]);

  const stations: StationRow[] = useMemo(() => {
    try {
      const arr = JSON.parse(String(s.kitchenSpecialistStationsJson || "[]"));
      return Array.isArray(arr) ? arr.filter((x: unknown) => x && typeof x === "object").slice(0, 80).map((o: Record<string, unknown>) => ({
        id: String(o.id || crypto.randomUUID()),
        label: String(o.label || ""),
        jobTitle: String(o.jobTitle || ""),
        active: o.active !== false,
        stationCode: normalizeStationCode(String(o.stationCode || "")),
      })) : [];
    } catch { return []; }
  }, [s.kitchenSpecialistStationsJson]);

  const chefs: ChefRow[] = useMemo(() => {
    try {
      const arr = JSON.parse(String(s.kitchenSpecialistChefsJson || "[]"));
      return Array.isArray(arr) ? arr.filter((x: unknown) => x && typeof x === "object").slice(0, 60).map((o: Record<string, unknown>) => ({
        id: String(o.id || crypto.randomUUID()),
        label: String(o.label || ""),
        jobTitle: String(o.jobTitle || ""),
        active: o.active !== false,
        stationCode: normalizeStationCode(String(o.stationCode || "")),
        userId: String(o.userId || ""),
        userLogin: String(o.userLogin || ""),
        productGuids: Array.isArray(o.productGuids) ? o.productGuids.map((g: unknown) => String(g || "").trim().toUpperCase()).filter(Boolean) : [],
      })) : [];
    } catch { return []; }
  }, [s.kitchenSpecialistChefsJson]);

  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) {
      const id = String(p.CardGuide || "").trim().toUpperCase();
      if (id) m.set(id, String(p.ProductName || "").trim() || id);
    }
    return m;
  }, [products]);

  const assignmentByCode = useMemo(() => {
    const m = new Map<string, ChefRow>();
    for (const row of chefs) {
      const code = normalizeStationCode(row.stationCode || "");
      if (code) m.set(code, row);
    }
    return m;
  }, [chefs]);

  function writeStations(next: StationRow[]) {
    const safe = next.map((row) => ({
      id: String(row.id || crypto.randomUUID()),
      label: String(row.label || "").trim().slice(0, 120),
      jobTitle: String(row.jobTitle || "").trim().slice(0, 120),
      active: row.active !== false,
      stationCode: normalizeStationCode(row.stationCode || ""),
    }));
    setS((x) => ({ ...x, kitchenSpecialistStationsJson: JSON.stringify(safe) }));
  }

  function writeStationAssignment(stationCode: string, productGuids: string[]) {
    const code = normalizeStationCode(stationCode || "");
    if (!code) return;
    const rest = chefs.filter((row) => normalizeStationCode(row.stationCode || "") !== code);
    const station = stations.find((x) => normalizeStationCode(x.stationCode || "") === code);
    const next: ChefRow[] = [
      ...rest,
      {
        id: assignmentByCode.get(code)?.id || crypto.randomUUID(),
        label: station?.label || code,
        jobTitle: station?.jobTitle || "",
        active: station?.active !== false,
        stationCode: code,
        userId: "",
        userLogin: "",
        productGuids: Array.from(new Set(productGuids.map((g) => String(g || "").trim().toUpperCase()).filter(Boolean))),
      },
    ];
    setS((x) => ({ ...x, kitchenSpecialistChefsJson: JSON.stringify(next) }));
  }

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setS({ ...DEFAULTS, ...(j as object) });
      setMsg("تم حفظ إعدادات المطبخ بنجاح.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function testPrinter() {
    setPrinterMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings/printer-test`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setPrinterMsg(String((j as { message?: string }).message || (await r.text())));
    } catch (e) {
      setPrinterMsg(String(e));
    }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <h2 style={{ marginTop: 0 }}>إعدادات المطبخ والإنتاج</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        إعدادات خاصة بمطبخ المطعم: شاشات KDS، نظام الشيف المختص، الطباعة.
      </p>

      <div className="grid-2">
        <SettingRow label="مخرجات المطبخ" tooltip="كيف يُعرض الطلبات في المطبخ: شاشات KDS أو طابعات أو كلاهما. يؤثر على شاشة الطباخ فقط.">
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>الوضع</label>
          <select value={s.kitchenOutputMode} onChange={(e) => setS((x) => ({ ...x, kitchenOutputMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="screens">شاشات فقط (KDS)</option>
            <option value="printers">طابعات فقط</option>
            <option value="both">شاشات + طابعات</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>لوحة التحضير</label>
          <select value={s.kitchenPrepBoardLayout} onChange={(e) => setS((x) => ({ ...x, kitchenPrepBoardLayout: e.target.value }))} style={{ width: "100%" }}>
            <option value="per_station">شاشة/قائمة لكل محطة أو شيف</option>
            <option value="expeditor_single">شاشة واحدة لمدير المطبخ / الفرشجي</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>نمط تشغيل المطبخ</label>
          <select value={s.kitchenExecutionMode} onChange={(e) => setS((x) => ({ ...x, kitchenExecutionMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="current">استخدام النظام الحالي (مدير المطبخ هو المسؤول العام)</option>
            <option value="specialist_chefs">استخدام نظام الشيف المختص</option>
          </select>
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            عند اختيار <strong>نظام الشيف المختص</strong> تبقى شاشة مدير المطبخ العامة كما هي، ويُفعَّل معها تعريف الشيفات المختصين وأصناف كل شيف.
          </p>
        </SettingRow>

        <SettingRow label="طباعة المطبخ" tooltip="إعدادات طباعة تذاكر المطبخ. يتطلب توصيل طابعة محلية أو شبكية.">
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>نمط التذكرة</label>
          <select value={s.kitchenPrintTicketMode} onChange={(e) => setS((x) => ({ ...x, kitchenPrintTicketMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="batch_only">ما يُرسل في هذه الدفعة فقط</option>
            <option value="aggregated_summary">ملخص مُجمَّع (مثل شريط المطبخ)</option>
            <option value="delta_net">صافي «مزيلة» (مطلوب − منفّذ + الحالي)</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>طباعة بديل عن شريحة الطاولة</label>
          <select value={s.kitchenPrintShowTableChip} onChange={(e) => setS((x) => ({ ...x, kitchenPrintShowTableChip: e.target.value }))} style={{ width: "100%" }}>
            <option value="on">نعم</option>
            <option value="off">لا</option>
          </select>
          <label style={{ display: "block", fontWeight: 700, marginTop: 10, marginBottom: 4 }}>تلميح جهاز الطابعة (اختياري)</label>
          <input value={s.kitchenPrinterDeviceHint} onChange={(e) => setS((x) => ({ ...x, kitchenPrinterDeviceHint: e.target.value }))} style={{ width: "100%" }} placeholder="اسم الطابعة أو المسار — للربط لاحقاً" />
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => void testPrinter()}>اختبار توصيل الطابعة (مهيأ)</button>
          {printerMsg ? <p style={{ marginTop: 8, fontSize: "0.85rem" }}>{printerMsg}</p> : null}
        </SettingRow>
      </div>

      <h3 style={{ marginTop: "1.5rem", marginBottom: "0.5rem", fontSize: "1.05rem" }}>نظام الشيف المختص</h3>
      <div className="grid-2">
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div style={{ marginBottom: 10, padding: "0.7rem 0.8rem", borderRadius: 10, border: "1px solid rgba(56,189,248,0.25)", background: s.kitchenExecutionMode === "specialist_chefs" ? "rgba(14,165,233,0.08)" : "rgba(148,163,184,0.08)", color: "var(--muted)", fontSize: "0.85rem" }}>
            {s.kitchenExecutionMode === "specialist_chefs" ? "الوضع المختص محدد الآن." : "التجهيز متاح، والتفعيل يكون من نمط تشغيل المطبخ."}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={() => writeStations([...stations, { id: crypto.randomUUID(), label: "", jobTitle: "", active: true, stationCode: "" }])}>إضافة محطة</button>
            <button type="button" className="btn btn-ghost" onClick={() => void loadProducts()}>تحديث الأصناف</button>
          </div>
          {productsMsg ? <p style={{ marginTop: 0, fontSize: "0.85rem" }}>{productsMsg}</p> : null}
          <div style={{ marginBottom: 10, fontSize: "0.82rem", color: "var(--muted)" }}>المحطات تُعرّف هنا مرة واحدة، ثم ترتبط بها المستخدمون والأصناف والشاشات.</div>
          {stations.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>لا توجد محطات مختصة بعد.</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>تعريف المحطات</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {stations.map((station, idx) => (
                    <div key={station.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) auto auto", gap: 8, alignItems: "center" }}>
                        <input value={station.label} onChange={(e) => { const next = [...stations]; next[idx] = { ...station, label: e.target.value }; writeStations(next); }} placeholder="اسم المحطة" style={{ width: "100%" }} />
                        <input value={station.jobTitle} onChange={(e) => { const next = [...stations]; next[idx] = { ...station, jobTitle: e.target.value }; writeStations(next); }} placeholder="الوصف التشغيلي" style={{ width: "100%" }} />
                        <input value={station.stationCode} onChange={(e) => { const next = [...stations]; next[idx] = { ...station, stationCode: normalizeStationCode(e.target.value) }; writeStations(next); }} placeholder="stationCode" style={{ width: "100%" }} />
                        <label style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                          <input type="checkbox" checked={station.active} onChange={(e) => { const next = [...stations]; next[idx] = { ...station, active: e.target.checked }; writeStations(next); }} /> نشط
                        </label>
                        <button type="button" className="btn btn-ghost" onClick={() => writeStations(stations.filter((x) => x.id !== station.id))}>حذف</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>ربط الأصناف بالمحطات</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {stations.map((station) => {
                    const code = normalizeStationCode(station.stationCode || "");
                    const assignment = assignmentByCode.get(code);
                    const productGuids = assignment?.productGuids || [];
                    return (
                      <div key={`assign-${station.id}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{station.label || code || "محطة"}</div>
                            <div style={{ marginTop: 4, fontSize: "0.82rem", color: "var(--muted)" }}>المحطة: <strong>{code || "غير محددة"}</strong></div>
                          </div>
                          <div style={{ fontSize: "0.82rem", color: "var(--muted)", textAlign: "left" }}>عدد الأصناف: <strong>{productGuids.length}</strong></div>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>إضافة صنف</div>
                          <SmartProductSearch placeholder="ابحث عن صنف ثم اضغط عليه" onSelect={(hit) => { const gid = String(hit.CardGuide || "").trim().toUpperCase(); if (!gid || !code || productGuids.includes(gid)) return; writeStationAssignment(code, [...productGuids, gid]); }} />
                        </div>
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {productGuids.length ? productGuids.map((gid) => (
                            <button key={`${station.id}-${gid}`} type="button" className="btn btn-ghost" style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }} title={gid} onClick={() => writeStationAssignment(code, productGuids.filter((x) => x !== gid))}>
                              {productNameById.get(gid) || gid} ×
                            </button>
                          )) : <div style={{ color: "var(--muted)" }}>لا توجد أصناف مرتبطة.</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>عرض JSON الحالي</summary>
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(s.kitchenSpecialistStationsJson || "[]")}</pre>
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(s.kitchenSpecialistChefsJson || "[]")}</pre>
          </details>
        </div>
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>حفظ</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>تحديث</button>
        {busy ? <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>جاري الحفظ...</span> : null}
      </div>
      {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
    </div>
  );
}
