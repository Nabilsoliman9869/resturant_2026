import { useEffect, useState, type ReactNode } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { useDbSettingsRefresh } from "../context/DbSettingsRefreshContext";

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

function apiUnreachable(): string {
  return [
    `تعذر إكمال الطلب عبر الشبكة (${getApiBase()}).`,
    "• شغّل run_full_stack.bat من مجلد «مطاعم» (يقتل 2288/9999 ثم يعيد التشغيل).",
    "• تحقق مباشرة: http://127.0.0.1:2288/api/ping — يجب {\"ok\":true}.",
    "• إن كان ping يعمل هنا لكن الأزرار تفشل: أوقف MAT3AM-API القديمة من Task Manager ثم أعد التشغيل.",
  ].join("\n");
}

function networkErrHint(raw: string): string {
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return apiUnreachable();
  if (/abort/i.test(raw)) {
    return "انتهت مهلة الطلب (~25 ثانية). SQL بطيء أو الخادم متوقف — راجع ping في الخطوة ٠.";
  }
  return raw;
}

async function readApiJson(
  url: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null; raw: string }> {
  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 0;
  const timer =
    timeoutMs > 0
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    const raw = await r.text();
    const data = tryParseJson<Record<string, unknown>>(raw);
    return { ok: r.ok, status: r.status, data, raw };
  } catch (e) {
    const raw = e instanceof DOMException && e.name === "AbortError" ? "AbortError: timeout" : String(e);
    return { ok: false, status: 0, data: null, raw };
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

function SetupStep({
  step,
  title,
  summary,
  children,
}: {
  step: number;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <section
      className="card dev-setup-step"
      style={{
        marginBottom: 14,
        borderInlineStart: "4px solid rgba(56, 189, 248, 0.55)",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 900,
            fontSize: "0.95rem",
            background: "rgba(56, 189, 248, 0.2)",
            color: "#7dd3fc",
            border: "1px solid rgba(56, 189, 248, 0.45)",
          }}
        >
          {step}
        </span>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{title}</h3>
          <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.45 }}>{summary}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatusBox({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "rgba(34, 211, 238, 0.08)",
        fontSize: "0.9rem",
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </div>
  );
}

function ApiPingRow({ apiPing }: { apiPing: { ok: boolean; ms: number } | null }) {
  if (apiPing == null) {
    return (
      <div style={{ marginTop: 10, fontSize: "0.85rem", color: "var(--muted)" }} aria-live="polite">
        فحص /api/ping…
      </div>
    );
  }
  const color = apiPing.ok ? "#22c55e" : "#ef4444";
  const label = apiPing.ok ? `API حي — ${apiPing.ms} ms` : `API لا يستجيب — ${apiPing.ms} ms`;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginTop: 10,
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: "0.85rem",
        fontWeight: 700,
        color,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          boxShadow: apiPing.ok ? "0 0 8px rgba(34,197,94,0.5)" : "none",
        }}
      />
      {label}
      {!apiPing.ok ? (
        <span style={{ fontWeight: 400, color: "var(--muted)" }}>— شغّل run_full_stack.bat</span>
      ) : null}
    </div>
  );
}

function ProbeBox({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <pre
      style={{
        marginTop: 12,
        fontSize: "0.78rem",
        overflow: "auto",
        maxHeight: 360,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "rgba(15, 23, 42, 0.35)",
      }}
    >
      {text}
    </pre>
  );
}

