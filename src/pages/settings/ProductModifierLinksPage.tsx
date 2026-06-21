import { useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type ModifierGroupLite = {
  groupId: string;
  nameAr: string;
  nameEn: string;
  type: string;
  minSelect?: number;
  maxSelect?: number;
  isRequired?: boolean;
  allowFreeText?: boolean;
  freeTextRequired?: boolean;
  freeTextLabel?: string;
  freeTextPlaceholder?: string;
};

type ProductLite = {
  CardGuide: string;
  ProductName: string;
  SalesPrice: number;
  Price: number;
};

type ProductSearchHit = {
  CardGuide: string;
  ProductName: string;
  AgentPrice?: number;
};

type ProductModifierEntry = {
  groupId: string;
  sortOrder: number;
  isEnabled?: boolean;
  isRequired?: boolean | null;
  minSelect?: number | null;
  maxSelect?: number | null;
  allowFreeText?: boolean | null;
  freeTextRequired?: boolean | null;
  freeTextLabel?: string;
  freeTextPlaceholder?: string;
};

type ProductModifierRow = ProductModifierEntry & {
  rowId: string;
};

function makeRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toRow(entry: ProductModifierEntry, fallbackSortOrder = 0): ProductModifierRow {
  return {
    ...entry,
    rowId: makeRowId(),
    sortOrder: Number(entry.sortOrder ?? fallbackSortOrder),
  };
}

function toEntry(row: ProductModifierRow, sortOrder: number): ProductModifierEntry {
  return {
    groupId: String(row.groupId || "").trim(),
    sortOrder,
    isEnabled: row.isEnabled,
    isRequired: row.isRequired,
    minSelect: row.minSelect,
    maxSelect: row.maxSelect,
    allowFreeText: row.allowFreeText,
    freeTextRequired: row.freeTextRequired,
    freeTextLabel: row.freeTextLabel,
    freeTextPlaceholder: row.freeTextPlaceholder,
  };
}

export default function ProductModifierLinksPage() {
  const base = getApiBase();
  const [groups, setGroups] = useState<ModifierGroupLite[]>([]);
  const [rows, setRows] = useState<ProductModifierRow[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedProductGuide, setSelectedProductGuide] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductLite | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productHits, setProductHits] = useState<ProductSearchHit[]>([]);
  const [productSearchBusy, setProductSearchBusy] = useState(false);
  const searchTimerRef = useRef<number | null>(null);

  async function loadAll() {
    setMsg("");
    try {
      const groupsR = await fetch(`${base}/api/restaurant/modifier-groups`);
      const gj = await groupsR.json().catch(() => ({ groups: [] }));
      setGroups(Array.isArray(gj.groups) ? gj.groups : []);
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    async function loadProfile(productGuide: string) {
      if (!productGuide) {
        setRows([]);
        return;
      }
      setBusy(true);
      try {
        const r = await fetch(`${base}/api/restaurant/product-modifiers/${encodeURIComponent(productGuide)}`);
        const j = await r.json().catch(() => ({ entries: [] }));
        const nextEntries: ProductModifierEntry[] = Array.isArray(j.entries) ? (j.entries as ProductModifierEntry[]) : [];
        setRows(nextEntries.map((entry: ProductModifierEntry, idx: number) => toRow(entry, idx)));
      } catch (e) {
        setRows([]);
        setMsg(`تعذر تحميل بروفايل الصنف: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    }
    void loadProfile(selectedProductGuide);
  }, [base, selectedProductGuide]);

  useEffect(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    const q = productSearch.trim();
    if (q.length < 2) {
      setProductHits([]);
      setProductSearchBusy(false);
      return;
    }
    setProductSearchBusy(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`${base}/api/products/search?search_text=${encodeURIComponent(q)}`);
        const j = await r.json().catch(() => ({ products: [] }));
        const arr = Array.isArray(j.products) ? j.products : [];
        const unique = new Map<string, ProductSearchHit>();
        for (const p of arr) {
          const guide = String(p.CardGuide || p.ProductGuide || "").trim();
          if (!guide) continue;
          unique.set(guide, {
            CardGuide: guide,
            ProductName: String(p.ProductName || p.Name || guide),
            AgentPrice: Number(p.AgentPrice || p.Price || 0),
          });
        }
        setProductHits(Array.from(unique.values()).slice(0, 20));
      } catch {
        setProductHits([]);
      } finally {
        setProductSearchBusy(false);
      }
    }, 220);
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    };
  }, [base, productSearch]);

  async function saveProfile(productGuide: string, nextEntries: ProductModifierEntry[]) {
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/product-modifiers/${encodeURIComponent(productGuide)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: nextEntries }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { detail?: string }).detail || `HTTP ${r.status}`);
      const returnedEntries = Array.isArray((j as { entries?: ProductModifierEntry[] }).entries) ? (j as { entries?: ProductModifierEntry[] }).entries || [] : nextEntries;
      setRows(returnedEntries.map((entry, idx) => toRow(entry, idx)));
      setMsg("تم حفظ بروفايل الصنف.");
    } catch (e) {
      setMsg(`فشل حفظ البروفايل: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function selectProduct(hit: ProductSearchHit) {
    setSelectedProductGuide(hit.CardGuide);
    setSelectedProduct({
      CardGuide: hit.CardGuide,
      ProductName: hit.ProductName,
      SalesPrice: Number(hit.AgentPrice || 0),
      Price: Number(hit.AgentPrice || 0),
    });
    setProductSearch(hit.ProductName || hit.CardGuide);
    setProductHits([]);
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        groupId: "",
        sortOrder: prev.length,
        isEnabled: true,
        isRequired: false,
        minSelect: 0,
        maxSelect: 1,
        allowFreeText: true,
        freeTextRequired: false,
        freeTextLabel: "",
        freeTextPlaceholder: "",
      },
    ]);
  }

  function patchRow(rowId: string, patch: Partial<ProductModifierRow>) {
    setRows((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  function applyGroupToRow(rowId: string, groupId: string) {
    const group = groups.find((x) => x.groupId === groupId);
    if (!group) {
      patchRow(rowId, { groupId: "" });
      return;
    }
    setRows((prev) => {
      const duplicate = prev.find((row) => row.rowId !== rowId && row.groupId === groupId);
      if (duplicate) {
        setMsg("هذه الشريحة مضافة بالفعل لهذا الصنف.");
        return prev;
      }
      return prev.map((row) =>
        row.rowId !== rowId
          ? row
          : {
            ...row,
            groupId: group.groupId,
            isEnabled: true,
            isRequired: Boolean(group.isRequired),
            minSelect: Number(group.minSelect ?? 0),
            maxSelect: Number(group.maxSelect ?? 1),
            allowFreeText: Boolean(group.allowFreeText),
            freeTextRequired: Boolean(group.freeTextRequired),
            freeTextLabel: String(group.freeTextLabel || ""),
            freeTextPlaceholder: String(group.freeTextPlaceholder || ""),
          },
      );
    });
  }

  function moveRow(rowId: string, direction: -1 | 1) {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.rowId === rowId);
      if (index < 0) return prev;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const current = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = current;
      return next.map((row, idx) => ({ ...row, sortOrder: idx }));
    });
  }

  const selectedEntries = useMemo(
    () => [...rows].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    [rows],
  );

  const entriesForSave = useMemo(
    () =>
      selectedEntries
        .filter((row) => String(row.groupId || "").trim())
        .map((row, idx) => toEntry(row, idx)),
    [selectedEntries],
  );

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>بروفايل الشرائح لكل صنف</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", maxWidth: 820 }}>
        ابحث باسم الصنف فقط، ثم اختره من النتائج. بعد ذلك أضف أسطر الربط واحدًا تلو الآخر حسب ترتيب ظهور الشرائح داخل الويزارد.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={() => void loadAll()} disabled={busy}>
          تحديث
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !selectedProductGuide}
          onClick={() => void saveProfile(selectedProductGuide, entriesForSave)}
        >
          {busy ? "جاري الحفظ…" : "حفظ بروفايل الصنف"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={!selectedProductGuide} onClick={addRow}>
          + إضافة سطر
        </button>
      </div>

      {msg ? <p style={{ fontSize: "0.85rem" }}>{msg}</p> : null}

      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, position: "relative" }}>
          <div style={{ fontWeight: 800, marginBottom: 8, color: "#f8fafc" }}>اختيار الصنف من البحث</div>
          <input
            placeholder="ابحث باسم الصنف…"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            style={{
              width: "100%",
              color: "#f8fafc",
              background: "rgba(15,23,42,0.72)",
              border: "1px solid rgba(56,189,248,0.45)",
            }}
          />
          {productSearch.trim().length >= 2 ? (
            <div
              style={{
                marginTop: 8,
                border: "1px solid rgba(56,189,248,0.28)",
                borderRadius: 10,
                maxHeight: 260,
                overflowY: "auto",
                background: "rgba(2,6,23,0.94)",
                boxShadow: "0 10px 24px rgba(2,6,23,0.35)",
              }}
            >
              {productSearchBusy ? (
                <div style={{ padding: 10, color: "#cbd5e1" }}>بحث…</div>
              ) : productHits.length === 0 ? (
                <div style={{ padding: 10, color: "#cbd5e1" }}>لا توجد نتائج مطابقة.</div>
              ) : (
                productHits.map((hit) => (
                  <button
                    key={hit.CardGuide}
                    type="button"
                    onClick={() => selectProduct(hit)}
                    style={{
                      display: "flex",
                      width: "100%",
                      justifyContent: "space-between",
                      gap: 12,
                      textAlign: "right",
                      padding: "10px 12px",
                      border: 0,
                      borderBottom: "1px solid rgba(148,163,184,0.18)",
                      background: "transparent",
                      color: "#f8fafc",
                      cursor: "pointer",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, color: "#f8fafc" }}>{hit.ProductName || hit.CardGuide}</div>
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#93c5fd", whiteSpace: "nowrap", fontWeight: 700 }}>
                      {Number(hit.AgentPrice || 0).toFixed(2)} ج.م
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 900, fontSize: "1rem" }}>{selectedProduct?.ProductName || "اختر صنفًا من البحث"}</div>
          <div style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--muted)" }}>
            {selectedProduct ? "تم اختيار الصنف، وسيُستخدم مرجعه الداخلي تلقائيًا عند الحفظ." : "—"}
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {selectedEntries.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>لا توجد أسطر ربط بعد. أضف سطرًا جديدًا ثم اختر الشريحة التي ستظهر أولًا ثم التي تليها.</div>
          ) : (
            selectedEntries.map((row, index) => {
              const group = groups.find((g) => g.groupId === row.groupId);
              const usedGroupIds = new Set(selectedEntries.filter((entry) => entry.rowId !== row.rowId).map((entry) => entry.groupId));
              return (
                <div key={row.rowId} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 900 }}>السطر {index + 1}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                        هذه هي الشريحة رقم {index + 1} التي ستظهر عند اختيار الصنف
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="btn btn-ghost" onClick={() => moveRow(row.rowId, -1)} disabled={index === 0}>↑</button>
                      <button type="button" className="btn btn-ghost" onClick={() => moveRow(row.rowId, 1)} disabled={index === selectedEntries.length - 1}>↓</button>
                      <button type="button" className="btn btn-ghost" onClick={() => setRows((prev) => prev.filter((x) => x.rowId !== row.rowId))}>حذف</button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,1.7fr) minmax(100px,0.5fr) minmax(100px,0.5fr) auto auto", gap: 8, alignItems: "center" }}>
                    <select
                      value={row.groupId}
                      onChange={(e) => applyGroupToRow(row.rowId, e.target.value)}
                    >
                      <option value="">اختر الشريحة لهذه الخطوة</option>
                      {groups.map((g) => (
                        <option key={g.groupId} value={g.groupId} disabled={usedGroupIds.has(g.groupId)}>
                          {g.nameAr || g.groupId}
                        </option>
                      ))}
                    </select>
                    <input type="number" min={0} value={row.minSelect ?? 0} onChange={(e) => patchRow(row.rowId, { minSelect: Math.max(0, Number(e.target.value) || 0) })} placeholder="Min" />
                    <input type="number" min={0} value={row.maxSelect ?? 1} onChange={(e) => patchRow(row.rowId, { maxSelect: Math.max(0, Number(e.target.value) || 0) })} placeholder="Max" />
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={row.isRequired ?? false} onChange={(e) => patchRow(row.rowId, { isRequired: e.target.checked })} />
                      إجباري
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={row.isEnabled !== false} onChange={(e) => patchRow(row.rowId, { isEnabled: e.target.checked })} />
                      مفعّل
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,0.8fr) auto minmax(180px,1fr) minmax(220px,1.4fr)", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 700 }}>
                      {group ? `${group.nameAr} · ${group.type}` : "لم يتم اختيار الشريحة بعد"}
                    </div>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={row.freeTextRequired ?? false} onChange={(e) => patchRow(row.rowId, { freeTextRequired: e.target.checked, allowFreeText: true })} />
                      النص الحر مطلوب
                    </label>
                    <input value={row.freeTextLabel || ""} onChange={(e) => patchRow(row.rowId, { freeTextLabel: e.target.value, allowFreeText: true })} placeholder="عنوان الكتابة الحرة" />
                    <input value={row.freeTextPlaceholder || ""} onChange={(e) => patchRow(row.rowId, { freeTextPlaceholder: e.target.value, allowFreeText: true })} placeholder="Placeholder الكتابة الحرة" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
