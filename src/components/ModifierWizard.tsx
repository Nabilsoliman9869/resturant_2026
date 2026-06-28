import { useState, useCallback, useMemo } from "react";

export type ModifierItem = {
  itemId: string;
  nameAr: string;
  nameEn: string;
  priceDelta: number;
  sortOrder: number;
  isDefault?: boolean;
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

export type WizardSelection = {
  groupId: string;
  selectedItemIds: string[];
  note?: string;
};

export type WizardResult = {
  baseProduct: { guide: string; name: string; price: number };
  selections: WizardSelection[];
  totalPrice: number;
};

type Props = {
  baseProduct: { guide: string; name: string; price: number };
  groups: ModifierGroup[];
  onResult: (result: WizardResult) => void;
  onCancel: () => void;
  onStepChange?: (step: number, total: number, groupName: string) => void;
};

function formatPrice(n: number) {
  return n.toFixed(2);
}

function groupColor(type: ModifierGroup["type"]): string {
  switch (type) {
    case "cooking": return "#e53935";   // أحمر
    case "addon": return "#43a047";    // أخضر
    case "choice": return "#1e88e5";   // أزرق
    case "exclusion": return "#757575"; // رمادي
    case "kitchen_note": return "#ec407a"; // بنك/وردي
    default: return "#fb8c00";          // برتقالي
  }
}

function cookingItemColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("well") || n.includes("done") || n.includes("سواء")) return "#7f1d1d"; // Well Done — ناري داكن
  if (n.includes("medium") || n.includes("mid")) return "#dc2626"; // Medium — أحمر
  if (n.includes("rare")) return "#f472b6"; // Rare — وردي
  return "#e53935"; // default
}

function groupAppearance(g: ModifierGroup) {
  const name = `${g.nameAr} ${g.nameEn}`.toLowerCase();
  if (g.type === "cooking" || name.includes("سواء") || name.includes("cooking")) {
    return {
      icon: "🔥",
      accent: "#dc2626",
      text: "#991b1b",
      border: "#f87171",
      background: "linear-gradient(180deg, #fecaca 0%, #f87171 100%)",
      chipBackground: "linear-gradient(180deg, #fee2e2 0%, #fb7185 100%)",
    };
  }
  if (name.includes("طبق جانبي") || name.includes("side") || name.includes("dishes")) {
    return {
      icon: "🍽",
      accent: "#2563eb",
      text: "#1d4ed8",
      border: "#60a5fa",
      background: "linear-gradient(180deg, #bfdbfe 0%, #60a5fa 100%)",
      chipBackground: "linear-gradient(180deg, #dbeafe 0%, #93c5fd 100%)",
    };
  }
  if (g.type === "addon" || name.includes("إضافة") || name.includes("extra") || name.includes("addon")) {
    return {
      icon: "➕",
      accent: "#16a34a",
      text: "#15803d",
      border: "#4ade80",
      background: "linear-gradient(180deg, #bbf7d0 0%, #4ade80 100%)",
      chipBackground: "linear-gradient(180deg, #dcfce7 0%, #86efac 100%)",
    };
  }
  if (name.includes("صوص") || name.includes("sauce")) {
    return {
      icon: "🥣",
      accent: "#0ea5e9",
      text: "#0369a1",
      border: "#38bdf8",
      background: "linear-gradient(180deg, #bae6fd 0%, #38bdf8 100%)",
      chipBackground: "linear-gradient(180deg, #e0f2fe 0%, #7dd3fc 100%)",
    };
  }
  if (g.type === "exclusion" || name.includes("استبعاد") || name.includes("بدون") || name.includes("exclude")) {
    return {
      icon: "🚫",
      accent: "#6b7280",
      text: "#4b5563",
      border: "#9ca3af",
      background: "linear-gradient(180deg, #e5e7eb 0%, #cbd5e1 100%)",
      chipBackground: "linear-gradient(180deg, #f3f4f6 0%, #d1d5db 100%)",
    };
  }
  if (g.type === "kitchen_note" || name.includes("ملاحظة") || name.includes("note")) {
    return {
      icon: "📝",
      accent: "#ec4899",
      text: "#be185d",
      border: "#f472b6",
      background: "linear-gradient(180deg, #fbcfe8 0%, #f472b6 100%)",
      chipBackground: "linear-gradient(180deg, #fce7f3 0%, #f9a8d4 100%)",
    };
  }
  return {
    icon: "✨",
    accent: groupColor(g.type),
    text: "#7c3aed",
    border: "#a78bfa",
    background: "linear-gradient(180deg, #ddd6fe 0%, #a78bfa 100%)",
    chipBackground: "linear-gradient(180deg, #ede9fe 0%, #c4b5fd 100%)",
  };
}

