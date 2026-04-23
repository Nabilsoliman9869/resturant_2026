import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_ROUTES, type RoleId } from "../auth/roles";
import type { SessionUser } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { checkApiReadyAfterLogin } from "../lib/postLoginHealth";
import { DbConnectionBar } from "../components/DbConnectionBar";

const ROLE_SET = new Set<RoleId>([
  "cashier",
  "accountant",
  "manager",
  "developer",
  "host",
  "waiter",
  "kitchen",
  "speed_order",
  "server",
  "kids_guard",
]);

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [loginName, setLoginName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
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
      <div style={{ position: "fixed", top: "0.65rem", insetInlineEnd: "0.65rem", zIndex: 20, maxWidth: "min(96vw, 320px)" }}>
        <DbConnectionBar compact />
      </div>
      <div className="card" style={{ maxWidth: 400, width: "100%" }}>
        <h1
          style={{
            fontFamily: "var(--display)",
            margin: "0 0 1rem",
            fontSize: "1.75rem",
          }}
        >
          دخول
        </h1>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>اسم المستخدم</label>
            <input
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              autoComplete="username"
              style={{ width: "100%" }}
              disabled={!!pendingSession}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>الرمز</label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              type="password"
              autoComplete="current-password"
              style={{ width: "100%" }}
              disabled={!!pendingSession}
            />
          </div>
          {err && (
            <div style={{ color: "var(--danger)", fontSize: "0.9rem", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{err}</div>
          )}
          {pendingSession && verifyFailed && (
            <div
              style={{
                padding: "0.85rem",
                borderRadius: 8,
                border: "1px solid rgba(249, 115, 22, 0.45)",
                background: "rgba(249, 115, 22, 0.08)",
                fontSize: "0.9rem",
              }}
            >
              تعذّر التحقق من جاهزية الخادم.
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void retryVerifyAfterLogin()}>
                  {busy ? "…" : "إعادة المحاولة"}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={finishLoginDespiteVerify}>
                  متابعة
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
                  إلغاء
                </button>
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy || !!pendingSession}>
            {busy && !verifyFailed ? "جاري التحقق…" : busy ? "…" : "دخول"}
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
            مطوّر
          </button>
        </form>
      </div>
    </div>
  );
}
