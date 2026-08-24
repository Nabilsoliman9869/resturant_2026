import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import { safeFetch } from "../../lib/safeFetch";
import SettingRow from "../../components/SettingRow";

type TwinCfg = {
  alias?: string;
  dailySavePath: string;
  server: string;
  port: number | null;
  database: string;
  uid: string;
  password: string;
  bootstrapDone?: boolean;
  bootstrapAt?: string | null;
  bootstrapError?: string | null;
  syncEnabled?: boolean;
  delayHours?: number;
  lastParentBatchId?: number;
  lastTwinConfirmedBatchId?: number;
  cutoverAt?: string | null;
};

const empty: TwinCfg = {
  dailySavePath: "",
  server: "",
  port: null,
  database: "",
  uid: "",
  password: "",
  syncEnabled: true,
};

export default function TaxTwinDailySaveSettingsPage() {
  const base = getApiBase();
  const [cfg, setCfg] = useState<TwinCfg>(empty);
  const [alias, setAlias] = useState("مسار الحفظ اليومي");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await safeFetch(`${base}/api/settings/tax-twin`);
      const j = (await r.json()) as {
        ok?: boolean;
        alias?: string;
        cfg?: TwinCfg;
      };
      if (j.alias) setAlias(j.alias);
      if (j.cfg) {
        setCfg({
          ...empty,
          ...j.cfg,
          password: "",
        });
      }
    } catch (e) {
      setMsg(String(e));
    }
  }

  useEffect(() => {
    void load();
  }, [base]);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const body: Record<string, unknown> = {
        dailySavePath: cfg.dailySavePath,
        server: cfg.server,
        port: cfg.port,
        database: cfg.database,
        uid: cfg.uid,
        syncEnabled: cfg.syncEnabled !== false,
      };
      if (cfg.password.trim()) body.password = cfg.password;
      const r = await safeFetch(`${base}/api/settings/tax-twin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        detail?: string;
        bootstrapped?: boolean;
        cfg?: TwinCfg;
        bootstrap?: { steps?: string[]; bakPath?: string };
      };
      if (j.cfg) {
        setCfg((prev) => ({
          ...prev,
          ...j.cfg,
          password: "",
        }));
      }
      if (j.ok && j.bootstrapped) {
        setMsg(
          `تم الحفظ وتهيئة التوأم بنجاح.${j.bootstrap?.bakPath ? ` النسخة: ${j.bootstrap.bakPath}` : ""}`,
        );
      } else if (j.ok) {
        setMsg("تم الحفظ. التوأم مهيأ مسبقاً — المزامنة تعمل وفق القواعد المتفق عليها.");
      } else {
        setMsg(j.detail || "حُفظ الإعداد لكن التهيئة/الاتصال لم يكتمل.");
      }
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function testConn() {
    setBusy(true);
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/settings/tax-twin/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailySavePath: cfg.dailySavePath,
          server: cfg.server,
          port: cfg.port,
          database: cfg.database,
          uid: cfg.uid,
          ...(cfg.password.trim() ? { password: cfg.password } : {}),
        }),
      });
      const j = (await r.json()) as { ok?: boolean; detail?: string; twinExists?: boolean };
      setMsg(
        j.ok
          ? `الاتصال ناجح — قاعدة التوأم ${j.twinExists ? "موجودة" : "غير موجودة بعد (ستُنشأ عند التهيئة)"}.`
          : j.detail || "فشل الاختبار",
      );
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function forceBootstrap() {
    const ok = window.confirm(
      "إعادة تهيئة التوأم؟\nسيتم أخذ نسخة من قاعدة الأم واستعادتها على قاعدة التوأم (مع استبدال إن وُجدت).",
    );
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/settings/tax-twin/bootstrap`, { method: "POST" });
      const j = (await r.json()) as { ok?: boolean; detail?: string };
      setMsg(j.ok ? "اكتملت إعادة التهيئة." : j.detail || "فشلت التهيئة");
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runPublisher() {
    setBusy(true);
    setMsg("");
    try {
      const r = await safeFetch(`${base}/api/settings/tax-twin/run-publisher`, { method: "POST" });
      const j = (await r.json()) as {
        ok?: boolean;
        detail?: string;
        sentBatches?: number[];
        eligible?: number;
        twinConfirmed?: number;
        parentBatch?: number;
      };
      if (!j.ok) {
        setMsg(j.detail || "فشل الناشر");
      } else {
        setMsg(
          `ناشر الدفعات: مؤكد توأم=${j.twinConfirmed ?? "—"} · أم=${j.parentBatch ?? "—"} · مستحق=${j.eligible ?? 0} · أُرسل: ${(j.sentBatches || []).join(", ") || "لا شيء"}`,
        );
      }
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{alias}</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.65, maxWidth: 720 }}>
        مسار قاعدة البيانات الوليدة (التوأم الضريبي). عند أول حفظ بعد نجاح الاتصال يُؤخذ نسخة من قاعدة الأم
        وتُستعاد على SQL التوأم تحت هذا المسار، ثم تُفعَّل مزامنة الثوابت ودفعات الفواتير الضريبية (بعد السداد بـ{" "}
        {cfg.delayHours ?? 6} ساعات، مع إعادة ملء الفجوات برقم الدفعة).
      </p>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <SettingRow
          label={alias}
          tooltip="مجلد على سيرفر SQL تُحفظ فيه ملفات .bak وملفات بيانات قاعدة التوأم (.mdf/.ldf). يجب أن تملك خدمة SQL صلاحية الكتابة عليه."
        >
          <input
            value={cfg.dailySavePath}
            onChange={(e) => setCfg((s) => ({ ...s, dailySavePath: e.target.value }))}
            style={{ width: "100%" }}
            placeholder="مثال: D:\Mat3amTaxTwin"
            dir="ltr"
          />
        </SettingRow>

        <SettingRow label="اسم قاعدة التوأم" tooltip="قاعدة SQL منفصلة عن الأم — افتراضياً اسم_الأم_TAX">
          <input
            value={cfg.database}
            onChange={(e) => setCfg((s) => ({ ...s, database: e.target.value }))}
            style={{ width: "100%" }}
            dir="ltr"
          />
        </SettingRow>

        <SettingRow label="سيرفر SQL (توأم)" tooltip="غالباً نفس سيرفر الأم. يُورث من اتصال القاعدة إن تُرك فارغاً عند الحفظ.">
          <input
            value={cfg.server}
            onChange={(e) => setCfg((s) => ({ ...s, server: e.target.value }))}
            style={{ width: "100%" }}
            dir="ltr"
          />
        </SettingRow>

        <SettingRow label="المنفذ" tooltip="اختياري — مثال 1433">
          <input
            type="number"
            value={cfg.port ?? ""}
            onChange={(e) =>
              setCfg((s) => ({
                ...s,
                port: e.target.value === "" ? null : Number(e.target.value) || null,
              }))
            }
            style={{ width: "100%" }}
            dir="ltr"
          />
        </SettingRow>

        <SettingRow label="المستخدم">
          <input
            value={cfg.uid}
            onChange={(e) => setCfg((s) => ({ ...s, uid: e.target.value }))}
            style={{ width: "100%" }}
            dir="ltr"
            autoComplete="off"
          />
        </SettingRow>

        <SettingRow label="كلمة المرور" tooltip="اتركها فارغة للإبقاء على المحفوظة.">
          <input
            type="password"
            value={cfg.password}
            onChange={(e) => setCfg((s) => ({ ...s, password: e.target.value }))}
            style={{ width: "100%" }}
            dir="ltr"
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </SettingRow>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
        <input
          type="checkbox"
          checked={cfg.syncEnabled !== false}
          onChange={(e) => setCfg((s) => ({ ...s, syncEnabled: e.target.checked }))}
        />
        <span>تفعيل المزامنة والناشر بعد التهيئة</span>
      </label>

      <div
        style={{
          marginTop: 16,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "rgba(0,0,0,0.03)",
          fontSize: "0.88rem",
          lineHeight: 1.6,
        }}
      >
        <div>
          حالة التهيئة:{" "}
          <strong style={{ color: cfg.bootstrapDone ? "#16a34a" : "#b45309" }}>
            {cfg.bootstrapDone ? "جاهز" : "لم تكتمل"}
          </strong>
          {cfg.bootstrapAt ? ` · ${cfg.bootstrapAt}` : ""}
        </div>
        {cfg.bootstrapError ? (
          <div style={{ color: "#b91c1c", marginTop: 6 }}>آخر خطأ: {cfg.bootstrapError}</div>
        ) : null}
        <div style={{ marginTop: 6, color: "var(--muted)" }}>
          دفعات: أم={cfg.lastParentBatchId ?? 0} · توأم مؤكد={cfg.lastTwinConfirmedBatchId ?? 0}
          {cfg.cutoverAt ? ` · قطع التشغيل ${cfg.cutoverAt}` : ""}
        </div>
      </div>

      <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "جاري…" : "حفظ وتهيئة عند الحاجة"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void testConn()}>
          اختبار الاتصال
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void forceBootstrap()}>
          إعادة تهيئة التوأم
        </button>
        <button type="button" className="btn" disabled={busy || !cfg.bootstrapDone} onClick={() => void runPublisher()}>
          تشغيل ناشر الدفعات الآن
        </button>
      </div>

      {msg ? (
        <p style={{ marginTop: 14, color: "var(--accent2)", whiteSpace: "pre-wrap" }} role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
