import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import { repairArabicDisplayText } from "../../auth/displayUser";

interface ProductGroup {
  CardGuide: string;
  GroupName: string;
  DisplayCategory?: string;
}

const GROUP_PILL_COLORS = [
  { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  { bg: "#e0e7ff", text: "#3730a3", border: "#a5b4fc" },
  { bg: "#ccfbf1", text: "#0f766e", border: "#5eead4" },
  { bg: "#f3e8ff", text: "#6b21a8", border: "#d8b4fe" },
  { bg: "#ffedd5", text: "#9a3412", border: "#fdba74" },
];

function groupColorForIndex(i: number) {
  return GROUP_PILL_COLORS[i % GROUP_PILL_COLORS.length];
}

export default function DisplayCategorySettingsPage() {
  const base = getApiBase();
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newCategoryInputs, setNewCategoryInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/product-groups?displayMenu=true`);
      const j = await r.json();
      const list: ProductGroup[] = Array.isArray(j?.groups) ? j.groups : [];
      const normalizedList = list.map((g) => ({
        ...g,
        GroupName: repairArabicDisplayText(String(g.GroupName || "")),
        DisplayCategory: repairArabicDisplayText(String(g.DisplayCategory || "")),
      }));
      setGroups(normalizedList);
      const init: Record<string, string> = {};
      const newInputs: Record<string, string> = {};
      for (const g of normalizedList) {
        init[g.CardGuide] = g.DisplayCategory || "";
        newInputs[g.CardGuide] = "";
      }
      setDraft(init);
      setNewCategoryInputs(newInputs);
      setMsg("");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [base]);

  const existingCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const g of groups) {
      const c = (g.DisplayCategory || "").trim();
      if (c) cats.add(c);
    }
    for (const g of groups) {
      const c = (draft[g.CardGuide] || "").trim();
      if (c) cats.add(c);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b, "ar"));
  }, [groups, draft]);

  async function saveForGroup(guide: string) {
    setMsg("");
    const raw = draft[guide] || "";
    const value = raw.trim();
    try {
      const encodedGuide = encodeURIComponent(guide);
      const r = await fetch(`${base}/api/product-groups/${encodedGuide}/display-category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayCategory: value }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      setGroups((prev) => prev.map((g) => (g.CardGuide === guide ? { ...g, DisplayCategory: value } : g)));
      setMsg("تم الحفظ.");
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function saveAll() {
    setMsg("");
    setBusy(true);
    let okCount = 0;
    let firstErr = "";
    for (const g of groups) {
      const value = (draft[g.CardGuide] || "").trim();
      try {
        const encodedGuide = encodeURIComponent(g.CardGuide);
        const r = await fetch(`${base}/api/product-groups/${encodedGuide}/display-category`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayCategory: value }),
        });
        if (!r.ok) {
          const t = await r.text();
          throw new Error(t || `HTTP ${r.status}`);
        }
        okCount++;
      } catch (e) {
        if (!firstErr) firstErr = String(e);
      }
    }
    setGroups((prev) => prev.map((g) => ({ ...g, DisplayCategory: (draft[g.CardGuide] || "").trim() })));
    setBusy(false);
    if (firstErr) setMsg(`حُفظ ${okCount} من ${groups.length} — خطأ: ${firstErr}`);
    else setMsg("تم حفظ الكل.");
  }

  function handleSelectChange(guide: string, value: string) {
    if (value === "__NEW__") {
      setDraft((prev) => ({ ...prev, [guide]: "" }));
    } else {
      setDraft((prev) => ({ ...prev, [guide]: value }));
    }
  }

  function applyNewCategoryInput(guide: string) {
    const val = (newCategoryInputs[guide] || "").trim();
    if (!val) return;
    setDraft((prev) => ({ ...prev, [guide]: val }));
    setNewCategoryInputs((prev) => ({ ...prev, [guide]: "" }));
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>تصنيفات عرض المنيو</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        اربط كل مجموعة (TBL006) بتصنيف عرض رئيسي (مشروبات، مقبلات، أطباق رئيسية…) ليظهر في شاشة الجرسون بشكل منظم.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveAll()}>
          حفظ الكل
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>
          تحديث
        </button>
      </div>

      {msg ? (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 8,
            background: msg.includes("خطأ") ? "rgba(185,28,28,0.08)" : "rgba(22,163,74,0.08)",
            color: msg.includes("خطأ") ? "#991b1b" : "#166534",
            fontSize: "0.88rem",
            fontWeight: 700,
            border: `1px solid ${msg.includes("خطأ") ? "rgba(185,28,28,0.25)" : "rgba(22,163,74,0.25)"}`,
          }}
        >
          {msg}
        </div>
      ) : null}

      {existingCategories.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: "0.82rem", color: "var(--muted)", fontWeight: 700 }}>التصنيفات المتاحة: </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {existingCategories.map((c) => (
              <span
                key={c}
                style={{
                  background: "#e2e8f0",
                  color: "#334155",
                  padding: "3px 12px",
                  borderRadius: 999,
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  border: "1px solid #cbd5e1",
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        {groups.map((g, idx) => {
          const isCustom = draft[g.CardGuide] !== "" && !existingCategories.includes(draft[g.CardGuide]);
          const color = groupColorForIndex(idx);
          return (
            <div
              key={g.CardGuide}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${color.border}`,
                background: "#fff",
              }}
            >
              <div
                style={{
                  background: color.bg,
                  color: color.text,
                  border: `1px solid ${color.border}`,
                  padding: "4px 12px",
                  borderRadius: 999,
                  fontWeight: 800,
                  fontSize: "0.88rem",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
                title={g.GroupName}
              >
                {g.GroupName}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 0%", minWidth: 0 }}>
                <select
                  value={isCustom ? "__CUSTOM__" : draft[g.CardGuide] || ""}
                  onChange={(e) => handleSelectChange(g.CardGuide, e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    minWidth: 160,
                    fontSize: "0.9rem",
                    background: "#fff",
                    color: "#0f172a",
                    fontWeight: 700,
                  }}
                >
                  <option value="">— بدون تصنيف —</option>
                  {existingCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="__NEW__">✎ تصنيف جديد…</option>
                </select>

                {(draft[g.CardGuide] === "" && (g.DisplayCategory || "").trim() === "") ||
                (draft[g.CardGuide] !== "" && !existingCategories.includes(draft[g.CardGuide])) ? (
                  <input
                    type="text"
                    value={newCategoryInputs[g.CardGuide] || ""}
                    onChange={(e) =>
                      setNewCategoryInputs((prev) => ({ ...prev, [g.CardGuide]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyNewCategoryInput(g.CardGuide);
                    }}
                    onBlur={() => applyNewCategoryInput(g.CardGuide)}
                    placeholder="اكتب تصنيف جديد"
                    style={{
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                      minWidth: 140,
                      fontSize: "0.9rem",
                      background: "#fff",
                    }}
                  />
                ) : null}
              </div>

              <button
                type="button"
                style={{
                  padding: "6px 14px",
                  fontSize: "0.82rem",
                  fontWeight: 800,
                  flexShrink: 0,
                  borderRadius: 8,
                  border: "1px solid #15803d",
                  background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                  color: "#fff",
                  cursor: "pointer",
                  lineHeight: 1.4,
                }}
                onClick={() => void saveForGroup(g.CardGuide)}
              >
                حفظ
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
