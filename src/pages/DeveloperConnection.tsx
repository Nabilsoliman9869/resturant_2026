import { useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";
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
  return `تعذر الاتصال بـ API (${getApiBase()}).`;
}

export default function DeveloperConnection() {
  const { bumpDbEpoch } = useDbSettingsRefresh();
  const [server, setServer] = useState("");
  const [port, setPort] = useState<string>("");
  const [database, setDatabase] = useState("");
  const [uid, setUid] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<DevLog[]>([]);
  const [whoamiText, setWhoamiText] = useState<string>("");
  const [probeText, setProbeText] = useState("");

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
      .catch(() => setMsg(apiUnreachable()));
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
      setMsg("تم الحفظ.");
      bumpDbEpoch();
    } catch (e) {
      const s = String(e);
      setMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
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
        setMsg(`HTTP ${r.status}`);
        return;
      }
      if (!r.ok) {
        setMsg(j.detail || `HTTP ${r.status}`);
        return;
      }
      setMsg(j.ok ? "الاتصال ناجح." : j.detail || JSON.stringify(j));
    } catch (e) {
      const s = String(e);
      setMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
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
      const tbl = Array.isArray(j.tables) ? j.tables.join(", ") : "—";
      const n = typeof j.defaultAppUsersInserted === "number" ? j.defaultAppUsersInserted : null;
      const usersLine =
        n != null && n > 0 ? ` — مستخدمون افتراضيون: ${n}.` : n === 0 ? " — لم يُدرَج مستخدمون افتراضيون." : "";
      setMsg(`تهيئة: ${tbl}${usersLine}`);
      bumpDbEpoch();
      await loadSettings();
      await loadLogs();
    } catch (e) {
      const s = String(e);
      setMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
    } finally {
      setBusy(false);
    }
  }

  async function seedDefaultData() {
    setMsg("");
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
          ? `قاعدة: TBL005=${fd.TBL005?.rowCount ?? "—"} مركز، TBL006=${fd.TBL006?.rowCount ?? "—"} مجموعة، TBL007=${fd.TBL007?.totalProducts ?? "—"} صنف (${fd.TBL007?.distinctActiveGroups ?? "—"} مجموعة بها أصناف نشطة)`
          : "";
      const lines = Object.keys(out).map((k) => {
        const s = out[k] as {
          source?: string;
          snapshot?: {
            rowCount?: number;
            totalProducts?: number;
            distinctActiveGroups?: number;
            error?: string;
          };
          inserted?: number;
          updated?: number;
          skipped?: number;
          errors?: unknown[];
        };
        if (s.source === "database") {
          const sn = s.snapshot;
          if (k === "TBL007" && sn && typeof sn.totalProducts === "number") {
            return `${k}: من القاعدة — ${sn.totalProducts} صنف، ${sn.distinctActiveGroups ?? "?"} مجموعة (أصناف نشطة)`;
          }
          if (sn?.error) return `${k}: من القاعدة — خطأ ${sn.error}`;
          if (sn && typeof sn.rowCount === "number") return `${k}: من القاعدة — ${sn.rowCount} صف`;
          return `${k}: من القاعدة (لقطة)`;
        }
        const errs = Array.isArray(s.errors) ? s.errors.length : 0;
        return `${k}: +${s.inserted || 0} / ~${s.updated || 0} / =${s.skipped || 0}${errs ? ` / !${errs}` : ""}`;
      });
      const head = [j.masterDataNote ? String(j.masterDataNote) : "", summaryDb].filter(Boolean).join("\n");
      setMsg(`Seed ${j.seedVersion || ""}${head ? `\n${head}` : ""}\n${lines.join("\n")}`);
      bumpDbEpoch();
      await loadLogs();
    } catch (e) {
      const s = String(e);
      setMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
    } finally {
      setBusy(false);
    }
  }

  async function mat3amProbe() {
    setProbeText("");
    setBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/dev/mat3am-schema-probe`);
      const j = await r.json();
      setProbeText(JSON.stringify(j, null, 2));
    } catch (e) {
      setProbeText(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function mat3amEnsure() {
    setProbeText("");
    setBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/dev/mat3am-schema-ensure`, { method: "POST" });
      const t = await r.text();
      if (!r.ok) {
        setProbeText(t || `HTTP ${r.status}`);
        return;
      }
      try {
        setProbeText(JSON.stringify(JSON.parse(t), null, 2));
      } catch {
        setProbeText(t || `HTTP ${r.status}`);
      }
      bumpDbEpoch();
    } catch (e) {
      setProbeText(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function verifySeedDefaultData() {
    setMsg("");
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
      const headerLines: string[] = [];
      if (typeof rev === "number" && typeof planned === "number") {
        headerLines.push(`تقرير التحقق v${rev} — ${planned} فحصاً للجداول (ثم فحوص إضافية في الأسفل)`);
        if (rows.length < planned) {
          headerLines.push(
            `تحذير: وصل ${rows.length} صفاً بينما المتوقع ${planned} — راجع اتصال الـ API أو أعد تشغيل الخادم.`,
          );
        }
      } else {
        headerLines.push(
          "تحذير: خادم API قديم (لا يُرجع verifySchemaRevision/checksPlanned). أعد تشغيل api_server من مجلد المشروع أو أعد بناء EXE.",
        );
        headerLines.push(
          "إن كان الملخص OK≈11 ولا تظهر صفوف MAT3AM_* فالعملية القديمة لا تزال تعمل على المنفذ 2288.",
        );
      }
      const lines = [
        ...headerLines,
        `${j.status || ""} — OK=${s.ok || 0} WARN=${s.warn || 0} ERR=${s.error || 0}`,
        ...rows.map((x) => `${x.table}: ${x.status} (${x.count ?? "?"})`),
        ...extras.map((x) => `${x.key}: ${x.status}`),
      ];
      setMsg(lines.join("\n"));
      await loadLogs();
    } catch (e) {
      const s = String(e);
      setMsg(s.includes("Failed to fetch") || s.includes("NetworkError") ? apiUnreachable() : s);
    } finally {
      setBusy(false);
    }
  }

  const viteBoot = __MAT3AM_VITE_BOOT_STAMP__;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>اتصال القاعدة والتهيئة</h2>
      <div className="card" style={{ marginBottom: 12, padding: "10px 12px", fontSize: "0.85rem", color: "var(--muted)" }}>
        <code>{viteBoot || "—"}</code>
        {whoamiText ? (
          <pre style={{ margin: "8px 0 0", fontSize: "0.78rem", overflow: "auto" }}>{whoamiText}</pre>
        ) : null}
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>قاعدة البيانات</h3>
          <label style={{ display: "block", marginBottom: 4 }}>السيرفر</label>
          <input value={server} onChange={(e) => setServer(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
          <label style={{ display: "block", marginBottom: 4 }}>المنفذ</label>
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
              اختبار
            </button>
            {busy ? <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>…</span> : null}
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
            {msg}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>تهيئة</h3>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
            إن رأيت في «تحقق» OK≈11 فقط بدون صفوف MAT3AM_* فغالباً تعمل نسخة قديمة من الخادم على 2288 — أوقفها وشغّل{" "}
            <code>run_api.bat</code> من مجلد المشروع، ثم استخدم «تشخيص جداول MAT3AM» أدناه.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void bootstrap()} disabled={busy}>
            تنفيذ التهيئة
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void seedDefaultData()} disabled={busy} style={{ marginInlineStart: 8 }}>
            بيانات افتراضية
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void verifySeedDefaultData()} disabled={busy} style={{ marginInlineStart: 8 }}>
            تحقق
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void mat3amProbe()} disabled={busy} style={{ marginInlineStart: 8 }}>
            تشخيص جداول MAT3AM
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void mat3amEnsure()} disabled={busy} style={{ marginInlineStart: 8 }}>
            إنشاء/تحديث الجداول
          </button>
        </div>
      </div>

      {probeText ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>تشخيص القاعدة الفعلية (ما يراه هذا الخادم)</h3>
          <pre
            style={{
              fontSize: "0.78rem",
              overflow: "auto",
              maxHeight: 420,
              margin: 0,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "rgba(15, 23, 42, 0.35)",
            }}
          >
            {probeText}
          </pre>
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
