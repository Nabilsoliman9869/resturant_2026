import { useEffect, useState, type CSSProperties } from "react";
import { safeFetch } from "../../lib/safeFetch";
import { buildMat3amActor } from "../../lib/mat3amActor";
import { useAuth } from "../../auth/AuthContext";
import { getApiBase } from "../../lib/apiBase";

type TelegramOpsSettings = {
  enabled: boolean;
  botTokenConfigured?: boolean;
  botTokenMasked?: string;
  chatIds: string[];
  scheduleEnabled: boolean;
  intervalMinutes: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  attachHallImage: boolean;
  venueLabel: string;
  lastScheduledAt?: string;
  lastSentAt?: string;
  lastError?: string;
};

const DEFAULTS: TelegramOpsSettings = {
  enabled: false,
  chatIds: [],
  scheduleEnabled: true,
  intervalMinutes: 30,
  quietHoursStart: 3,
  quietHoursEnd: 9,
  attachHallImage: true,
  venueLabel: "المطعم",
};

const INTERVAL_PRESETS = [15, 30, 45, 60, 90, 120];

export default function TelegramOpsPulseSettingsPage() {
  const { user } = useAuth();
  const base = getApiBase();
  const [s, setS] = useState<TelegramOpsSettings>(DEFAULTS);
  const [botToken, setBotToken] = useState("");
  const [chatIdsText, setChatIdsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState("");

  const load = async () => {
    try {
      const r = await safeFetch(`${base}/api/settings/telegram-ops-pulse`);
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as TelegramOpsSettings;
      const merged = { ...DEFAULTS, ...j };
      setS(merged);
      setChatIdsText((merged.chatIds || []).join("\n"));
      setBotToken("");
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        enabled: s.enabled,
        scheduleEnabled: s.scheduleEnabled,
        intervalMinutes: s.intervalMinutes,
        quietHoursStart: s.quietHoursStart,
        quietHoursEnd: s.quietHoursEnd,
        attachHallImage: s.attachHallImage,
        venueLabel: s.venueLabel,
        chatIds: chatIdsText
          .split(/[\n,;]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        mat3amActor: buildMat3amActor(user),
      };
      if (botToken.trim()) body.botToken = botToken.trim();
      const r = await safeFetch(`${base}/api/settings/telegram-ops-pulse`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      setMsg("تم الحفظ");
      setBotToken("");
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await safeFetch(`${base}/api/telegram/ops-pulse/send-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "manual", mat3amActor: buildMat3amActor(user) }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
      setMsg("تم إرسال التقرير إلى تليجرام");
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await safeFetch(`${base}/api/telegram/ops-pulse/preview`);
      const j = (await r.json()) as { text?: string; detail?: string };
      if (!r.ok) throw new Error(j.detail || "تعذر المعاينة");
      setPreview(j.text || "");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ direction: "rtl", padding: "0.5rem 0.25rem 2rem", maxWidth: 760 }}>
      <h2 style={{ margin: "0 0 6px" }}>تليجرام — نبض التشغيل</h2>
      <p style={{ color: "var(--muted)", fontSize: ".9rem", marginTop: 0 }}>
        تقرير مرتب للصالة والمطبخ والدليفري والكباتن + صورة شبكة الطاولات. جدولة تلقائية أو طلب فوري من البوت.
      </p>

      <section style={{ ...card, background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.35)" }}>
        <h3 style={h3}>كيف تطلب التقرير من تليجرام (في أي وقت)</h3>
        <p style={{ margin: "0 0 8px", fontSize: ".88rem", lineHeight: 1.65 }}>
          افتح البوت واكتب أحد الأوامر — <strong>لا تنتظر الجدولة</strong>:
        </p>
        <ul style={{ margin: 0, paddingInlineStart: "1.2rem", fontSize: ".86rem", lineHeight: 1.7 }}>
          <li><code>التقرير</code> أو <code>/report</code> — التقرير الكامل + صورة الطاولات</li>
          <li><code>صالة</code> أو <code>/hall</code> — الصالة وصورة الشبكة فقط</li>
          <li><code>مطبخ</code> · <code>دليفري</code> — أقسام منفصلة</li>
          <li><code>/help</code> — قائمة الأوامر</li>
        </ul>
      </section>

      <section style={card}>
        <h3 style={h3}>1) التفعيل والبوت</h3>
        <label style={row}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          تفعيل تكامل تليجرام
        </label>
        <label style={row}>
          <input
            type="checkbox"
            checked={s.attachHallImage}
            onChange={(e) => setS({ ...s, attachHallImage: e.target.checked })}
          />
          إرفاق صورة شبكة الطاولات (ملونة حسب الحالة)
        </label>
        <label style={{ display: "block", marginTop: 10 }}>
          اسم يظهر في التقرير
          <input
            style={input}
            value={s.venueLabel}
            onChange={(e) => setS({ ...s, venueLabel: e.target.value })}
            placeholder="المطعم"
          />
        </label>
        <label style={{ display: "block", marginTop: 10 }}>
          Bot Token (من @BotFather)
          <input
            style={input}
            type="password"
            autoComplete="off"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={s.botTokenConfigured ? `محفوظ: ${s.botTokenMasked || "***"}` : "123456:ABC…"}
          />
        </label>
        <label style={{ display: "block", marginTop: 10 }}>
          Chat IDs (سطر لكل مالك/مدير) — يُسجَّل تلقائياً عند أول /start إن كانت القائمة فارغة
          <textarea
            style={{ ...input, minHeight: 80, fontFamily: "ui-monospace, monospace" }}
            value={chatIdsText}
            onChange={(e) => setChatIdsText(e.target.value)}
            placeholder={"123456789"}
          />
        </label>
      </section>

      <section style={card}>
        <h3 style={h3}>2) مدة التقرير التلقائي</h3>
        <label style={row}>
          <input
            type="checkbox"
            checked={s.scheduleEnabled}
            onChange={(e) => setS({ ...s, scheduleEnabled: e.target.checked })}
          />
          إرسال تلقائي دوري
        </label>
        <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: "8px 0" }}>اختر المدة بين التقارير:</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {INTERVAL_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={s.intervalMinutes === m ? "btn btn-primary" : "btn"}
              onClick={() => setS({ ...s, intervalMinutes: m })}
            >
              كل {m} د
            </button>
          ))}
        </div>
        <label>
          أو أدخل يدوياً (5–180 دقيقة)
          <input
            style={input}
            type="number"
            min={5}
            max={180}
            value={s.intervalMinutes}
            onChange={(e) => setS({ ...s, intervalMinutes: Number(e.target.value) || 30 })}
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <label>
            صمت الجدولة من ساعة
            <input
              style={input}
              type="number"
              min={0}
              max={23}
              value={s.quietHoursStart}
              onChange={(e) => setS({ ...s, quietHoursStart: Number(e.target.value) })}
            />
          </label>
          <label>
            صمت حتى ساعة
            <input
              style={input}
              type="number"
              min={0}
              max={23}
              value={s.quietHoursEnd}
              onChange={(e) => setS({ ...s, quietHoursEnd: Number(e.target.value) })}
            />
          </label>
        </div>
        <p style={{ fontSize: ".8rem", color: "var(--muted)" }}>
          ساعات الصمت توقف <strong>الجدولة فقط</strong> — طلبك اليدوي من التليجرام يعمل دائماً.
          <br />
          آخر إرسال: {s.lastSentAt || "—"} · آخر جدولة: {s.lastScheduledAt || "—"}
          {s.lastError ? ` · خطأ: ${s.lastError}` : ""}
        </p>
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          حفظ
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void loadPreview()}>
          معاينة النص
        </button>
        <button type="button" className="btn" disabled={busy || !s.enabled} onClick={() => void sendNow()}>
          إرسال الآن
        </button>
      </div>
      {msg ? <p style={{ color: "#6ee7b7" }}>{msg}</p> : null}
      {err ? <p style={{ color: "var(--danger)" }}>{err}</p> : null}
      {preview ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "rgba(15,23,42,0.65)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 12,
            fontSize: ".85rem",
          }}
        >
          {preview}
        </pre>
      ) : null}
    </div>
  );
}

const card: CSSProperties = {
  marginBottom: 14,
  padding: "0.9rem 1rem",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.03)",
};
const h3: CSSProperties = { margin: "0 0 8px", fontSize: "1rem" };
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginTop: 6 };
const input: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "0.45rem 0.55rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "rgba(15,23,42,0.55)",
  color: "inherit",
  boxSizing: "border-box",
};
