import { useEffect, useState } from "react";
import { ROLE_LABELS, type RoleId } from "../auth/roles";

import { getApiBase } from "../lib/apiBase";

type Row = {
  id: string;
  login: string;
  name: string;
  role: RoleId;
  isActive: boolean;
  createdAt: string;
};
type AuditRow = { id: number; action: string; entity: string; actor: string; details: string; loggedAt: string };

const ALL_ROLES: RoleId[] = ["cashier", "accountant", "manager", "developer", "host", "waiter", "kitchen", "server"];

export default function DeveloperUsers() {
  const [rows, setRows] = useState<Row[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loginName, setLoginName] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<RoleId>("cashier");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/auth/users`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "فشل تحميل المستخدمين");
      setRows(Array.isArray(j.users) ? j.users : []);
      const ar = await fetch(`${getApiBase()}/api/auth/audit?limit=50`);
      const aj = await ar.json();
      if (ar.ok) setAudit(Array.isArray(aj.audit) ? aj.audit : []);
    } catch (e) {
      setMsg(String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!loginName.trim() || !pin.trim()) {
      setMsg("اسم المستخدم والرمز مطلوبان");
      return;
    }
    try {
      const r = await fetch(`${getApiBase()}/api/auth/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: loginName.trim(), name: name.trim() || loginName.trim(), role, pin: pin.trim() }),
      });
      const j = await r.json().catch(() => ({} as { detail?: string }));
      if (!r.ok) throw new Error(j.detail || "تعذر إنشاء المستخدم");
      setLoginName("");
      setName("");
      setPin("");
      await load();
      setMsg("تم إنشاء المستخدم.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleActive(u: Row) {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/auth/users/${encodeURIComponent(u.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      const j = await r.json().catch(() => ({} as { detail?: string }));
      if (!r.ok) throw new Error(j.detail || "تعذر تحديث الحالة");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function resetPin(u: Row) {
    const newPin = window.prompt(`رمز جديد للمستخدم ${u.login}`, "123");
    if (!newPin) return;
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/auth/users/${encodeURIComponent(u.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: newPin }),
      });
      const j = await r.json().catch(() => ({} as { detail?: string }));
      if (!r.ok) throw new Error(j.detail || "تعذر تغيير الرمز");
      setMsg("تم تغيير الرمز.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeUser(u: Row) {
    const ok = window.confirm(`حذف المستخدم ${u.login} ؟`);
    if (!ok) return;
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/auth/users/${encodeURIComponent(u.id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({} as { detail?: string }));
      if (!r.ok) throw new Error(j.detail || "تعذر حذف المستخدم");
      await load();
      setMsg("تم حذف المستخدم.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>مستخدمون وأدوار (قاعدة البيانات)</h2>
      <p style={{ color: "var(--muted)" }}>
        إدارة فعلية من جدول <code>MAT3AM_APP_USERS</code> (إنشاء/تفعيل/تعطيل/تغيير رمز).
      </p>
      <form className="card" onSubmit={add} style={{ maxWidth: 620, marginBottom: "1rem" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <input value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="اسم المستخدم (login)" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الظاهر" />
          <select value={role} onChange={(e) => setRole(e.target.value as RoleId)}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="رمز الدخول" />
          <button type="submit" className="btn btn-primary">
            إضافة مستخدم
          </button>
        </div>
      </form>
      <div className="card">
        {rows.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>لا مستخدمين بعد</span>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--muted)" }}>
                <th style={{ padding: "0.5rem" }}>المستخدم</th>
                <th>الاسم</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem" }}>{r.login}</td>
                  <td>{r.name}</td>
                  <td>{ROLE_LABELS[r.role] || r.role}</td>
                  <td>{r.isActive ? "مفعل" : "موقوف"}</td>
                  <td style={{ display: "flex", gap: 6, padding: "0.4rem" }}>
                    <button type="button" className="btn btn-ghost" onClick={() => void toggleActive(r)}>
                      {r.isActive ? "تعطيل" : "تفعيل"}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void resetPin(r)}>
                      تغيير الرمز
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void removeUser(r)}>
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>سجل التدقيق (Audit)</h3>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            تحديث
          </button>
        </div>
        {audit.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>لا سجلات بعد</span>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--muted)" }}>
                <th style={{ padding: "0.5rem" }}>الوقت</th>
                <th>العملية</th>
                <th>المنفذ</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem" }}>{a.loggedAt}</td>
                  <td>{a.action}</td>
                  <td>{a.actor || "-"}</td>
                  <td>{a.details || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {msg && <p style={{ color: "var(--accent2)" }}>{msg}</p>}
    </div>
  );
}
