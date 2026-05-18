import { useEffect, useState } from "react";
import { safeFetch } from "../../lib/safeFetch";
import { buildMat3amActor } from "../../lib/mat3amActor";
import { useAuth } from "../../auth/AuthContext";
import { useTerminalLock } from "../../context/TerminalLockContext";
import { getTerminalId } from "../../lib/terminalSession";
import { getApiBase } from "../../lib/apiBase";

type Settings = {
  sharedTerminalEnabled: boolean;
  // Hybrid v2:
  slidingRefreshAfterAction: boolean;
  stepUpForDangerOps: boolean;
  hardLogoutMinutes: number;
  // Idle window:
  idleLockMinutes: number;
  // Classic mode (تُستخدم فقط عندما slidingRefreshAfterAction = false):
  lockAfterSave: boolean;
  lockAfterEdit: boolean;
  lockAfterSend: boolean;
  lockAfterDelete: boolean;
  lockAfterDiscount: boolean;
  lockAfterReturn: boolean;
  // Lockout policy:
  maxAttemptsBeforeLockout: number;
  lockoutSeconds: number;
  tokenTtlSeconds: number;
  updatedAt?: string;
  updatedBy?: string;
};

type SensitiveRoute = { method: string; path: string; label: string };
type AuditRow = {
  at: string | null;
  terminalId: string;
  login: string;
  oldUserId: string;
  newUserId: string;
  action: string;
  reason: string;
  ip: string;
};

const DEFAULTS: Settings = {
  sharedTerminalEnabled: false,
  slidingRefreshAfterAction: true,
  stepUpForDangerOps: true,
  hardLogoutMinutes: 10,
  idleLockMinutes: 2,
  lockAfterSave: false,
  lockAfterEdit: false,
  lockAfterSend: false,
  lockAfterDelete: false,
  lockAfterDiscount: false,
  lockAfterReturn: false,
  maxAttemptsBeforeLockout: 3,
  lockoutSeconds: 30,
  tokenTtlSeconds: 900,
};

