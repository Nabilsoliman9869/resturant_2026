import { useCallback, useEffect, useMemo, useState } from "react";
import { ROLE_LABELS, type RoleId } from "../../auth/roles";
import { getApiBase } from "../../lib/apiBase";
import { notifySettingsRestartRecommended } from "../../lib/settingsRestartNotice";

type UserRow = { id: string; login: string; name: string; role: RoleId; isActive: boolean; createdAt: string };

type SchedRow = {
  id: number;
  userId: string;
  role: RoleId;
  validFrom: string;
  validTo: string;
  createdAt: string;
  login: string;
  displayName: string;
  baseRole: RoleId;
};

const ALL_ROLES: RoleId[] = [
  "cashier",
  "accountant",
  "manager",
  "developer",
  "host",
  "waiter",
  "kitchen",
  "kitchen_specialist",
  "speed_order",
  "server",
  "kids_guard",
];

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isActiveToday(s: SchedRow): boolean {
  const t = todayIso();
  return t >= s.validFrom.slice(0, 10) && t <= s.validTo.slice(0, 10);
}

function detailFromJson(j: unknown): string {
  if (!j || typeof j !== "object") return "";
  const d = (j as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length && typeof d[0] === "object" && d[0] !== null && "msg" in d[0]) {
    return (d as { msg: string }[]).map((x) => x.msg).join(" ");
  }
  return "";
}

