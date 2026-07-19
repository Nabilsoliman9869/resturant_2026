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
  specialistStationCode?: string;
  email?: string;
  /** هل للمستخدم PIN محفوظ (لا يُعاد الرقم نفسه من الخادم) */
  hasPin?: boolean;
};
type AuditRow = { id: number; action: string; entity: string; actor: string; details: string; loggedAt: string };
type SpecialistStationRow = { id: string; label: string; stationCode: string; active: boolean };

function EmailCell({ value, onSave }: { value: string; onSave: (v: string) => Promise<boolean> }) {
  const [val, setVal] = useState(value || "");
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [hint, setHint] = useState("");
  const changed = val.trim() !== (value || "").trim();
  useEffect(() => {
    setVal(value || "");
    setStatus("idle");
    setHint("");
  }, [value]);

  async function save() {
    if (status === "saving") return;
    setStatus("saving");
    setHint("");
    try {
      const ok = await onSave(val);
      if (ok) {
        setStatus("ok");
        setHint("تم الحفظ");
      } else {
        setStatus("err");
        setHint("فشل الحفظ");
      }
    } catch (e) {
      setStatus("err");
      setHint(e instanceof Error ? e.message : String(e));
    }
  }

  const bg =
    status === "saving"
      ? "#95a5a6"
      : status === "ok"
        ? "#27ae60"
        : status === "err"
          ? "#c0392b"
          : changed
            ? "#e67e22"
            : "#7f8c8d";
  const label = status === "saving" ? "…" : status === "ok" ? "تم" : status === "err" ? "فشل" : "حفظ";

  return (
    <div style={{ display: "grid", gap: 4, minWidth: 180 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="email"
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            setStatus("idle");
            setHint("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder="-"
          disabled={status === "saving"}
          style={{ flex: 1, fontSize: "0.85rem", minWidth: 60 }}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={status === "saving" || (!changed && status !== "err")}
          title={hint || (changed ? "حفظ البريد" : "لا تغيير")}
          style={{
            padding: "3px 10px",
            fontSize: "0.75rem",
            whiteSpace: "nowrap",
            borderRadius: 4,
            border: "none",
            cursor: status === "saving" || (!changed && status !== "err") ? "default" : "pointer",
            background: bg,
            color: "#fff",
            opacity: !changed && status === "idle" ? 0.7 : 1,
          }}
        >
          {label}
        </button>
      </div>
      {hint ? (
        <div style={{ fontSize: "0.72rem", color: status === "err" ? "#c0392b" : "#27ae60", lineHeight: 1.3 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function PinCell({
  hasPin,
  onSave,
}: {
  hasPin: boolean;
  onSave: (pin: string) => Promise<boolean>;
}) {
  const [val, setVal] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [hint, setHint] = useState("");

  async function save() {
    const pin = val.trim();
    if (!pin) {
      setStatus("err");
      setHint("أدخل PIN");
      return;
    }
    if (status === "saving") return;
    setStatus("saving");
    setHint("");
    try {
      const ok = await onSave(pin);
      if (ok) {
        setStatus("ok");
        setHint("تم حفظ PIN");
        setVal("");
      } else {
        setStatus("err");
        setHint("فشل الحفظ");
      }
    } catch (e) {
      setStatus("err");
      setHint(e instanceof Error ? e.message : String(e));
    }
  }

  const bg =
    status === "saving"
      ? "#95a5a6"
      : status === "ok"
        ? "#27ae60"
        : status === "err"
          ? "#c0392b"
          : val.trim()
            ? "#e67e22"
            : "#7f8c8d";
  const label = status === "saving" ? "…" : status === "ok" ? "تم" : status === "err" ? "فشل" : "حفظ PIN";

  return (
    <div style={{ display: "grid", gap: 4, minWidth: 160 }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 800, color: hasPin ? "#047857" : "#b45309" }}>
        {hasPin ? "معيّن ●●●●" : "غير معيّن"}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            setStatus("idle");
            setHint("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder={hasPin ? "PIN جديد…" : "أدخل PIN…"}
          disabled={status === "saving"}
          style={{ flex: 1, fontSize: "0.85rem", minWidth: 70 }}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={status === "saving" || !val.trim()}
          title={hasPin ? "تغيير PIN" : "تعيين PIN"}
          style={{
            padding: "3px 10px",
            fontSize: "0.75rem",
            whiteSpace: "nowrap",
            borderRadius: 4,
            border: "none",
            cursor: status === "saving" || !val.trim() ? "default" : "pointer",
            background: bg,
            color: "#fff",
            opacity: !val.trim() && status === "idle" ? 0.7 : 1,
          }}
        >
          {label}
        </button>
      </div>
      {hint ? (
        <div style={{ fontSize: "0.72rem", color: status === "err" ? "#c0392b" : "#27ae60", lineHeight: 1.3 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

const ALL_ROLES: RoleId[] = [
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
];

export default function DeveloperUsers() {
  const [rows, setRows] = useState<Row[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loginName, setLoginName] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<RoleId>("cashier");
  const [pin, setPin] = useState("");
  const [specialistStationCode, setSpecialistStationCode] = useState("");
  const [email, setEmail] = useState("");
  const [stations, setStations] = useState<SpecialistStationRow[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    setMsg("");
    try {
      const [r, ar, opsr] = await Promise.all([
        fetch(`${getApiBase()}/api/auth/users`),
        fetch(`${getApiBase()}/api/auth/audit?limit=50`),
        fetch(`${getApiBase()}/api/restaurant/ops-settings`),
      ]);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "فشل تحميل المستخدمين");
      setRows(Array.isArray(j.users) ? j.users : []);
      const aj = await ar.json();
      if (ar.ok) setAudit(Array.isArray(aj.audit) ? aj.audit : []);
      const opsj = await opsr.json().catch(() => ({} as { kitchenSpecialistStationsJson?: string }));
      const rawStations = String(opsj.kitchenSpecialistStationsJson || "[]").trim();
      try {
        const arr = JSON.parse(rawStations);
        setStations(
          Array.isArray(arr)
            ? arr
                .filter((x) => x && typeof x === "object")
                .map((x) => {
                  const row = x as Partial<SpecialistStationRow>;
                  return {
                    id: String(row.id || ""),
                    label: String(row.label || ""),
                    stationCode: String(row.stationCode || "").trim().toLowerCase(),
                    active: row.active !== false,
                  };
                })
                .filter((x) => x.stationCode)
            : [],
        );
      } catch {
        setStations([]);
      }
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
        body: JSON.stringify({
          login: loginName.trim(),
          name: name.trim() || loginName.trim(),
          role,
          pin: pin.trim(),
          email: email.trim(),
          specialistStationCode: role === "kitchen_specialist" ? specialistStationCode.trim().toLowerCase() : "",
        }),
      });
      const j = await r.json().catch(() => ({} as { detail?: string }));
      if (!r.ok) throw new Error(j.detail || "تعذر إنشاء المستخدم");
      setLoginName("");
      setName("");
      setPin("");
      setEmail("");
      setSpecialistStationCode("");
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

  async function resetPin(u: Row, newPin?: string) {
    const pin = (newPin ?? window.prompt(`رمز PIN جديد للمستخدم ${u.login}`, "") ?? "").trim();
    if (!pin) return false;
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/auth/users/${encodeURIComponent(u.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const j = await r.json().catch(() => ({} as { detail?: string }));
      if (!r.ok) throw new Error(j.detail || "تعذر تغيير الرمز");
      await load();
      setMsg(`تم حفظ PIN لـ ${u.login}.`);
      return true;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  async function editSpecialistStation(u: Row, nextCode: string) {
    setMsg("");
    try {
      const r = await fetch(`${getApiBase()}/api/auth/users/${encodeURIComponent(u.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialistStationCode: nextCode }),
      });
      const j = await r.json().catch(() => ({} as { detail?: string }));
      if (!r.ok) throw new Error(j.detail || "تعذر تحديث الدور التشغيلي");
      await load();
      setMsg("تم تحديث الدور التشغيلي/المحطة.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function editEmail(u: Row, nextEmail: string): Promise<boolean> {
    setMsg("");
    const email = nextEmail.trim();
    if (email && !email.includes("@")) {
      setMsg("بريد غير صالح");
      throw new Error("بريد غير صالح");
    }
    const r = await fetch(`${getApiBase()}/api/auth/users/${encodeURIComponent(u.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const j = await r.json().catch(() => ({} as { detail?: string; message?: string; userFieldsChanged?: boolean }));
    if (!r.ok) {
      const detail = j.detail || "تعذر تحديث البريد";
      setMsg(String(detail));
      throw new Error(String(detail));
    }
    if (j.userFieldsChanged === false && j.message === "لا تغييرات") {
      setMsg("لم يُحفظ البريد: الخادم لم يطبّق التعديل.");
      throw new Error("لم يُحفظ البريد");
    }
    await load();
    setMsg(`تم تحديث بريد ${u.login}.`);
    return true;
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
      <h2 style={{ marginTop: 0 }}>مستخدمو التطبيق</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: "-0.35rem", marginBottom: "0.85rem" }}>
        عيّن أو غيّر <strong>PIN</strong> من عمود PIN في الجدول أدناه (مطلوب عند تفعيل «جهاز مشترك» في نقاط البيع المشتركة).
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
          {role === "kitchen_specialist" ? (
            <select
              value={specialistStationCode}
              onChange={(e) => setSpecialistStationCode(e.target.value)}
              disabled={stations.length === 0}
            >
              <option value="">{stations.length ? "اختر محطة" : "لا توجد محطات معرفة"}</option>
              {stations
                .filter((x) => x.active)
                .map((station) => (
                  <option key={station.id || station.stationCode} value={station.stationCode}>
                    {station.label || station.stationCode}
                  </option>
                ))}
            </select>
          ) : null}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد الإلكتروني (اختياري)" />
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN / رمز الدخول (إلزامي عند الإضافة)"
            inputMode="numeric"
            autoComplete="new-password"
          />
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
                <th>المحطة</th>
                <th>البريد</th>
                <th>PIN</th>
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
                  <td>
                    {r.role === "kitchen_specialist" ? (
                      <select
                        value={r.specialistStationCode || ""}
                        onChange={(e) => void editSpecialistStation(r, e.target.value)}
                        style={{ width: "100%" }}
                      >
                        <option value="">بدون محطة</option>
                        {stations.map((station) => (
                          <option key={station.id || station.stationCode} value={station.stationCode}>
                            {station.label || station.stationCode}
                          </option>
                        ))}
                      </select>
                    ) : (
                      r.specialistStationCode || "-"
                    )}
                  </td>
                  <td>
                    <EmailCell value={r.email || ""} onSave={(v) => editEmail(r, v)} />
                  </td>
                  <td>
                    <PinCell hasPin={Boolean(r.hasPin)} onSave={(p) => resetPin(r, p)} />
                  </td>
                  <td>{r.isActive ? "مفعل" : "موقوف"}</td>
                  <td style={{ display: "flex", gap: 6, padding: "0.4rem" }}>
                    <button type="button" className="btn btn-ghost" onClick={() => void toggleActive(r)}>
                      {r.isActive ? "تعطيل" : "تفعيل"}
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