export default function SharedTerminalSettingsPage() {
  const { user } = useAuth();
  const { refreshSettings, lockTerminal } = useTerminalLock();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [orig, setOrig] = useState<Settings>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [routes, setRoutes] = useState<SensitiveRoute[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const tid = getTerminalId();
  const base = getApiBase();

  const dirty = JSON.stringify(s) !== JSON.stringify(orig);
  const isHybrid = s.slidingRefreshAfterAction;

  const load = async () => {
    try {
      const r = await safeFetch(`${base}/api/settings/shared-terminal`);
      if (r.ok) {
        const j = (await r.json()) as Settings;
        const merged = { ...DEFAULTS, ...j };
        setS(merged);
        setOrig(merged);
      }
    } catch { /* تجاهل */ }
    try {
      const r2 = await safeFetch(`${base}/api/terminal/sensitive-routes`);
      if (r2.ok) {
        const j2 = (await r2.json()) as { routes: SensitiveRoute[] };
        setRoutes(j2.routes || []);
      }
    } catch { /* تجاهل */ }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const r = await safeFetch(`${base}/api/terminal/audit?limit=50`);
      if (r.ok) {
        const j = (await r.json()) as { audit: AuditRow[] };
        setAudit(j.audit || []);
      }
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await safeFetch(`${base}/api/settings/shared-terminal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...s, mat3amActor: buildMat3amActor(user) }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as Settings;
      const merged = { ...DEFAULTS, ...j };
      setS(merged);
      setOrig(merged);
      setMsg("تم الحفظ");
      await refreshSettings();
      // لو فُعِّل الوضع الآن — اقفل فوراً لإلزام إدخال PIN
      if (merged.sharedTerminalEnabled) lockTerminal("manual");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ direction: "rtl", padding: "0.5rem 0.25rem 2rem" }}>
      <h2 style={{ margin: 0, marginBottom: 6 }}>إعدادات تشغيل نقطة البيع</h2>
      <div style={{ color: "var(--muted)", fontSize: ".9rem", marginBottom: 14 }}>
        تتحكم في وضع <strong>الجهاز المشترك</strong> ونمط القفل (هجين منزلق أو قفل بعد كل عملية).
        الجهاز الحالي: <code>{tid}</code>
      </div>
      <div
        style={{
          marginBottom: 14,
          padding: "0.75rem 1rem",
          borderRadius: 8,
          background: "rgba(80,160,255,0.08)",
          border: "1px solid rgba(80,160,255,0.35)",
          fontSize: ".88rem",
          color: "var(--text)",
        }}
      >
        <strong>ملاحظة — دور المطوّر:</strong> لا يُعرض overlay الـ PIN ولا يُطلب{" "}
        <code>terminalToken</code> على السيرفر (للتهيئة: اتصال SQL، الجداول، المستخدمين).
        باقي الأدوار تحتاج PIN في <strong>إدارة المستخدمين</strong> عند تفعيل «جهاز مشترك».
      </div>

      <section style={card}>
        <h3 style={h3}>1) طريقة استخدام نقطة البيع</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <RadioCard
            checked={s.sharedTerminalEnabled === false}
            onChange={() => setS({ ...s, sharedTerminalEnabled: false })}
            title="جهاز مستقل لكل مستخدم"
            desc="جلسة دخول عادية. لا overlay قفل. مناسب للأجهزة الشخصية أو المكتبية."
          />
          <RadioCard
            checked={s.sharedTerminalEnabled === true}
            onChange={() => setS({ ...s, sharedTerminalEnabled: true })}
            title="جهاز مشترك بين كل الجرسونات"
            desc="يُلزم تأكيد بـ PIN قبل العمليات الحسّاسة وعند الخمول وتبديل المستخدم."
            danger
          />
        </div>
      </section>

      {s.sharedTerminalEnabled ? (
        <>
          <section style={card}>
            <h3 style={h3}>2) نمط القفل</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <RadioCard
                checked={isHybrid}
                onChange={() => setS({ ...s, slidingRefreshAfterAction: true })}
                title="هجين منزلق ★ (موصى به)"
                desc={
                  <>
                    العمليات الروتينية (إرسال طلب، فتح جلسة) <strong>لا تقفل</strong> ولكنها تُجدّد عدّاد الخمول.
                    <br/>العمليات الخطرة (خصم، مرتجع، تعديل ميني-موم) تطلب PIN فوري في مكانها (Step-Up).
                    <br/>الخمول الطويل = قفل overlay، الإهمال الأطول = خروج كامل.
                  </>
                }
              />
              <RadioCard
                checked={!isHybrid}
                onChange={() => setS({ ...s, slidingRefreshAfterAction: false })}
                title="قفل بعد كل عملية (كلاسيكي)"
                desc="يطلب PIN كامل بعد كل حفظ/إرسال/تعديل/حذف/خصم/مرتجع. أعلى أماناً، أعلى احتكاكاً في الذروة."
                danger
              />
            </div>
          </section>

          {isHybrid ? (
            <section style={card}>
              <h3 style={h3}>3) إعدادات النمط الهجين</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <NumField label="نافذة الخمول (دقيقة) — قبل overlay" min={1} max={60} value={s.idleLockMinutes}
                  onChange={(v) => setS({ ...s, idleLockMinutes: v })}
                  hint="بدون أي عملية ولا حركة لمدة هذه الدقائق ⇒ overlay قفل" />
                <NumField label="خروج كامل (دقيقة) — تسجيل خروج" min={1} max={240} value={s.hardLogoutMinutes}
                  onChange={(v) => setS({ ...s, hardLogoutMinutes: v })}
                  hint="بعد الإهمال الكامل ⇒ يخرج المستخدم من التطبيق نهائياً" />
                <NumField label="مدّة «حداثة» الـ PIN (TTL ث)" min={60} max={7200} value={s.tokenTtlSeconds}
                  onChange={(v) => setS({ ...s, tokenTtlSeconds: v })}
                  hint="خلال أوّل 60 ثانية من PIN ناجح، الزر الخطر التالي ينفّذ بدون إعادة طلب PIN" />
              </div>
              <div style={{ marginTop: 12 }}>
                <Switch label="Step-Up للعمليات الخطرة (PIN داخل الزر للخصم/المرتجع/تعديل ميني-موم/حذف بند)"
                  checked={s.stepUpForDangerOps}
                  onChange={(v) => setS({ ...s, stepUpForDangerOps: v })} />
                <div style={{ color: "var(--muted)", fontSize: ".82rem", marginTop: 6 }}>
                  لو أوقفته ⇒ كل العمليات الخطرة تحتاج PIN كامل (overlay) أو تعتمد فقط على نافذة الخمول.
                </div>
              </div>
            </section>
          ) : (
            <section style={card}>
              <h3 style={h3}>3) محفّزات القفل (نمط كلاسيكي)</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Switch label="بعد كل حفظ"           checked={s.lockAfterSave}     onChange={(v) => setS({ ...s, lockAfterSave: v })} />
                <Switch label="بعد كل تعديل"          checked={s.lockAfterEdit}     onChange={(v) => setS({ ...s, lockAfterEdit: v })} />
                <Switch label="بعد كل إرسال للمطبخ"   checked={s.lockAfterSend}     onChange={(v) => setS({ ...s, lockAfterSend: v })} />
                <Switch label="بعد كل حذف"            checked={s.lockAfterDelete}   onChange={(v) => setS({ ...s, lockAfterDelete: v })} />
                <Switch label="بعد كل خصم"            checked={s.lockAfterDiscount} onChange={(v) => setS({ ...s, lockAfterDiscount: v })} />
                <Switch label="بعد كل مرتجع"          checked={s.lockAfterReturn}   onChange={(v) => setS({ ...s, lockAfterReturn: v })} />
              </div>
              <div style={{ height: 12 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <NumField label="نافذة الخمول (دقيقة)" min={1} max={60} value={s.idleLockMinutes}
                  onChange={(v) => setS({ ...s, idleLockMinutes: v })} />
                <NumField label="خروج كامل (دقيقة)" min={1} max={240} value={s.hardLogoutMinutes}
                  onChange={(v) => setS({ ...s, hardLogoutMinutes: v })} />
                <NumField label="صلاحية الـ Token (ث)" min={60} max={7200} value={s.tokenTtlSeconds}
                  onChange={(v) => setS({ ...s, tokenTtlSeconds: v })} />
              </div>
            </section>
          )}

          <section style={card}>
            <h3 style={h3}>4) سياسة محاولات PIN</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <NumField label="عدد المحاولات قبل قفل مؤقّت" min={1} max={20} value={s.maxAttemptsBeforeLockout}
                onChange={(v) => setS({ ...s, maxAttemptsBeforeLockout: v })} />
              <NumField label="مدّة القفل بعد الفشل (ث)" min={5} max={900} value={s.lockoutSeconds}
                onChange={(v) => setS({ ...s, lockoutSeconds: v })} />
            </div>
          </section>
        </>
      ) : null}

      <section style={card}>
        <h3 style={h3}>المسارات المؤمَّنة في الباك-إند</h3>
        <div style={{ color: "var(--muted)", fontSize: ".85rem", marginBottom: 8 }}>
          هذه المسارات ترفض الطلب على السيرفر إذا لم يصلها <code>terminalToken</code> صالح وكان وضع الجهاز المشترك مفعَّلاً.
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {routes.map((r) => (
            <div key={`${r.method} ${r.path}`} style={{ display: "grid", gridTemplateColumns: "70px 1fr 220px", gap: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
              <code style={{ color: "#7fc7ff" }}>{r.method}</code>
              <code style={{ color: "#cfd9f3" }}>{r.path}</code>
              <span style={{ color: "var(--muted)" }}>{r.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ ...h3, marginBottom: 0 }}>سجل تدقيق الـ PIN (آخر 50)</h3>
          <button type="button" className="btn btn-ghost" onClick={() => void loadAudit()} disabled={auditLoading}>
            {auditLoading ? "تحميل…" : "تحديث"}
          </button>
        </div>
        <div style={{ marginTop: 8, maxHeight: 300, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
            <thead style={{ position: "sticky", top: 0, background: "rgba(0,0,0,0.5)" }}>
              <tr>
                <th style={th}>الوقت</th>
                <th style={th}>الجهاز</th>
                <th style={th}>المستخدم</th>
                <th style={th}>الحدث</th>
                <th style={th}>السبب</th>
                <th style={th}>IP</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 10, color: "var(--muted)", textAlign: "center" }}>— لا سجلات —</td></tr>
              ) : (
                audit.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{r.at ? r.at.replace("T", " ").slice(0, 19) : ""}</td>
                    <td style={td}><code>{r.terminalId}</code></td>
                    <td style={td}>{r.login || r.newUserId || r.oldUserId || "—"}</td>
                    <td style={{ ...td, color: r.action === "pin_ok" ? "#7fffa3" : r.action === "pin_fail" ? "#ff9c9c" : "#ffd28a" }}>{r.action}</td>
                    <td style={td}>{r.reason || ""}</td>
                    <td style={td}>{r.ip || ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
          style={{ padding: "0.6rem 1.4rem", fontWeight: 700 }}
        >
          {busy ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
        </button>
        {!dirty ? <span style={{ color: "var(--muted)", fontSize: ".85rem" }}>لا تغييرات للحفظ</span> : null}
        {msg ? <span style={{ color: "#7fffa3", fontSize: ".9rem" }}>{msg}</span> : null}
        {err ? <span style={{ color: "#ff9c9c", fontSize: ".9rem" }}>{err}</span> : null}
        {orig.updatedAt ? (
          <span style={{ marginInlineStart: "auto", color: "var(--muted)", fontSize: ".82rem" }}>
            آخر تحديث: {orig.updatedAt.replace("T", " ").slice(0, 19)} {orig.updatedBy ? ` — بواسطة ${orig.updatedBy}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "0.9rem 1rem",
  marginBottom: 14,
};
const h3: React.CSSProperties = { margin: 0, marginBottom: 10, fontSize: "1rem" };
const th: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontWeight: 700, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "6px 10px" };

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.45rem 0.6rem", background: "rgba(255,255,255,0.03)", borderRadius: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function NumField({ label, value, onChange, min, max, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; hint?: string }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: ".85rem", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : value);
        }}
        style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
      />
      {hint ? <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: 4 }}>{hint}</div> : null}
    </label>
  );
}

function RadioCard({ checked, onChange, title, desc, danger }: { checked: boolean; onChange: () => void; title: string; desc: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        textAlign: "right",
        padding: "0.9rem 1rem",
        background: checked ? (danger ? "rgba(255,80,80,0.10)" : "rgba(80,160,255,0.12)") : "rgba(255,255,255,0.04)",
        border: checked ? (danger ? "1px solid rgba(255,80,80,0.55)" : "1px solid rgba(80,160,255,0.55)") : "1px solid var(--border)",
        borderRadius: 10,
        cursor: "pointer",
        color: "var(--text)",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <input type="radio" checked={checked} onChange={onChange} />
        <strong>{title}</strong>
      </div>
      <div style={{ fontSize: ".82rem", color: "var(--muted)" }}>{desc}</div>
    </button>
  );
}