function apiFailureMessage(status: number, j: unknown, fallback: string, apiBaseUrl?: string): string {
  if (status === 404) {
    const b = (apiBaseUrl || "").replace(/\/$/, "");
    const docs = b ? `${b}/docs` : "";
    return [
      "404 — الخادم الذي تتصل به الواجهة لا يعرّف المسار (نسخة قديمة أو عنوان خاطئ).",
      b ? `العنوان الحالي لـ API: ${b}` : "",
      docs ? `افتح ${docs} وابحث في القائمة عن: user-role-schedule-mutate` : "",
      "إن لم يظهر: من «مدير المهام» أوقف أي Python أو Mat3amPOS على المنفذ 2288، ثم شغّل من مجلد المشروع: run_api_audit_venv.bat أو run_api.bat من نفس نسخة الكود.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return detailFromJson(j) || fallback;
}

function assertMutateOk(j: unknown, action: string) {
  if (!j || typeof j !== "object") throw new Error(`تعذر ${action}: رد غير متوقع من الخادم.`);
  const o = j as { ok?: boolean; scheduleChanged?: boolean };
  if (o.ok === true && o.scheduleChanged === true) return;
  throw new Error(
    detailFromJson(j) ||
      `تعذر ${action}: الخادم لا يدعم POST /api/auth/user-role-schedule-mutate بعد — أوقف run_api/Mat3amPOS من مدير المهام ثم شغّل من مجلد المشروع المحدّث.`
  );
}

export default function RoleScheduleSettingsPage() {
  const base = getApiBase();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [entries, setEntries] = useState<SchedRow[]>([]);
  const [msg, setMsg] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<RoleId>("waiter");
  const [validFrom, setValidFrom] = useState(todayIso());
  const [validTo, setValidTo] = useState(todayIso());
  const [editId, setEditId] = useState<number | null>(null);
  const [editUserId, setEditUserId] = useState("");
  const [editRole, setEditRole] = useState<RoleId>("waiter");
  const [editFrom, setEditFrom] = useState("");
  const [editTo, setEditTo] = useState("");

  const activeUsers = useMemo(() => users.filter((u) => u.isActive), [users]);

  const load = useCallback(async () => {
    setMsg("");
    const ur = await fetch(`${base}/api/auth/users?includeRoleSchedule=1`);
    const uj = await ur.json().catch(() => ({}));
    if (!ur.ok) {
      setUsers([]);
      setEntries([]);
      setMsg(apiFailureMessage(ur.status, uj, "فشل تحميل المستخدمين", base));
      return;
    }
    setUsers(Array.isArray(uj.users) ? uj.users : []);
    if (Array.isArray(uj.roleSchedule)) {
      setEntries(uj.roleSchedule as SchedRow[]);
      setMsg("");
    } else {
      setEntries([]);
      setMsg(
        "الخادم لا يعيد حقل roleSchedule مع المستخدمين — نسخة قديمة من api_server. أوقف ثم شغّل run_api أو Mat3amPOS من مجلد المشروع بعد التحديث، ثم حدّث الصفحة."
      );
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(row: SchedRow) {
    setEditId(row.id);
    setEditUserId(row.userId);
    setEditRole(row.role);
    setEditFrom(row.validFrom.slice(0, 10));
    setEditTo(row.validTo.slice(0, 10));
  }

  function cancelEdit() {
    setEditId(null);
    setEditUserId("");
  }

  async function addRow(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!userId) {
      setMsg("اختر مستخدماً.");
      return;
    }
    try {
      const r = await fetch(`${base}/api/auth/user-role-schedule-mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", userId, role, validFrom, validTo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiFailureMessage(r.status, j, "تعذر الحفظ", base));
      assertMutateOk(j, "الحفظ");
      setMsg("تمت إضافة الفترة.");
      notifySettingsRestartRecommended();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveEdit() {
    if (editId == null || !editUserId) return;
    setMsg("");
    try {
      const r = await fetch(`${base}/api/auth/user-role-schedule-mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          userId: editUserId,
          scheduleId: editId,
          role: editRole,
          validFrom: editFrom,
          validTo: editTo,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiFailureMessage(r.status, j, "تعذر التحديث", base));
      assertMutateOk(j, "التعديل");
      setMsg("تم تحديث الفترة.");
      notifySettingsRestartRecommended();
      cancelEdit();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeRow(s: SchedRow) {
    if (!window.confirm("حذف هذه الفترة من الجدولة؟")) return;
    setMsg("");
    try {
      const r = await fetch(`${base}/api/auth/user-role-schedule-mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", userId: s.userId, scheduleId: s.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiFailureMessage(r.status, j, "تعذر الحذف", base));
      assertMutateOk(j, "الحذف");
      setMsg("تم الحذف.");
      notifySettingsRestartRecommended();
      if (editId === s.id) cancelEdit();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
      <h2 style={{ marginTop: 0 }}>جدولة أدوار المستخدمين</h2>
      <p style={{ color: "var(--muted)", lineHeight: 1.65, marginBottom: "1rem" }}>
        يحدد كل صف <strong>الدور الفعّال عند تسجيل الدخول</strong> خلال فترة (من تاريخ إلى تاريخ). إن لم تُطابق أي فترة «اليوم» على الخادم يُستخدم الدور الأساسي من بطاقة المستخدم. عند التداخل لنفس اليوم يُختار{" "}
        <strong>الأحدث إنشاءً</strong>. التواريخ حسب السيرفر. التحميل: قائمة المستخدمين مع الجدولة؛ الحفظ: POST مخصص. تأكد أن عنوان الـ API يطابق الخادم الذي فيه مسار user-role-schedule-mutate في /docs (غالباً 127.0.0.1:2288 مع واجهة 9999). بعد التعديل: أعد تحميل الصفحة أو تسجيل الدخول.
      </p>

      {msg ? (
        <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.65rem", borderRadius: 8, background: "rgba(59,130,246,0.12)" }}>
          {msg}
        </div>
      ) : null}

      <form onSubmit={addRow} style={{ display: "grid", gap: "0.65rem", marginBottom: "1.25rem", maxWidth: 720 }}>
        <div style={{ fontWeight: 700 }}>إضافة فترة جديدة</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>المستخدم</span>
            <select className="waiter-pos__select" value={userId} onChange={(e) => setUserId(e.target.value)} required style={{ minWidth: 200 }}>
              <option value="">— اختر —</option>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.login} — {u.name} (أساسي: {ROLE_LABELS[u.role] ?? u.role})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>الدور خلال الفترة</span>
            <select className="waiter-pos__select" value={role} onChange={(e) => setRole(e.target.value as RoleId)}>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>من تاريخ</span>
            <input className="waiter-pos__select" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>إلى تاريخ</span>
            <input className="waiter-pos__select" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} required />
          </label>
          <button type="submit" className="btn btn-primary" style={{ alignSelf: "end" }}>
            إضافة
          </button>
        </div>
      </form>

      <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>الفترات المحفوظة</div>
      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ width: "100%", minWidth: 640, fontSize: "0.9rem" }}>
          <thead>
            <tr>
              <th>المستخدم</th>
              <th>الدور الأساسي</th>
              <th>الدور المجدول</th>
              <th>من</th>
              <th>إلى</th>
              <th>اليوم</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: "var(--muted)" }}>
                  لا توجد فترات بعد.
                </td>
              </tr>
            ) : (
              entries.map((s) => (
                <tr key={s.id}>
                  {editId === s.id ? (
                    <>
                      <td>{s.login}</td>
                      <td>{ROLE_LABELS[s.baseRole] ?? s.baseRole}</td>
                      <td>
                        <select className="waiter-pos__select" value={editRole} onChange={(e) => setEditRole(e.target.value as RoleId)}>
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r] ?? r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input className="waiter-pos__select" type="date" value={editFrom} onChange={(e) => setEditFrom(e.target.value)} />
                      </td>
                      <td>
                        <input className="waiter-pos__select" type="date" value={editTo} onChange={(e) => setEditTo(e.target.value)} />
                      </td>
                      <td>{isActiveToday({ ...s, validFrom: editFrom, validTo: editTo }) ? "نعم" : "لا"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="btn btn-primary" style={{ marginInlineEnd: 6 }} onClick={() => void saveEdit()}>
                          حفظ
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                          إلغاء
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{s.displayName || s.login}</td>
                      <td>{ROLE_LABELS[s.baseRole] ?? s.baseRole}</td>
                      <td>{ROLE_LABELS[s.role] ?? s.role}</td>
                      <td>{s.validFrom}</td>
                      <td>{s.validTo}</td>
                      <td>{isActiveToday(s) ? "نشط" : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="btn btn-ghost" style={{ marginInlineEnd: 6 }} onClick={() => startEdit(s)}>
                          تعديل
                        </button>
                        <button type="button" className="btn btn-ghost" style={{ color: "#b91c1c" }} onClick={() => void removeRow(s)}>
                          حذف
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
