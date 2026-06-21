import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

export type ModifierItem = {
  itemId: string;
  nameAr: string;
  nameEn: string;
  priceDelta: number;
  sortOrder: number;
};

export type ModifierGroup = {
  groupId: string;
  nameAr: string;
  nameEn: string;
  type: "choice" | "addon" | "exclusion" | "kitchen_note" | "cooking";
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  sortOrder: number;
  allowFreeText?: boolean;
  freeTextRequired?: boolean;
  freeTextLabel?: string;
  freeTextPlaceholder?: string;
  freeTextMaxLength?: number;
  items: ModifierItem[];
};

const GROUP_TYPES: { value: ModifierGroup["type"]; label: string }[] = [
  { value: "choice", label: "اختيار (Choice)" },
  { value: "addon", label: "إضافة مدفوعة (Add-on)" },
  { value: "exclusion", label: "استبعاد (Exclusion)" },
  { value: "kitchen_note", label: "ملاحظة مطبخ (Kitchen Note)" },
  { value: "cooking", label: "درجة السواء (Cooking)" },
];

function newGroup(): ModifierGroup {
  return {
    groupId: crypto.randomUUID(),
    nameAr: "",
    nameEn: "",
    type: "choice",
    minSelect: 1,
    maxSelect: 1,
    isRequired: true,
    sortOrder: 0,
    allowFreeText: true,
    freeTextRequired: false,
    freeTextLabel: "مواصفات إضافية",
    freeTextPlaceholder: "اكتب أي مواصفات إضافية تخص هذه الشريحة",
    freeTextMaxLength: 120,
    items: [],
  };
}

function newItem(): ModifierItem {
  return {
    itemId: crypto.randomUUID(),
    nameAr: "",
    nameEn: "",
    priceDelta: 0,
    sortOrder: 0,
  };
}

