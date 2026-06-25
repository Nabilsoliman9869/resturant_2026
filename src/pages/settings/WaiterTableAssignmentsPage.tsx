import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import { repairArabicDisplayText } from "../../auth/displayUser";
import {
  isWaiterTableAssignmentActiveOn,
  normalizeAssignedTableId,
  normalizeWaiterTableAssignments,
  todayIsoDateLocal,
  type WaiterTableAssignmentRow,
} from "../../lib/waiterTableAssignments";

type UserRow = {
  id: string;
  login: string;
  name: string;
  role: string;
  isActive: boolean;
};

type TableRow = {
  id: string;
  name: string;
  number?: number;
  status?: string;
};

function detailFromJson(j: unknown): string {
  if (!j || typeof j !== "object") return "";
  const d = (j as { detail?: unknown }).detail;
  return typeof d === "string" ? d : "";
}

export default function WaiterTableAssignmentsPage() {
  const base = getApiBase();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [assignments, setAssignments] = useState<WaiterTableAssignmentRow[]>([]);
  const [exclusiveOn, setExclusiveOn] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [userId, setUserId] = useState("");
  const [validFrom, setValidFrom] = useState(todayIsoDateLocal());
  const [validTo, setValidTo] = useState(todayIsoDateLocal());
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);

  const activeCaptainUsers = useMemo(
    () =>
      users
        .filter((u) => u.isActive && ["waiter", "host"].includes(String(u.role || "").trim().toLowerCase()))
        .sort((a, b) => `${a.name || a.login}`.localeCompare(`${b.name || b.login}`, "ar")),
    [users],
  );

  const sortedTables = useMemo(
    () =>
      tables.slice().sort((a, b) => {
        const an = Number(a.number || 0);
        const bn = Number(b.number || 0);
        if (an && bn && an !== bn) return an - bn;
        return `${a.name || a.id}`.localeCompare(`${b.name || b.id}`, "ar");
      }),
    [tables],
  );

  const tableNameById = useMemo(() => {
    const out = new Map<string, string>();
    for (const table of sortedTables) {
      const id = normalizeAssignedTableId(table.id);
      if (!id) continue;
      const label = repairArabicDisplayText(String(table.name || "").trim()) || String(table.id || "").trim() || id;
      out.set(id, label);
    }
    return out;
  }, [sortedTables]);

  const resetForm = useCallback(() => {
    setEditingId("");
    setUserId("");
    setValidFrom(todayIsoDateLocal());
    setValidTo(todayIsoDateLocal());
    setSelectedTableIds([]);
  }, []);

  const load = useCallback(async () => {
    setMsg("");
    try {
      const [usersRes, tablesRes, assignmentsRes, workflowRes] = await Promise.all([
        fetch(`${base}/api/auth/users`),
        fetch(`${base}/api/restaurant/tables`),
        fetch(`${base}/api/restaurant/waiter-table-assignments`),
        fetch(`${base}/api/restaurant/workflow-settings`),
      ]);
      const usersJson = (await usersRes.json().catch(() => ({}))) as { users?: UserRow[]; detail?: string };
      const tablesJson = (await tablesRes.json().catch(() => ({}))) as { tables?: TableRow[]; detail?: string };
      const assignmentsJson = (await assignmentsRes.json().catch(() => ({}))) as { items?: unknown; detail?: string };
      const workflowJson = (await workflowRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!usersRes.ok) throw new Error(detailFromJson(usersJson) || `فشل تحميل المستخدمين (HTTP ${usersRes.status})`);
      if (!tablesRes.ok) throw new Error(detailFromJson(tablesJson) || `فشل تحميل الطاولات (HTTP ${tablesRes.status})`);
      if (!assignmentsRes.ok) {
        throw new Error(detailFromJson(assignmentsJson) || `فشل تحميل التوزيع (HTTP ${assignmentsRes.status})`);
      }
      setUsers(Array.isArray(usersJson.users) ? usersJson.users : []);
      setTables(Array.isArray(tablesJson.tables) ? tablesJson.tables : []);
      setAssignments(normalizeWaiterTableAssignments(assignmentsJson.items));
      const raw = String(workflowJson.orderTakerExclusiveTable || "").trim().toLowerCase();
      setExclusiveOn(raw === "on" || raw === "1" || raw === "true" || raw === "yes");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(action: "add" | "update") {
    if (!userId) {
      setMsg("اختر المستخدم أولاً.");
      return;
    }
    if (!selectedTableIds.length) {
      setMsg("اختر طاولة واحدة على الأقل.");
      return;
    }
    const pickedUser = activeCaptainUsers.find((u) => u.id === userId);
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/waiter-table-assignments/mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          assignmentId: editingId || undefined,
          userId,
          userLogin: pickedUser?.login || "",
          userName: pickedUser?.name || pickedUser?.login || "",
          validFrom,
          validTo,
          tableIds: selectedTableIds,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { items?: unknown; detail?: string };
      if (!r.ok) throw new Error(detailFromJson(j) || `HTTP ${r.status}`);
      setAssignments(normalizeWaiterTableAssignments(j.items));
      setMsg(action === "add" ? "تمت إضافة التخصيص." : "تم تحديث التخصيص.");
      resetForm();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(row: WaiterTableAssignmentRow) {
    if (!window.confirm("حذف هذا التخصيص؟")) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/waiter-table-assignments/mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", assignmentId: row.id }),
      });
      const j = (await r.json().catch(() => ({}))) as { items?: unknown; detail?: string };
      if (!r.ok) throw new Error(detailFromJson(j) || `HTTP ${r.status}`);
      setAssignments(normalizeWaiterTableAssignments(j.items));
      setMsg("تم حذف التخصيص.");
      if (editingId === row.id) resetForm();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(row: WaiterTableAssignmentRow) {
    setEditingId(row.id);
    setUserId(row.userId);
    setValidFrom(row.validFrom);
    setValidTo(row.validTo);
    setSelectedTableIds(row.tableIds.map((id) => normalizeAssignedTableId(id)).filter(Boolean));
    setMsg("");
  }

  function toggleTable(tableId: string) {
    const tid = normalizeAssignedTableId(tableId);
    setSelectedTableIds((prev) =>
      prev.includes(tid) ? prev.filter((id) => id !== tid) : [...prev, tid],
    );
  }

  return (
    <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
      <h2 style={{ marginTop: 0 }}>توزيع طاولات الجرسونات</h2>
      <p style={{ color: "var(--muted)", lineHeight: 1.7, marginBottom: "1rem" }}>
        هذا المسار يحدد <strong>من يرى أي طاولة</strong> خلال فترة زمنية محددة. عند تفعيل <strong>قفل الطاولة على كابتن واحد</strong>
        يصبح التوزيع نافذاً على شاشة الشرائح ونافذة الطلب، ويُمنع التسكين والتحويل على طاولة غير مخصصة للمستخدم.
      </p>

      <div
        style={{
          marginBottom: "1rem",
          padding: "0.75rem 0.85rem",
          borderRadius: 10,
          background: exclusiveOn ? "rgba(22,163,74,0.1)" : "rgba(234,179,8,0.12)",
          border: exclusiveOn ? "1px solid rgba(22,163,74,0.28)" : "1px solid rgba(202,138,4,0.28)",
        }}
      >
        {exclusiveOn
          ? "قفل الطاولة على كابتن واحد مفعّل الآن، لذلك هذا التوزيع يعمل مباشرة على الصالة."
          : "قفل الطاولة على كابتن واحد غير مفعّل حالياً. يمكنك تجهيز التوزيع الآن، لكنه لن يُفرض على الشاشات إلا بعد تفعيل القفل من سياسات تشغيل الصالة."}
      </div>

      {msg ? (
        <div style={{ marginBottom: "0.9rem", padding: "0.55rem 0.7rem", borderRadius: 8, background: "rgba(59,130,246,0.12)" }}>
          {msg}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "0.85rem", marginBottom: "1.25rem" }}>
        <div style={{ fontWeight: 800 }}>{editingId ? "تعديل تخصيص" : "إضافة تخصيص جديد"}</div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 240 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>المستخدم</span>
            <select className="waiter-pos__select" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">— اختر —</option>
              {activeCaptainUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {(repairArabicDisplayText(u.name || "") || u.login).trim()} ({u.login})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>من تاريخ</span>
            <input className="waiter-pos__select" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>إلى تاريخ</span>
            <input className="waiter-pos__select" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </label>

          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void submit(editingId ? "update" : "add")}
          >
            {busy ? "..." : editingId ? "حفظ التعديل" : "إضافة"}
          </button>

          {editingId ? (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={resetForm}>
              إلغاء
            </button>
          ) : null}

          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>
            تحديث
          </button>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>الطاولات المسموح بها</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sortedTables.map((table) => {
              const tableId = normalizeAssignedTableId(table.id);
              const active = selectedTableIds.includes(tableId);
              const label = tableNameById.get(tableId) || tableId;
              return (
                <label
                  key={tableId}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0.45rem 0.65rem",
                    borderRadius: 999,
                    border: active ? "1px solid rgba(14,165,233,0.55)" : "1px solid var(--border)",
                    background: active ? "rgba(14,165,233,0.12)" : "rgba(255,255,255,0.03)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleTable(tableId)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ fontWeight: 800, marginBottom: "0.7rem" }}>التخصيصات المحفوظة</div>
      {assignments.length === 0 ? (
        <div style={{ color: "var(--muted)" }}>لا توجد تخصيصات بعد.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {assignments
            .slice()
            .sort((a, b) => {
              if (a.validFrom !== b.validFrom) return a.validFrom.localeCompare(b.validFrom);
              return `${a.userName || a.userLogin || ""}`.localeCompare(`${b.userName || b.userLogin || ""}`, "ar");
            })
            .map((row) => {
              const activeToday = isWaiterTableAssignmentActiveOn(row);
              const label = repairArabicDisplayText(row.userName || "") || row.userLogin || row.userId;
              return (
                <div key={row.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "0.85rem 0.95rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>{label}</div>
                      <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                        {row.userLogin ? `${row.userLogin} · ` : ""}{row.validFrom} → {row.validTo}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span
                        style={{
                          padding: "0.18rem 0.55rem",
                          borderRadius: 999,
                          background: activeToday ? "rgba(22,163,74,0.12)" : "rgba(148,163,184,0.14)",
                          border: activeToday ? "1px solid rgba(22,163,74,0.35)" : "1px solid rgba(148,163,184,0.28)",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                        }}
                      >
                        {activeToday ? "ساري اليوم" : "خارج الفترة"}
                      </span>
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => startEdit(row)}>
                        تعديل
                      </button>
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void removeAssignment(row)}>
                        حذف
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {row.tableIds.length ? (
                      row.tableIds.map((tableId) => (
                        <span
                          key={`${row.id}-${tableId}`}
                          style={{
                            padding: "0.28rem 0.55rem",
                            borderRadius: 999,
                            background: "rgba(59,130,246,0.1)",
                            border: "1px solid rgba(59,130,246,0.28)",
                            fontSize: "0.84rem",
                          }}
                        >
                          {tableNameById.get(normalizeAssignedTableId(tableId)) || tableId}
                        </span>
                      ))
                    ) : (
                      <span style={{ color: "var(--muted)" }}>بدون طاولات</span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
