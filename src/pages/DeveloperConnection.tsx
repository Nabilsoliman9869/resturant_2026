import { useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";

type DevLog = {
  id: number;
  error_at: string;
  level: string;
  source: string;
  role: string;
  user: string;
  route: string;
  message: string;
};

export default function DeveloperConnection() {
  const [server, setServer] = useState("");
  const [port, setPort] = useState<string>("");
  const [database, setDatabase] = useState("");
  const [uid, setUid] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<DevLog[]>([]);
  const [whoamiText, setWhoamiText] = useState<string>("");

  function apiUnreachableHint() {
    const base = getApiBase();
    const isProxied =
      typeof window !== "undefined" &&
      (window.location.port === "9999" || window.location.port === "5290") &&
      !import.meta.env.VITE_XTRA_API;
    return isProxied
      ? `تعذر الوصول للـ API عبر ${base}. شغّل خادم Python على http://127.0.0.1:2288 (مثلاً run_api.bat أو run_full_stack.bat) — البروكسي يمرّر /api إلى 2288.`
      : `تعذر الوصول للـ API على ${base}. تحقق من تشغيل الخلفية ومن قيمة VITE_XTRA_API في .env إن استخدمتها.`;
  }

  async function loadSettings() {
    const r = await fetch(`${getApiBase()}/api/settings/connection`);
    const d = await r.json();
    setServer(d.server || "");
    setPort(d.port != null ? String(d.port) : "");
    setDatabase(d.database || "");
    setUid(d.uid || "");
    setPassword(d.password || "");
  }

  async function loadLogs() {
    try {
      const r = await fetch(`${getApiBase()}/api/dev/error-logs?limit=50`);
      if (!r.ok) return;
      const j = await r.json();
      setLogs(Array.isArray(j.logs) ? j.logs : []);
    } catch {
      setLogs([]);
    }
  }

  useEffect(() => {
    fetch(`${getApiBase()}/__whoami__`)
      .then((r) => (r.ok ? r.text() : Promise.resolve("")))
      .then((t) => setWhoamiText((t || "").trim()))
      .catch(() => setWhoamiText(""));
    loadSettings()
      .then(() => loadLogs())
      .catch(() => setMsg(apiUnreachableHint()));
  }, []);

  async function save() {
    setMsg("");
    setBusy(true);
    try {
      const p = port.trim() ? Number(port) : null;
      const r = await fetch(`${getApiBase()}/api/settings/connection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server,
          port: p,
          database,
          uid,
          password,
        }),
      });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      setMsg("تم حفظ إعدادات الاتصال في config/settings.json.");
    } catch (e) {
      const s = String(e);
      setMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachableHint() : s);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setMsg("");
    setBusy(true);
    try {
      const p = port.trim() ? Number(port) : null;
      const r = await fetch(`${getApiBase()}/api/settings/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server,
          port: p,
          database,
          uid,
          password,
        }),
      });
      const text = await r.text();
      let j: { ok?: boolean; detail?: string } = {};
      try {
        j = text ? (JSON.parse(text) as typeof j) : {};
      } catch {
        setMsg(
          `رد غير متوقع من الخادم (HTTP ${r.status}). إن كان الخادم يعمل، تحقق من البروكسي والمنفذ 2288.\n${text.slice(0, 280)}`,
        );
        return;
      }
      if (!r.ok) {
        setMsg(j.detail || `HTTP ${r.status}: ${text.slice(0, 200)}`);
        return;
      }
      setMsg(j.ok ? "اختبار الاتصال ناجح." : j.detail || JSON.stringify(j));
    } catch (e) {
      const s = String(e);
      setMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachableHint() : s);
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap() {
    setMsg("");
    setBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/dev/bootstrap`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
      const tbl = Array.isArray(j.tables) ? j.tables.join(", ") : "جداول الدعم";
      const n = typeof j.defaultAppUsersInserted === "number" ? j.defaultAppUsersInserted : null;
      const usersLine =
        n != null && n > 0
          ? ` — تم إدراج ${n} مستخدم افتراضي (كاشير/محاسب/…).`
          : n === 0
            ? " — جدول المستخدمين كان غير فارغ؛ لم يُدرَج مستخدمون افتراضيون."
            : "";
      const seed = j.restaurantInvoiceTypesSeed as
        | {
            ok?: boolean;
            note?: string;
            created?: unknown[];
            skipped?: string[];
            errors?: { orderKind?: string; detail?: string }[];
            tbl020SeededDirect?: boolean;
            tbl020TemplateInserted?: boolean;
          }
        | undefined;
      const invOk = seed?.ok !== false && j.restaurantInvoiceTypesOk !== false;
      let invLine = "";
      if (seed) {
        const cr = Array.isArray(seed.created) ? seed.created.length : 0;
        const sk = Array.isArray(seed.skipped) ? seed.skipped.length : 0;
        const er = Array.isArray(seed.errors) ? seed.errors : [];
        invLine = `\n\nأنواع فواتير المطعم (TBL020 / MAT3AM): ${invOk ? "حسب التوقع" : "⚠ فشل أو نقص"}\n— أُنشئ/حدّث: ${cr} — تخطّي (موجود مسبقاً): ${sk}`;
        if (seed.note) invLine += `\n— ملاحظة: ${seed.note}`;
        if (er.length) {
          invLine += `\n— أخطاء:\n${er.map((e) => `  • ${e.orderKind ?? "?"}: ${e.detail ?? ""}`).join("\n")}`;
        }
        invLine += `\n— تحقق في SSMS: SELECT CardGuide, InvoiceName FROM TBL020 WHERE InvoiceName LIKE N'مطاعم —%';`;
      }
      if (!invOk) {
        invLine += "\n\n⚠ نفّذ SELECT على TBL020؛ إن لم تظهر الصفوف الستة فالنسخ من القالب فشل (راجع رسالة SQL أعلاه أو هيكل TBL020).";
      }
      const rev = typeof j.bootstrapSchemaRevision === "number" ? j.bootstrapSchemaRevision : 0;
      const stSeed = j.restaurantStoresSeed as
        | {
            ok?: boolean;
            note?: string;
            created?: unknown[];
            skipped?: string[];
            errors?: { orderKind?: string; detail?: string }[];
            tbl008Mat3amNameRows?: number | null;
          }
        | undefined;
      const stOk = stSeed?.ok !== false && j.restaurantStoresOk !== false;
      let storeLine = "";
      if (!("restaurantStoresSeed" in j) || rev < 3) {
        storeLine = `\n\n⚠ المخازن (TBL008): رد الخادم قديم أو لا يشمل تهيئة المخازن (bootstrapSchemaRevision=${rev || "غير مرسل"}). أوقف الخادم ثم شغّل من مجلد المشروع: python backend/api_server.py (أو run_api.bat) وتأكد أن الملف المحدّث يُحمَّل.`;
      } else if (stSeed) {
        const cr = Array.isArray(stSeed.created) ? stSeed.created.length : 0;
        const sk = Array.isArray(stSeed.skipped) ? stSeed.skipped.length : 0;
        const er = Array.isArray(stSeed.errors) ? stSeed.errors : [];
        const cnt = stSeed.tbl008Mat3amNameRows;
        storeLine = `\n\nمخازن المطعم (TBL008 / MAT3AM_RESTAURANT_STORES): ${stOk ? "حسب التوقع" : "⚠ فشل أو نقص"}\n— أُنشئ/حدّث خريطة: ${cr} — تخطّي (موجود مسبقاً): ${sk}`;
        if (typeof cnt === "number") storeLine += `\n— صفوف TBL008 باسم «مطاعم —»: ${cnt} (بعد التهيئة)`;
        if (stSeed.note) storeLine += `\n— ملاحظة: ${stSeed.note}`;
        if (er.length) {
          storeLine += `\n— أخطاء:\n${er.map((e) => `  • ${e.orderKind ?? "?"}: ${e.detail ?? ""}`).join("\n")}`;
        }
        storeLine += `\n— تحقق في SSMS: SELECT CardGuide, WarehouseName FROM dbo.TBL008 WHERE WarehouseName LIKE N'مطاعم —%';`;
        storeLine += `\n— SELECT OrderKind, Tbl008CardGuide FROM dbo.MAT3AM_RESTAURANT_STORES;`;
      }
      if (rev >= 3 && !stOk && stSeed) {
        storeLine += "\n\n⚠ فشل تهيئة المخازن — لن يُحفَظ StoreGuide في TBL022 حتى تُصلَح؛ راجع التفاصيل أعلاه.";
      }
      setMsg(`تهيئة: ${tbl}${usersLine}.${invLine}${storeLine}`);
      await loadSettings();
      await loadLogs();
    } catch (e) {
      const s = String(e);
      setMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachableHint() : s);
    } finally {
      setBusy(false);
    }
  }

  const viteBoot = __MAT3AM_VITE_BOOT_STAMP__;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>لوحة المطور — الاتصال والتهيئة</h2>
      <div
        className="card"
        style={{
          marginBottom: 16,
          padding: "12px 14px",
          background: "var(--surface-2, rgba(0,0,0,0.06))",
          border: "1px solid var(--border, #ccc)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>بصمة التشغيل الحالية (للتأكد أنك لست على نسخة قديمة)</div>
        <div style={{ fontSize: "0.88rem", lineHeight: 1.5 }}>
          <div>
            واجهة Vite — وقت إقلاع السيرفر: <code>{viteBoot || "—"}</code>
          </div>
          <div style={{ marginTop: 4 }}>
            عنوانك في المتصفح: <code>{typeof window !== "undefined" ? window.location.href : "—"}</code>
          </div>
          {whoamiText ? (
            <pre
              style={{
                margin: "8px 0 0",
                padding: 8,
                fontSize: "0.8rem",
                overflow: "auto",
                background: "var(--bg, #fff)",
                borderRadius: 4,
              }}
            >
              {whoamiText}
            </pre>
          ) : (
            <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
              لم يُحمَّل <code>/__whoami__</code> — شغّل API من مجلد مطاعم (<code>run_api.bat</code> أو{" "}
              <code>restart_from_zero.bat</code>) ثم حدّث الصفحة.
            </p>
          )}
        </div>
        <p style={{ margin: "10px 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
          إن بقي وقت Vite أو <code>API_FILE_MTIME_UNIX</code> كما كان بعد إعادة تشغيل واضحة، فأنت إما لم تُغلِق العملية
          القديمة على المنفذ أو المتصفح يخبّئ كاشاً — استخدم <code>restart_from_zero.bat</code> ثم Ctrl+Shift+R.
        </p>
      </div>
      <p style={{ color: "var(--muted)" }}>
        عنوان الطلبات من المتصفح: <code>{getApiBase()}</code>
        {typeof window !== "undefined" &&
          !import.meta.env.VITE_XTRA_API &&
          (window.location.port === "9999" || window.location.port === "5290") && (
          <>
            {" "}
            — طلبات <code>/api</code> تُوجَّه بالبروكسي إلى الخلفية على <code>http://127.0.0.1:2288</code> (يجب أن تكون
            شغّالة).
          </>
        )}
      </p>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        منفذ واجهة Vite الحالي في المشروع: <code>9999</code> (انظر <code>vite.config.ts</code>). لتجاوز البروكسي، انسخ{" "}
        <code>.env.example</code> إلى <code>.env</code> وعيّن <code>VITE_XTRA_API</code> لعنوان الـ API المباشر.
      </p>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>إعدادات قاعدة البيانات</h3>
          <label style={{ display: "block", marginBottom: 4 }}>السيرفر</label>
          <input value={server} onChange={(e) => setServer(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
          <label style={{ display: "block", marginBottom: 4 }}>المنفذ (اختياري)</label>
          <input value={port} onChange={(e) => setPort(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
          <label style={{ display: "block", marginBottom: 4 }}>قاعدة البيانات</label>
          <input value={database} onChange={(e) => setDatabase(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
          <label style={{ display: "block", marginBottom: 4 }}>المستخدم</label>
          <input value={uid} onChange={(e) => setUid(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
          <label style={{ display: "block", marginBottom: 4 }}>كلمة المرور</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", marginBottom: 12 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              حفظ
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void test()} disabled={busy}>
              اختبار الاتصال
            </button>
            {busy ? <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>جاري الطلب…</span> : null}
          </div>
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: 12,
              minHeight: msg ? undefined : 0,
              padding: msg ? "10px 12px" : 0,
              borderRadius: 8,
              border: msg ? "1px solid var(--border)" : "none",
              background: msg ? "rgba(34, 211, 238, 0.08)" : "transparent",
              color: "var(--text)",
              fontSize: "0.95rem",
              whiteSpace: "pre-wrap",
            }}
          >
            {msg || (busy ? "" : "اضغط «اختبار الاتصال» أو «حفظ» — تظهر النتيجة هنا.")}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>تهيئة النظام</h3>
          <p style={{ color: "var(--muted)" }}>
            الزر التالي ينشئ تلقائياً جداول الدعم الناقصة (المستخدمين، سجل الأخطاء، وصفات التكاليف) داخل قاعدة البيانات.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void bootstrap()} disabled={busy}>
            تنفيذ التهيئة
          </button>
          <div style={{ marginTop: 10, color: "var(--muted)", fontSize: "0.9rem" }}>
            نظام اللوج يحتفظ ببيانات شهر (30 يوماً) ويتم تنظيف الأقدم تلقائياً.
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>سجل الأخطاء الأخير</h3>
          <button type="button" className="btn btn-ghost" onClick={() => void loadLogs()}>
            تحديث
          </button>
        </div>
        {logs.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>لا توجد أخطاء مسجلة حالياً.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--muted)" }}>
                  <th style={{ padding: "6px 8px" }}>الوقت</th>
                  <th style={{ padding: "6px 8px" }}>المصدر</th>
                  <th style={{ padding: "6px 8px" }}>الدور</th>
                  <th style={{ padding: "6px 8px" }}>المسار</th>
                  <th style={{ padding: "6px 8px" }}>الرسالة</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{l.error_at}</td>
                    <td style={{ padding: "6px 8px" }}>{l.source}</td>
                    <td style={{ padding: "6px 8px" }}>{l.role || "-"}</td>
                    <td style={{ padding: "6px 8px" }}>{l.route || "-"}</td>
                    <td style={{ padding: "6px 8px" }}>{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

