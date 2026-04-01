import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS, ROLE_ROUTES, type RoleId } from "../auth/roles";
import type { SessionUser } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { checkApiReadyAfterLogin } from "../lib/postLoginHealth";

const ROLE_SET = new Set<RoleId>(["cashier", "accountant", "manager", "developer", "host", "waiter", "kitchen", "server"]);

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [loginName, setLoginName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** بعد نجاح كلمة السر: انتظار تحقق خفيف أو سؤال المستخدم */
  const [pendingSession, setPendingSession] = useState<{
    user: SessionUser;
    route: string;
  } | null>(null);
  const [verifyFailed, setVerifyFailed] = useState(false);

  if (user) {
    return <Navigate to={ROLE_ROUTES[user.role]} replace />;
  }

  async function attemptLogin(rawLogin: string, rawPin: string) {
    const L = rawLogin.trim();
    const P = rawPin.trim();
    setErr("");
    if (!L || !P) {
      setErr("أدخل اسم المستخدم والرمز.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: L, pin: P }),
      });
      const j = await r.json().catch(
        () => ({} as { detail?: string | unknown; user?: { id: string; name: string; login?: string; role: RoleId } }),
      );
      if (!r.ok || !j.user) {
        const d = j.detail;
        let apiErr = "فشل تسجيل الدخول.";
        if (typeof d === "string") apiErr = d;
        else if (Array.isArray(d) && d.length && typeof d[0] === "object" && d[0] !== null && "msg" in d[0]) {
          apiErr = (d as { msg: string }[]).map((x) => x.msg).join(" ");
        } else if (d != null) apiErr = JSON.stringify(d);
        throw new Error(apiErr);
      }
      const role = j.user.role as RoleId;
      if (!ROLE_SET.has(role)) {
        throw new Error("الدور المستلم من الخادم غير مدعوم.");
      }
      const loginSaved = String(j.user.login || L || "");
      const sessionUser: SessionUser = {
        id: String(j.user.id),
        name: String(j.user.name || loginSaved || ""),
        login: loginSaved,
        role,
      };
      const route = ROLE_ROUTES[role];
      setPendingSession({ user: sessionUser, route });
      setVerifyFailed(false);
      const healthy = await checkApiReadyAfterLogin(12_000);
      if (healthy) {
        login(sessionUser);
        nav(route, { replace: true });
        setPendingSession(null);
      } else {
        setVerifyFailed(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function finishLoginDespiteVerify() {
    if (!pendingSession) return;
    login(pendingSession.user);
    nav(pendingSession.route, { replace: true });
    setPendingSession(null);
    setVerifyFailed(false);
  }

  async function retryVerifyAfterLogin() {
    if (!pendingSession) return;
    setBusy(true);
    setErr("");
    try {
      const healthy = await checkApiReadyAfterLogin(12_000);
      if (healthy) {
        login(pendingSession.user);
        nav(pendingSession.route, { replace: true });
        setPendingSession(null);
        setVerifyFailed(false);
      } else {
        setVerifyFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void attemptLogin(loginName, pin);
  }

  return (
    <div
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div className="card" style={{ maxWidth: 460, width: "100%" }}>
        <h1
          style={{
            fontFamily: "var(--display)",
            margin: "0 0 0.5rem",
            fontSize: "1.75rem",
          }}
        >
          دخول حسب الدور
        </h1>
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 0.85rem",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "rgba(34, 211, 238, 0.06)",
            fontSize: "0.88rem",
            lineHeight: 1.5,
            color: "var(--text)",
          }}
        >
          <strong>أول تشغيل (قبل التهيئة):</strong> لا يوجد بعد مستخدمون في القاعدة — اضغط الزر أدناه «دخول تهيئة أولى» أو
          اكتب <code>dev</code> / <code>dev@123</code> ثم «دخول» (دور مطوّر مؤقت، لا يعتمد على جدول المستخدمين).
          <br />
          <strong>بعد</strong> ضبط الاتصال وتنفيذ <strong>تهيئة القاعدة</strong> من لوحة المطوّر: استخدم الحسابات الافتراضية من
          القاعدة فقط — مثل <code>cashier</code> / <code>1001</code>. حساب <code>dev</code> يتوقف تلقائياً عندما يوجد أي
          مستخدم في <code>MAT3AM_APP_USERS</code>.
        </div>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: "0.9rem" }}>
          يمكن تغيير اسم/رمز الدخول المبدئي من متغيرات البيئة <code>MAT3AM_INITIAL_DEV_LOGIN</code> و{" "}
          <code>MAT3AM_INITIAL_DEV_PIN</code> على الخادم.
        </p>
        <p style={{ color: "var(--muted)", marginTop: 0, fontSize: "0.82rem", lineHeight: 1.5 }}>
          طلب الدخول يُرسل إلى: <code style={{ wordBreak: "break-all" }}>{getApiBase()}</code>
          {" — "}الخادم الصحيح من <code>مطاعم/backend</code> (2288). إن ظهرت «مستخدم غير موجود» مع{" "}
          <code>dev</code> فغالباً الطلب يذهب لخادم قديم؛ افتح{" "}
          <a href={`${getApiBase()}/__whoami__`} target="_blank" rel="noreferrer">
            __whoami__
          </a>{" "}
          ويجب أن يظهر <code>api_server.py: WHOAMI OK</code> ثم شغّل <code>restart_from_zero.bat</code>.
        </p>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>
              اسم المستخدم
            </label>
            <input
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="dev أو cashier"
              autoComplete="off"
              style={{ width: "100%" }}
              disabled={!!pendingSession}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>
              الرمز
            </label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="dev@123 أو رمز المستخدم من القاعدة"
              type="password"
              autoComplete="off"
              style={{ width: "100%" }}
              disabled={!!pendingSession}
            />
          </div>
          {err && (
            <div style={{ color: "var(--danger)", fontSize: "0.9rem", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
              {err}
            </div>
          )}
          {pendingSession && verifyFailed && (
            <div
              style={{
                padding: "0.85rem",
                borderRadius: 8,
                border: "1px solid rgba(249, 115, 22, 0.45)",
                background: "rgba(249, 115, 22, 0.08)",
                fontSize: "0.9rem",
                lineHeight: 1.55,
              }}
            >
              <strong>تعذّر التأكد من جاهزية الخادم بعد الدخول.</strong>
              <div style={{ marginTop: "0.5rem", color: "var(--muted)" }}>
                تم قبول اسم المستخدم والرمز؛ للحد من أعطال الشاشات التالية يُفضّل التأكد من تشغيل API. يمكنك إعادة المحاولة
                أو المتابعة على مسؤوليتك.
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void retryVerifyAfterLogin()}>
                  {busy ? "جاري التحقق…" : "إعادة التحقق"}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={finishLoginDespiteVerify}>
                  متابعة الدخول
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    setPendingSession(null);
                    setVerifyFailed(false);
                  }}
                >
                  إلغاء والرجوع
                </button>
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy || !!pendingSession}>
            {busy && !verifyFailed ? "جاري التحقق من النظام…" : busy ? "جاري المعالجة…" : "دخول"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !!pendingSession}
            onClick={() => {
              setLoginName("dev");
              setPin("dev@123");
              void attemptLogin("dev", "dev@123");
            }}
          >
            دخول تهيئة أولى — dev / dev@123
          </button>
        </form>

        <div style={{ marginTop: "1.25rem", fontSize: "0.85rem", color: "var(--muted)" }}>
          <div>أدوار العمل بعد التهيئة:</div>
          {(Object.keys(ROLE_LABELS) as RoleId[]).map((r) => (
            <div key={r}>
              • {ROLE_LABELS[r]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