export default function ModifierWizard({ baseProduct, groups, onResult, onCancel, onStepChange: _onStepChange }: Props) {
  const [selections, setSelections] = useState<Record<string, WizardSelection>>(() => {
    const m: Record<string, WizardSelection> = {};
    for (const g of groups) {
      const defaults = g.items.filter((it) => it.isDefault).map((it) => it.itemId);
      const selected = defaults.slice(0, g.maxSelect);
      m[g.groupId] = { groupId: g.groupId, selectedItemIds: selected };
    }
    return m;
  });

  const orderedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [groups]);

  const totalPrice = useMemo(() => {
    let t = baseProduct.price;
    for (const g of orderedGroups) {
      const sel = selections[g.groupId];
      if (!sel) continue;
      for (const itemId of sel.selectedItemIds) {
        const it = g.items.find((x) => x.itemId === itemId);
        if (it) t += it.priceDelta;
      }
    }
    return t;
  }, [baseProduct.price, orderedGroups, selections]);

  const canConfirm = useMemo(() => {
    for (const g of orderedGroups) {
      const sel = selections[g.groupId];
      const count = sel?.selectedItemIds.length || 0;
      if (count < g.minSelect) return false;
      if (g.freeTextRequired && !String(sel?.note || "").trim()) return false;
    }
    return true;
  }, [orderedGroups, selections]);

  const selectionSummary = useMemo(() => {
    const parts: string[] = [baseProduct.name];
    const rows: Array<{ key: string; label: string; value: string; icon: string; accent: string; pending?: boolean }> = [];

    for (const g of orderedGroups) {
      const sel = selections[g.groupId];
      const names = (sel?.selectedItemIds || [])
        .map((itemId) => g.items.find((x) => x.itemId === itemId)?.nameAr || "")
        .filter(Boolean);
      const freeText = String(sel?.note || "").trim();

      const theme = groupAppearance(g);
      if (!names.length && !freeText) {
        if (g.isRequired || g.freeTextRequired) {
          rows.push({
            key: `${g.groupId}-pending`,
            label: g.nameAr,
            value: "لم يكتمل بعد",
            icon: theme.icon,
            accent: theme.accent,
            pending: true,
          });
        }
        continue;
      }

      const pieces = [...names];
      if (freeText) pieces.push(freeText);
      const joined = pieces.join(" + ");
      if (g.type === "cooking" && names.length) {
        parts.push(`سواء: ${joined}`);
      } else if (g.type === "exclusion") {
        parts.push(`بدون: ${joined}`);
      } else if (g.type === "kitchen_note") {
        parts.push(`ملاحظة المطبخ: ${joined}`);
      } else if (g.type === "addon" && names.length) {
        parts.push(`إضافات: ${joined}`);
      } else {
        parts.push(`${g.nameAr}: ${joined}`);
      }

      rows.push({
        key: g.groupId,
        label: g.nameAr,
        value: joined,
        icon: theme.icon,
        accent: theme.accent,
      });
    }

    return {
      title: parts.join(" - "),
      rows,
    };
  }, [baseProduct.name, orderedGroups, selections]);

  const toggleItem = useCallback(
    (groupId: string, itemId: string, maxSelect: number) => {
      setSelections((prev) => {
        const sel = prev[groupId];
        const existing = new Set(sel.selectedItemIds);
        if (existing.has(itemId)) {
          existing.delete(itemId);
        } else {
          if (existing.size >= maxSelect) {
            const arr = [itemId];
            return { ...prev, [groupId]: { ...sel, selectedItemIds: arr } };
          }
          existing.add(itemId);
        }
        return { ...prev, [groupId]: { ...sel, selectedItemIds: Array.from(existing) } };
      });
    },
    []
  );

  const updateNote = useCallback((groupId: string, note: string) => {
    setSelections((prev) => {
      const sel = prev[groupId] || { groupId, selectedItemIds: [], note: "" };
      return { ...prev, [groupId]: { ...sel, note } };
    });
  }, []);

  const handleConfirm = () => {
    if (!canConfirm) return;
    try {
      const result: WizardResult = {
        baseProduct,
        selections: Object.values(selections).filter((s) => s.selectedItemIds.length > 0 || String(s.note || "").trim().length > 0),
        totalPrice,
      };
      onResult(result);
    } catch (e) {
      console.error("[ModifierWizard] confirm error:", e);
      alert("حدث خطأ أثناء الإضافة — راجع Console (F12) للتفاصيل");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0.55rem", gap: "0.6rem", overflow: "hidden" }}>
      {/* Header + unified live summary */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 8,
          padding: "0.55rem 0.7rem",
          borderRadius: 14,
          border: "1px solid rgba(148,163,184,0.22)",
          background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
          boxShadow: "0 6px 16px rgba(15,23,42,0.06)",
          flexShrink: 0,
        }}
      >
        <div style={{ flex: "1 1 520px", minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: "1.03rem", color: "#0f172a", lineHeight: 1.2 }}>
            {baseProduct.name}
          </div>
          <div style={{ fontSize: "0.76rem", color: "var(--muted)", marginTop: 1, fontWeight: 700 }}>
            راجع الاختيارات مباشرة مع الضيف قبل الإرسال
          </div>
          <div
            style={{
              marginTop: 6,
              padding: "0.5rem 0.65rem",
              borderRadius: 12,
              background: "linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)",
              border: "1px solid rgba(34,197,94,0.24)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: "0.74rem", color: "#166534", fontWeight: 900 }}>
                الوصف النهائي قبل الإضافة للسلة
              </div>
              <div style={{ fontSize: "0.86rem", color: "#166534", fontWeight: 900 }}>
                الإجمالي: {formatPrice(totalPrice)} ج.م
              </div>
            </div>
            <div style={{ fontWeight: 900, fontSize: "0.95rem", color: "#14532d", lineHeight: 1.4, overflowWrap: "anywhere", marginTop: 3 }}>
              {selectionSummary.title}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: "12px 20px",
              minWidth: 220,
              borderRadius: 12,
              border: canConfirm ? "1px solid #15803d" : "1px solid #475569",
              background: canConfirm
                ? "linear-gradient(180deg, #22c55e 0%, #15803d 100%)"
                : "linear-gradient(180deg, #475569 0%, #334155 100%)",
              color: "#fff",
              fontWeight: 900,
              fontSize: "0.95rem",
              cursor: canConfirm ? "pointer" : "not-allowed",
              opacity: canConfirm ? 1 : 0.5,
              boxShadow: canConfirm ? "0 10px 22px rgba(21,128,61,0.28)" : "none",
            }}
          >
            ✓ تأكيد الاختيار وإضافة للسلة
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid rgba(239,68,68,0.42)",
              background: "linear-gradient(180deg, #fff1f2 0%, #fecdd3 100%)",
              color: "#be123c",
              fontWeight: 800,
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            ✕ إلغاء
          </button>
        </div>
      </div>

      {/* Groups Grid */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingBottom: "0.35rem", overscrollBehavior: "contain" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: "0.8rem",
            alignContent: "start",
            minHeight: "100%",
          }}
        >
          {orderedGroups.map((g) => {
            const sel = selections[g.groupId];
            const selectedCount = sel?.selectedItemIds.length || 0;
            const theme = groupAppearance(g);
            return (
              <div
                key={g.groupId}
                style={{
                  border: `1px solid ${theme.border}`,
                  borderTop: `4px solid ${theme.accent}`,
                  borderRadius: 14,
                  padding: "0.72rem",
                  background: theme.background,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.55rem",
                  minHeight: 172,
                  boxShadow: "0 10px 22px rgba(15,23,42,0.14)",
                }}
              >
                {/* Group header */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: theme.chipBackground,
                      border: `1px solid ${theme.border}`,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1rem",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45)",
                    }}
                  >
                    {theme.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: "0.98rem", color: theme.text, lineHeight: 1.15, overflowWrap: "anywhere" }}>{g.nameAr}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 4 }}>
                      {g.isRequired ? (
                        <span style={{ color: "#b91c1c", fontSize: "0.68rem", fontWeight: 800 }}>إجباري</span>
                      ) : (
                        <span style={{ color: "#475569", fontSize: "0.68rem", fontWeight: 700 }}>اختياري</span>
                      )}
                      <span style={{ color: "#475569", fontSize: "0.74rem", fontWeight: 800 }}>
                        {selectedCount}/{g.maxSelect}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Items as horizontal toggle buttons */}
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "0.45rem", alignContent: "flex-start" }}>
                  {g.items.map((it) => {
                    const selected = !!sel?.selectedItemIds.includes(it.itemId);
                    const itemColor = g.type === "cooking" ? cookingItemColor(it.nameAr) : theme.accent;
                    return (
                      <button
                        key={it.itemId}
                        type="button"
                        onClick={() => toggleItem(g.groupId, it.itemId, g.maxSelect)}
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                          padding: "0.65rem 0.75rem",
                          borderRadius: 11,
                          border: selected ? `2px solid ${itemColor}` : "1px solid rgba(148,163,184,0.2)",
                          background: selected
                            ? `linear-gradient(180deg, ${itemColor} 0%, ${itemColor}dd 100%)`
                            : "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.75) 100%)",
                          color: selected ? "#fff" : itemColor,
                          cursor: "pointer",
                          fontSize: "0.9rem",
                          fontWeight: selected ? 900 : 800,
                          transition: "all 0.15s ease",
                          textAlign: "center",
                          position: "relative",
                          overflow: "hidden",
                          minWidth: 0,
                          minHeight: 40,
                          flex: "1 1 100%",
                          lineHeight: 1.15,
                          boxShadow: selected ? `0 8px 16px ${itemColor}40` : "0 2px 5px rgba(15,23,42,0.1)",
                        }}
                      >
                        {/* Glow indicator when selected */}
                        {selected && (
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              background: `linear-gradient(135deg, rgba(255,255,255,0.22) 0%, transparent 72%)`,
                              pointerEvents: "none",
                            }}
                          />
                        )}
                        <span style={{ position: "relative", zIndex: 1, overflowWrap: "anywhere" }}>{it.nameAr}</span>
                        {it.priceDelta > 0 ? (
                          <span
                            style={{
                              color: selected ? "#86efac" : "#22c55e",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              position: "relative",
                              zIndex: 1,
                              marginRight: 6,
                            }}
                          >
                            +{formatPrice(it.priceDelta)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {g.allowFreeText ? (
                  <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                    <label style={{ color: theme.text, fontSize: "0.8rem", fontWeight: 900 }}>
                      {g.freeTextLabel || `مواصفات ${g.nameAr}`}
                      {g.freeTextRequired ? " *" : ""}
                    </label>
                    <textarea
                      value={String(sel?.note || "")}
                      onChange={(e) => updateNote(g.groupId, e.target.value.slice(0, g.freeTextMaxLength || 180))}
                      placeholder={g.freeTextPlaceholder || "اكتب مواصفات إضافية"}
                      rows={3}
                      style={{
                        width: "100%",
                        minHeight: 74,
                        resize: "vertical",
                        borderRadius: 10,
                        border: `1px solid ${theme.border}`,
                        background: "rgba(255,255,255,0.9)",
                        color: "#0f172a",
                        padding: "0.6rem 0.7rem",
                        fontSize: "0.84rem",
                        fontWeight: 700,
                        lineHeight: 1.35,
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.72rem", fontWeight: 800 }}>
                      <span style={{ color: g.freeTextRequired && !String(sel?.note || "").trim() ? "#b91c1c" : "#475569" }}>
                        {g.freeTextRequired ? "مطلوب كتابة مواصفة لهذه الشريحة" : "يمكن تركها فارغة عند عدم الحاجة"}
                      </span>
                      <span style={{ color: "#475569" }}>
                        {String(sel?.note || "").trim().length}/{g.freeTextMaxLength || 180}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
