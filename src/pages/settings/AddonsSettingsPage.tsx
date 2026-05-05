import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import { notifySettingsRestartRecommended } from "../../lib/settingsRestartNotice";

type Row = { id: number; label: string; price: number; sortOrder: number; isActive: boolean };

export default function AddonsSettingsPage() {
  const base = getApiBase();
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverHint, setServerHint] = useState<{ active: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setMsg("");
    const catalogUrl = `${base}/api/restaurant/catalog-addons`;
    try {
      const r = await fetch(`${catalogUrl}?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const t = await r.text();
      const j = (() => {
        try {
          return JSON.parse(t) as {
            items?: Row[];
            ok?: boolean;
            error?: string;
            note?: string;
            activeCount?: number;
            totalCount?: number;
          };
        } catch {
          return {};
        }
      })();
      if (r.status === 404) {
        throw new Error(
          "الخادم لا يتعرّف على مسار كتالوج الإضافات (404) — أعد تشغيل API من مجلد المشروع «مطاعم» (مثلاً run_full_stack أو run_api) بعد آخر تحديث للكود. إن وُجد أكثر من نسخة api_server فتأكد أن المنفذ 2288 يشغّل النسخة المحدثة."
        );
      }
      if (!r.ok) throw new Error(j.error || t || `HTTP ${r.status}`);
      if (typeof j.activeCount === "number" && typeof j.totalCount === "number") {
        setServerHint({ active: j.activeCount, total: j.totalCount });
      } else {
        setServerHint(null);
      }
      const it = Array.isArray(j.items) ? j.items : [];
      setRows(
        it.map((x: any) => ({
          id: Number(x.id) || 0,
          label: String(x.label || "").trim() || "إضافة",
          price: Math.max(0, Number(x.price) || 0),
          sortOrder: Number(x.sortOrder) || 0,
          isActive: x.isActive !== false,
        })),
      );
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  function addRow() {
    setRows((prev) => {
      const nextSo = (prev[prev.length - 1]?.sortOrder || 0) + 1;
      return [
        ...prev,
        { id: 0, label: "إضافة جديدة", price: 0, sortOrder: nextSo, isActive: true },
      ];
    });
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy(true);
    setMsg("");
    const catalogUrl = `${base}/api/restaurant/catalog-addons`;
    try {
      const r = await fetch(catalogUrl, {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({
          items: rows
            .filter((x) => (x.label || "").trim() !== "")
            .map((x) => ({
              label: (x.label || "").trim(),
              price: x.price,
              sortOrder: x.sortOrder,
              isActive: x.isActive,
            })),
        }),
      });
      const t = await r.text();
      const j = (() => {
        try {
          return JSON.parse(t) as { ok?: boolean; detail?: unknown };
        } catch {
          return {};
        }
      })();
      if (r.status === 404) {
        throw new Error(
          "الخادم قديم أو ليس من مجلد مطاعم — أعد تشغيل api_server المحدّث (منفذ 2288).",
        );
      }
      if (!r.ok) {
        const d = (j as { detail?: unknown }).detail;
        const detailText =
          typeof d === "string"
            ? d
            : Array.isArray(d)
              ? d
                  .map((x) => {
                    if (typeof x === "string") return x;
                    if (x && typeof x === "object") {
                      const msg = String((x as { msg?: unknown }).msg || "").trim();
                      const loc = (x as { loc?: unknown }).loc;
                      if (msg) return Array.isArray(loc) ? `${msg} (${loc.join(" > ")})` : msg;
                    }
                    return "";
                  })
                  .filter(Boolean)
                  .join(" | ")
              : "";
        throw new Error(detailText || t || `HTTP ${r.status}`);
      }
      notifySettingsRestartRecommended();
      setMsg("تم حفظ الإضافات. ستظهر فوراً في مودال الجرسون بعد التحديث.");
      void load();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMsg(`فشل الحفظ: ${text}`);
    } finally {
      setBusy(false);
    }
  }

  const localActive = useMemo(
    () => rows.filter((x) => x.isActive !== false && (x.label || "").trim() !== "").length,
    [rows]
  );

  return (
    <div className="page" style={{ direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>الإضافات (كتالوج)</h2>
      <p style={{ color: "var(--muted)", maxWidth: 720, lineHeight: 1.6, marginTop: 0 }}>
        سعر بند المبيعات = سعر المنتج في البطاقة + مجموع أسعار الإضافات المختارة. الخدمة والضريبة تُحسبان على «السعر بعد
        الإضافات» وفق سياسة <strong>الضريبة والخدمة</strong> (نفس نسب مودال الجرسون).
      </p>
      <p style={{ color: "#b45309", maxWidth: 720, lineHeight: 1.5, fontWeight: 600 }}>
        1) اضغط <strong>حفظ</strong> بعد أي تعديل — بدون حفظ لا يصل شيء إلى قاعدة البيانات أو لمودال الجرسون. 2) عمود
        &quot;نشط&quot; إذا كان غير مُفعّل: الصف <strong>لا يظهر</strong> في مودال الصنف (ويبقى هنا فقط لإدارتك).{" "}
        {serverHint ? (
          <span>
            (من السيرفر: {serverHint.active} مفعّل / {serverHint.total} إجمالي)
          </span>
        ) : null}{" "}
        (معاينة محلية: <strong>{localActive}</strong> مفعّل)
      </p>
      <div className="card" style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          تحديث
        </button>
        <button type="button" className="btn" onClick={addRow}>
          + صف
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? "جاري…" : "حفظ"}
        </button>
        {msg ? <span style={{ color: "var(--muted)" }}>{msg}</span> : null}
      </div>
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={{ padding: 8, textAlign: "right" }}>اسم الإضافة</th>
              <th style={{ padding: 8, textAlign: "right" }}>السعر (ج.م)</th>
              <th style={{ padding: 8, textAlign: "right" }}>ترتيب</th>
              <th style={{ padding: 8, textAlign: "center" }}>نشط</th>
              <th style={{ padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 12, textAlign: "center", color: "var(--muted)" }}>
                  لا توجد صفوف. اضغط «+ صف» ثم «حفظ»، أو نفّذ تهيية القاعدة لإدخال البذور الافتراضية.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={`${r.id}-${i}`}
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    opacity: r.isActive ? 1 : 0.55,
                  }}
                  title={r.isActive ? undefined : "غير مفعّل: لن يظهر في مودال الجرسون"}
                >
                  <td style={{ padding: 6 }}>
                    <input
                      value={r.label}
                      onChange={(e) => updateRow(i, { label: e.target.value })}
                      style={{ width: "100%", minWidth: 180 }}
                    />
                  </td>
                  <td style={{ padding: 6, width: 120 }}>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={r.price}
                      onChange={(e) => updateRow(i, { price: Math.max(0, Number(e.target.value) || 0) })}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td style={{ padding: 6, width: 80 }}>
                    <input
                      type="number"
                      value={r.sortOrder}
                      onChange={(e) => updateRow(i, { sortOrder: Math.round(Number(e.target.value) || 0) })}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td style={{ padding: 6, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={r.isActive}
                      onChange={(e) => updateRow(i, { isActive: e.target.checked })}
                    />
                  </td>
                  <td style={{ padding: 6 }}>
                    <button type="button" className="btn btn-ghost" onClick={() => removeRow(i)}>
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
