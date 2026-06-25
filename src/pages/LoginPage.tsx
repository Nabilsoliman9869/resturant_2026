import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_ROUTES, type RoleId } from "../auth/roles";
import type { SessionUser } from "../auth/AuthContext";
import { repairArabicDisplayText } from "../auth/displayUser";
import { getApiBase } from "../lib/apiBase";
import { safeFetch } from "../lib/safeFetch";
import { DbConnectionBar } from "../components/DbConnectionBar";

const ROLE_SET = new Set<RoleId>([
  "cashier",
  "accountant",
  "manager",
  "operation_manager",
  "developer",
  "host",
  "waiter",
  "kitchen",
  "kitchen_specialist",
  "speed_order",
  "server",
  "kids_guard",
]);

/** نفس تعريف «اليوم» في صفحة جدولة الأدوار — تقويم المتصفح المحلي (ليس UTC). */
function browserLocalDateISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [loginName, setLoginName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
      const ld = browserLocalDateISO();
      const r = await safeFetch(`${getApiBase()}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mat3am-Local-Date": ld,
        },
        body: JSON.stringify({ login: L, pin: P, localDate: ld }),
        timeoutMs: 45_000,
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
        name: repairArabicDisplayText(String(j.user.name || loginSaved || "")),
        login: loginSaved,
        role,
        specialistStationCode: String(j.user.specialistStationCode || "").trim().toLowerCase(),
      };
      const route = ROLE_ROUTES[role];
      login(sessionUser);
      nav(route, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
        <DbConnectionBar compact lightweight />
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
            />
            <div style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.4 }}>
              إن لم تغيّرها بعد التثبيت: المستخدم <strong>waiter</strong> عادةً برمز <strong>123</strong> (من إعدادات الخادم الافتراضية).
            </div>
          </div>
          {err && (
            <div style={{ color: "var(--danger)", fontSize: "0.9rem", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{err}</div>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "جاري الدخول…" : "دخول"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "0.82rem" }}
            title="اختصار للمطوّر فقط: يملأ الحقول بـ dev / dev@123 ويُرسل — ليس دور «جرسون»"
            disabled={busy}
            onClick={() => {
              setLoginName("dev");
              setPin("dev@123");
              void attemptLogin("dev", "dev@123");
            }}
          >
            دخول تجريبي (حساب dev)
          </button>
        </form>
      </div>
    </div>
  );
}