export default function ModifierGroupsSettingsPage() {
  const base = getApiBase();
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/modifier-groups`);
      const j = await r.json().catch(() => ({ groups: [] }));
      setGroups(Array.isArray(j.groups) ? j.groups : []);
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(next: ModifierGroup[]) {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/modifier-groups`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      setGroups(j.groups || next);
      setMsg("تم الحفظ.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function updateGroup(index: number, patch: Partial<ModifierGroup>) {
    const next = [...groups];
    next[index] = { ...next[index], ...patch };
    setGroups(next);
  }

  function updateItem(gIndex: number, iIndex: number, patch: Partial<ModifierItem>) {
    const next = [...groups];
    const items = [...next[gIndex].items];
    items[iIndex] = { ...items[iIndex], ...patch };
    next[gIndex] = { ...next[gIndex], items };
    setGroups(next);
  }

  function addGroup() {
    const next = [...groups, newGroup()];
    setGroups(next);
    setExpanded(next[next.length - 1].groupId);
  }

  function removeGroup(index: number) {
    const next = groups.filter((_, i) => i !== index);
    setGroups(next);
  }

  function addItem(gIndex: number) {
    const next = [...groups];
    next[gIndex] = { ...next[gIndex], items: [...next[gIndex].items, newItem()] };
    setGroups(next);
  }

  function removeItem(gIndex: number, iIndex: number) {
    const next = [...groups];
    next[gIndex] = { ...next[gIndex], items: next[gIndex].items.filter((_, i) => i !== iIndex) };
    setGroups(next);
  }

  const sortedGroups = useMemo(() => {
    return [...groups].map((g, i) => ({ ...g, sortOrder: i }));
  }, [groups]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>إعدادات الشرائح (Modifier Groups)</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", maxWidth: 820 }}>
        هنا تُعرّف الشرائح العامة نفسها: الاسم، النوع، حدود الاختيار، الخيارات الجاهزة، مع وجود حقل كتابة حرة في كل شريحة كحد أدنى.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn btn-primary" onClick={addGroup} disabled={busy}>
          + مجموعة جديدة
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void save(sortedGroups)} disabled={busy}>
          {busy ? "جاري الحفظ…" : "حفظ"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={busy}>
          تحديث
        </button>
      </div>

      {msg ? <p style={{ fontSize: "0.85rem" }}>{msg}</p> : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {groups.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>لا توجد مجموعات بعد.</div>
        ) : (
          groups.map((g, gi) => {
            const isOpen = expanded === g.groupId;
            return (
              <div key={g.groupId} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                <div
                  style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}
                  onClick={() => setExpanded(isOpen ? null : g.groupId)}
                >
                  <span style={{ fontSize: "0.85rem" }}>{isOpen ? "▼" : "▶"}</span>
                  <strong style={{ flex: 1 }}>
                    {g.nameAr || "(بدون اسم)"} <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{g.groupId.slice(0, 8)}…</span>
                  </strong>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {GROUP_TYPES.find((t) => t.value === g.type)?.label || g.type} · {g.items.length} خيار
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: "0.7rem", padding: "2px 6px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeGroup(gi);
                    }}
                    title="حذف"
                  >
                    🗑
                  </button>
                </div>

                {isOpen && (
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 100px 100px auto", gap: 8 }}>
                      <input
                        placeholder="اسم المجموعة (عربي)"
                        value={g.nameAr}
                        onChange={(e) => updateGroup(gi, { nameAr: e.target.value })}
                      />
                      <input
                        placeholder="اسم المجموعة (إنجليزي)"
                        value={g.nameEn}
                        onChange={(e) => updateGroup(gi, { nameEn: e.target.value })}
                      />
                      <select value={g.type} onChange={(e) => updateGroup(gi, { type: e.target.value as ModifierGroup["type"] })}>
                        {GROUP_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        placeholder="min"
                        value={g.minSelect}
                        onChange={(e) => updateGroup(gi, { minSelect: Math.max(0, Number(e.target.value) || 0) })}
                        style={{ minWidth: 60 }}
                      />
                      <input
                        type="number"
                        min={0}
                        placeholder="max"
                        value={g.maxSelect}
                        onChange={(e) => updateGroup(gi, { maxSelect: Math.max(0, Number(e.target.value) || 0) })}
                        style={{ minWidth: 60 }}
                      />
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                        <input
                          type="checkbox"
                          checked={g.isRequired}
                          onChange={(e) => updateGroup(gi, { isRequired: e.target.checked })}
                        />
                        إجباري
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) auto minmax(180px,1fr) minmax(220px,1.3fr) 110px", gap: 8, alignItems: "center" }}>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 700 }}>
                        الكتابة الحرة مفعلة دائمًا لهذه الشريحة
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                        <input
                          type="checkbox"
                          checked={!!g.freeTextRequired}
                          onChange={(e) => updateGroup(gi, { freeTextRequired: e.target.checked, allowFreeText: true })}
                        />
                        النص الحر مطلوب
                      </label>
                      <input
                        placeholder="عنوان حقل الكتابة الحرة"
                        value={g.freeTextLabel || ""}
                        onChange={(e) => updateGroup(gi, { freeTextLabel: e.target.value, allowFreeText: true })}
                      />
                      <input
                        placeholder="Placeholder للكتابة الحرة"
                        value={g.freeTextPlaceholder || ""}
                        onChange={(e) => updateGroup(gi, { freeTextPlaceholder: e.target.value, allowFreeText: true })}
                      />
                      <input
                        type="number"
                        min={20}
                        max={500}
                        placeholder="حد النص"
                        value={g.freeTextMaxLength || 120}
                        onChange={(e) => updateGroup(gi, { freeTextMaxLength: Math.max(20, Number(e.target.value) || 120) })}
                      />
                    </div>

                    <div style={{ fontWeight: 700, fontSize: "0.85rem", marginTop: 4 }}>الخيارات</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {g.items.map((it, ii) => (
                        <div key={it.itemId} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto auto", gap: 8, alignItems: "center" }}>
                          <input
                            placeholder="اسم الخيار (عربي)"
                            value={it.nameAr}
                            onChange={(e) => updateItem(gi, ii, { nameAr: e.target.value })}
                          />
                          <input
                            placeholder="اسم الخيار (إنجليزي)"
                            value={it.nameEn}
                            onChange={(e) => updateItem(gi, ii, { nameEn: e.target.value })}
                          />
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="دلتا السعر"
                            value={it.priceDelta}
                            onChange={(e) => updateItem(gi, ii, { priceDelta: Math.max(0, Number(e.target.value) || 0) })}
                            style={{ minWidth: 80 }}
                          />
                          <input
                            type="number"
                            placeholder="ترتيب"
                            value={it.sortOrder}
                            onChange={(e) => updateItem(gi, ii, { sortOrder: Number(e.target.value) || 0 })}
                            style={{ minWidth: 60 }}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: "0.7rem", padding: "2px 6px" }}
                            onClick={() => removeItem(gi, ii)}
                          >
                            🗑
                          </button>
                        </div>
                      ))}
                      <button type="button" className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={() => addItem(gi)}>
                        + خيار جديد
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