export default function DeveloperConnection() {
  const { bumpDbEpoch } = useDbSettingsRefresh();
  const [server, setServer] = useState("");
  const [port, setPort] = useState<string>("");
  const [database, setDatabase] = useState("");
  const [uid, setUid] = useState("");
  const [password, setPassword] = useState("");
  const [connectionMsg, setConnectionMsg] = useState("");
  const [workflowMsg, setWorkflowMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<DevLog[]>([]);
  const [whoamiText, setWhoamiText] = useState<string>("");
  const [probeText, setProbeText] = useState("");
  const [apiPing, setApiPing] = useState<{ ok: boolean; ms: number } | null>(null);

  async function loadSettings() {
    const res = await readApiJson(`${getApiBase()}/api/settings/connection`);
    if (!res.data) {
      throw new Error(res.status === 404 ? "Not Found" : res.raw || "فشل قراءة الإعدادات");
    }
    const d = res.data;
    setServer(String(d.server || ""));
    setPort(d.port != null ? String(d.port) : "");
    setDatabase(String(d.database || ""));
    setUid(String(d.uid || ""));
    setPassword(String(d.password || ""));
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
      .catch((e) => {
        const s = String(e);
        if (/failed to fetch|networkerror/i.test(s)) setConnectionMsg(networkErrHint(s));
        else if (s.includes("Not Found"))
          setConnectionMsg("مسار إعدادات الاتصال غير موجود — أوقف MAT3AM-API القديمة وشغّل run_api.bat من مجلد مطاعم.");
        else setConnectionMsg(s);
      });
  }, []);

  async function save() {
    setConnectionMsg("");
    setBusy(true);
    try {
      const p = port.trim() ? Number(port) : null;
      const res = await readApiJson(`${getApiBase()}/api/settings/connection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server, port: p, database, uid, password }),
      });
      if (res.status === 404) {
        setConnectionMsg('مسار غير موجود (404) — أوقف نافذة MAT3AM-API القديمة وشغّل run_api.bat من مجلد «مطاعم».');
        return;
      }
      if (!res.ok || !res.data?.ok) {
        throw new Error(String(res.data?.detail || res.raw || `HTTP ${res.status}`));
      }
      setConnectionMsg("تم حفظ الإعدادات في config/settings.json.");
      bumpDbEpoch();
    } catch (e) {
      const s = String(e);
      setConnectionMsg(networkErrHint(s));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setConnectionMsg("");
    setBusy(true);
    try {
      const p = port.trim() ? Number(port) : null;
      const res = await readApiJson(
        `${getApiBase()}/api/settings/test-connection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ server, port: p, database, uid, password }),
        },
        { timeoutMs: 25_000 },
      );
      if (res.status === 404) {
        setConnectionMsg('مسار اختبار الاتصال غير موجود (404) — أعد تشغيل API من مجلد المشروع (run_api.bat).');
        return;
      }
      if (res.status === 0) {
        setConnectionMsg(networkErrHint(res.raw));
        return;
      }
      if (!res.data) {
        setConnectionMsg(res.raw.trim() || `HTTP ${res.status}`);
        return;
      }
      const j = res.data as { ok?: boolean; detail?: string };
      if (!res.ok) {
        setConnectionMsg(String(j.detail || res.raw || `HTTP ${res.status}`));
        return;
      }
      setConnectionMsg(j.ok ? "الاتصال ناجح — انتقل للخطوة ٢ (تشخيص)." : String(j.detail || "فشل الاتصال"));
    } catch (e) {
      setConnectionMsg(networkErrHint(String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function fetchMat3amProbeJson(): Promise<string> {
    const r = await fetch(`${getApiBase()}/api/dev/mat3am-schema-probe`);
    const j = await r.json();
    return JSON.stringify(j, null, 2);
  }

  async function mat3amProbe() {
    setProbeText("");
    setWorkflowMsg("");
    setBusy(true);
    try {
      setProbeText(await fetchMat3amProbeJson());
      setWorkflowMsg("تم التشخيص — راجع DB_NAME() وجداول MAT3AM قبل التهيئة.");
    } catch (e) {
      const s = String(e);
      setProbeText(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
    } finally {
      setBusy(false);
    }
  }

  /** متقدم: DDL فقط — مدمج سابقاً في زر منفصل؛ يبقى للإصلاح السريع دون بذور */
  async function mat3amEnsureTablesOnly() {
    setProbeText("");
    setWorkflowMsg("");
    setBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/dev/mat3am-schema-ensure`, { method: "POST" });
      const t = await r.text();
      if (!r.ok) {
        setWorkflowMsg(t || `HTTP ${r.status}`);
        return;
      }
      try {
        setProbeText(JSON.stringify(JSON.parse(t), null, 2));
      } catch {
        setProbeText(t);
      }
      setWorkflowMsg("تم إنشاء/تحديث جداول MAT3AM فقط (بدون بذور TBL أو ملفات) — يُفضّل الخطوة ٣ الكاملة.");
      bumpDbEpoch();
    } catch (e) {
      setWorkflowMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap() {
    setWorkflowMsg("");
    setBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/dev/bootstrap`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
      const tbl = Array.isArray(j.tables) ? j.tables.join(", ") : "—";
      const n = typeof j.defaultAppUsersInserted === "number" ? j.defaultAppUsersInserted : null;
      const usersLine =
        n != null && n > 0 ? ` — مستخدمون افتراضيون: ${n}.` : n === 0 ? " — لم يُدرَج مستخدمون (الجدول غير فارغ)." : "";
      setWorkflowMsg(`[٣] تهيئة كاملة: جداول MAT3AM + ملفات المطعم + أنماط فواتير/مخازن.\n${tbl}${usersLine}\nالتالي: الخطوة ٤ إن كانت TBL فارغة.`);
      bumpDbEpoch();
      await loadSettings();
      await loadLogs();
      try {
        setProbeText(await fetchMat3amProbeJson());
      } catch {
        /* optional refresh after bootstrap */
      }
    } catch (e) {
      const s = String(e);
      setWorkflowMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
    } finally {
      setBusy(false);
    }
  }

  async function seedDefaultData() {
    setWorkflowMsg("");
    setBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/dev/seed-default-data`, { method: "POST" });
      const t = await r.text();
      let j: {
        ok?: boolean;
        detail?: string;
        message?: string;
        tables?: Record<string, unknown>;
        seedVersion?: string;
        masterDataNote?: string;
        fromDatabase?: unknown;
      } = {};
      try {
        j = t ? JSON.parse(t) : {};
      } catch {
        throw new Error(t || `HTTP ${r.status}`);
      }
      if (!r.ok || !j.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
      const out = j.tables || {};
      const fd = j.fromDatabase as
        | {
            TBL005?: { rowCount?: number };
            TBL006?: { rowCount?: number };
            TBL007?: { totalProducts?: number; distinctActiveGroups?: number };
          }
        | undefined;
      const summaryDb =
        fd && (fd.TBL005 || fd.TBL006 || fd.TBL007)
          ? `قاعدة: TBL005=${fd.TBL005?.rowCount ?? "—"} مركز، TBL006=${fd.TBL006?.rowCount ?? "—"} مجموعة، TBL007=${fd.TBL007?.totalProducts ?? "—"} صنف`
          : "";
      const lines = Object.keys(out).map((k) => {
        const s = out[k] as {
          source?: string;
          snapshot?: { rowCount?: number; totalProducts?: number; distinctActiveGroups?: number; error?: string };
          inserted?: number;
          updated?: number;
          skipped?: number;
          errors?: unknown[];
        };
        if (s.source === "database") {
          const sn = s.snapshot;
          if (k === "TBL007" && sn && typeof sn.totalProducts === "number") {
            return `${k}: مُتروك (القاعدة فيها ${sn.totalProducts} صنف)`;
          }
          if (sn && typeof sn.rowCount === "number") return `${k}: مُتروك (القاعدة فيها ${sn.rowCount} صف)`;
          return `${k}: مُتروك — بيانات موجودة`;
        }
        const errs = Array.isArray(s.errors) ? s.errors.length : 0;
        return `${k}: +${s.inserted || 0} / ~${s.updated || 0} / =${s.skipped || 0}${errs ? ` / !${errs}` : ""}`;
      });
      const head = [j.masterDataNote ? String(j.masterDataNote) : "", summaryDb].filter(Boolean).join("\n");
      setWorkflowMsg(`[٤] بيانات TBL\nSeed ${j.seedVersion || ""}\n${head}\n${lines.join("\n")}\nالتالي: الخطوة ٥ (تحقق).`);
      bumpDbEpoch();
      await loadLogs();
    } catch (e) {
      const s = String(e);
      setWorkflowMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
    } finally {
      setBusy(false);
    }
  }

  async function verifySeedDefaultData() {
    setWorkflowMsg("");
    setBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/dev/seed-default-data/verify`);
      const t = await r.text();
      let j: {
        ok?: boolean;
        detail?: string;
        message?: string;
        status?: string;
        summary?: { ok?: number; warn?: number; error?: number };
        tables?: { table?: string; status?: string; count?: number; requiredMin?: number }[];
        extraChecks?: { key?: string; status?: string; message?: string }[];
        verifySchemaRevision?: number;
        checksPlanned?: number;
      } = {};
      try {
        j = t ? JSON.parse(t) : {};
      } catch {
        throw new Error(t || `HTTP ${r.status}`);
      }
      if (!r.ok || !j.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
      const s = j.summary || {};
      const rows = Array.isArray(j.tables) ? j.tables : [];
      const extras = Array.isArray(j.extraChecks) ? j.extraChecks : [];
      const rev = j.verifySchemaRevision;
      const planned = j.checksPlanned;
      const headerLines: string[] = ["[٥] تقرير التحقق النهائي"];
      if (typeof rev === "number" && typeof planned === "number") {
        headerLines.push(`إصدار v${rev} — ${planned} فحصاً للجداول`);
        if (rows.length < planned) {
          headerLines.push(`تحذير: وصل ${rows.length}/${planned} — غالباً API قديم على 2288.`);
        }
      } else {
        headerLines.push("تحذير: API قديم (لا verifySchemaRevision). أوقف العملية القديمة وشغّل run_api.bat من مجلد المشروع.");
        headerLines.push("OK≈11 بدون MAT3AM_* = خادم قديم أو قاعدة خاطئة.");
      }
      const lines = [
        ...headerLines,
        `${j.status || ""} — OK=${s.ok || 0} WARN=${s.warn || 0} ERR=${s.error || 0}`,
        ...rows.map((x) => `${x.table}: ${x.status} (${x.count ?? "?"})`),
        ...extras.map((x) => `${x.key}: ${x.status}`),
      ];
      setWorkflowMsg(lines.join("\n"));
      await loadLogs();
    } catch (e) {
      const s = String(e);
      setWorkflowMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
    } finally {
      setBusy(false);
    }
  }

  const viteBoot = __MAT3AM_VITE_BOOT_STAMP__;
  const apiBase = getApiBase();

  return (
    <div style={{ maxWidth: 920, direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>اتصال القاعدة والتهيئة</h2>
      <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginTop: -4, lineHeight: 1.5 }}>
        نفّذ الخطوات بالترتيب على قاعدة محلية واحدة. الخطوة ٣ تشمل ما كان يُسمّى «إنشاء/تحديث الجداول» + بذور المطعم وملفات JSON.
      </p>

      <SetupStep
        step={0}
        title="خادم API (قبل SQL)"
        summary="تأكد أنك على مشروع مطاعم الحالي وليس خادماً قديماً على المنفذ 2288."
      >
        <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          الواجهة: <code>{apiBase}</code> · ping:{" "}
          <a href={`${apiBase.replace(/\/$/, "")}/api/ping`} target="_blank" rel="noreferrer">
            /api/ping
          </a>
        </div>
        {viteBoot ? (
          <div style={{ marginTop: 8, fontSize: "0.78rem", color: "var(--muted)" }}>
            Vite: <code>{viteBoot}</code>
          </div>
        ) : null}
        <ApiPingRow apiPing={apiPing} />
        {whoamiText ? (
          <pre style={{ margin: "8px 0 0", fontSize: "0.76rem", overflow: "auto", maxHeight: 120 }}>{whoamiText}</pre>
        ) : null}
        {!whoamiText.includes("MAT3AM_API=1") && whoamiText ? (
          <p style={{ margin: "8px 0 0", fontSize: "0.82rem", color: "#fbbf24" }}>
            تحذير: whoami لا يُظهر MAT3AM_API=1 — غالباً خادم قديم على 2288. أوقف العملية القديمة وشغّل run_full_stack.bat.
          </p>
        ) : null}
      </SetupStep>

      <SetupStep
        step={1}
        title="اتصال SQL Server"
        summary="يُحفظ في config/settings.json. اختبر قبل الحفظ أو بعده."
      >
        <label style={{ display: "block", marginBottom: 4 }}>السيرفر</label>
        <input value={server} onChange={(e) => setServer(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
        <label style={{ display: "block", marginBottom: 4 }}>المنفذ</label>
        <input value={port} onChange={(e) => setPort(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
        <label style={{ display: "block", marginBottom: 4 }}>قاعدة البيانات</label>
        <input value={database} onChange={(e) => setDatabase(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
        <label style={{ display: "block", marginBottom: 4 }}>المستخدم</label>
        <input value={uid} onChange={(e) => setUid(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
        <label style={{ display: "block", marginBottom: 4 }}>كلمة المرور</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", marginBottom: 12 }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void test()}
            disabled={busy || apiPing?.ok === false}
            title={apiPing?.ok === false ? "أصلح الخطوة ٠ أولاً" : undefined}
          >
            ١‑أ اختبار الاتصال
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={busy || apiPing?.ok === false}
            title={apiPing?.ok === false ? "أصلح الخطوة ٠ أولاً" : undefined}
          >
            ١‑ب حفظ الإعدادات
          </button>
          {busy ? <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>…</span> : null}
        </div>
        <StatusBox text={connectionMsg} />
      </SetupStep>

      <SetupStep
        step={2}
        title="تشخيص القاعدة والجداول"
        summary="يقرأ DB_NAME() ووجود جداول MAT3AM — للتأكد أن الخطوات التالية تضرب القاعدة المحلية الصحيحة."
      >
        <button type="button" className="btn btn-primary" onClick={() => void mat3amProbe()} disabled={busy}>
          ٢ تشغيل التشخيص
        </button>
        <ProbeBox text={probeText} />
      </SetupStep>

      <SetupStep
        step={3}
        title="تهيئة التطبيق (كاملة)"
        summary="جداول MAT3AM + أنماط فواتير/مخازن + نسخ ملفات config/restaurant + مستخدمون افتراضيون إن كان MAT3AM_APP_USERS فارغاً. يشمل إنشاء/تحديث الجداول (الزر القديم المنفصل)."
      >
        <button type="button" className="btn btn-primary" onClick={() => void bootstrap()} disabled={busy}>
          ٣ تنفيذ التهيئة الكاملة
        </button>
        <details style={{ marginTop: 10, fontSize: "0.85rem", color: "var(--muted)" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--text)" }}>متقدم: جداول SQL فقط</summary>
          <p style={{ margin: "8px 0" }}>
            نفس DDL بدون بذور TBL أو ملفات JSON — استخدمه فقط لإصلاح جداول ناقصة بعد فشل جزئي.
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => void mat3amEnsureTablesOnly()} disabled={busy}>
            ٣‑م إنشاء/تحديث جداول MAT3AM فقط
          </button>
        </details>
      </SetupStep>

      <SetupStep
        step={4}
        title="بيانات تشغيل TBL (افتراضية)"
        summary="من tbl_seed_pack_v1.json — إن وُجدت أصناف/طاولات في القاعدة لا يُعاد كتابتها (UPSERT للنواقص فقط)."
      >
        <button type="button" className="btn btn-primary" onClick={() => void seedDefaultData()} disabled={busy}>
          ٤ تعبئة البيانات الافتراضية
        </button>
      </SetupStep>

      <SetupStep
        step={5}
        title="تحقق نهائي"
        summary="تقرير ~28 فحصاً (TBL + MAT3AM). إصدار حديث يُرجع verifySchemaRevision=10."
      >
        <button type="button" className="btn btn-primary" onClick={() => void verifySeedDefaultData()} disabled={busy}>
          ٥ تشغيل التحقق
        </button>
      </SetupStep>

      {workflowMsg ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>نتيجة آخر خطوة (٣–٥)</h3>
          <StatusBox text={workflowMsg} />
        </div>
      ) : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>سجل الأخطاء</h3>
          <button type="button" className="btn btn-ghost" onClick={() => void loadLogs()}>
            تحديث
          </button>
        </div>
        {logs.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>لا توجد سجلات.</div>
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
