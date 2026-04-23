import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type ProductRow = {
  CardGuide: string;
  ProductName: string;
  Price?: number;
  GroupGuid?: string | null;
  image?: string;
  imageUrl?: string;
};
type GroupRow = {
  CardGuide: string;
  GroupName: string;
  image?: string;
  imageUrl?: string;
};

type ManifestRecord = { image?: string; updatedAt?: string };

export default function ProductImagesSettingsPage() {
  const base = getApiBase();
  const resolveMediaUrl = (u?: string) => {
    const raw = String(u || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("data:")) return raw;
    return `${base}${raw.startsWith("/") ? "" : "/"}${raw}`;
  };
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [manifest, setManifest] = useState<Record<string, ManifestRecord>>({});
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupManifest, setGroupManifest] = useState<Record<string, ManifestRecord>>({});
  const [query, setQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({});
  const [groupLinkDraft, setGroupLinkDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const [pr, mr, gr, gmr] = await Promise.all([
        fetch(`${base}/api/products`),
        fetch(`${base}/api/products/image-manifest`).catch(() => new Response("{}")),
        fetch(`${base}/api/product-groups`),
        fetch(`${base}/api/product-groups/image-manifest`).catch(() => new Response("{}")),
      ]);
      const pj = await pr.json().catch(() => ({}));
      const mj = await mr.json().catch(() => ({}));
      const gj = await gr.json().catch(() => ({}));
      const gmj = await gmr.json().catch(() => ({}));
      const rows: ProductRow[] = Array.isArray(pj.products) ? pj.products : [];
      const gRows: GroupRow[] = Array.isArray(gj.groups) ? gj.groups : [];
      setProducts(rows);
      setGroups(gRows);
      const images = mj?.images && typeof mj.images === "object" ? mj.images : {};
      const gImages = gmj?.images && typeof gmj.images === "object" ? gmj.images : {};
      setManifest(images);
      setGroupManifest(gImages);
      const nextDraft: Record<string, string> = {};
      for (const p of rows) {
        const gid = String(p.CardGuide || "").toUpperCase();
        const fromManifest = images?.[gid]?.image ? String(images[gid].image) : "";
        nextDraft[p.CardGuide] = fromManifest || p.imageUrl || p.image || "";
      }
      setLinkDraft(nextDraft);
      const nextGroupDraft: Record<string, string> = {};
      for (const g of gRows) {
        const gid = String(g.CardGuide || "").toUpperCase();
        const fromManifest = gImages?.[gid]?.image ? String(gImages[gid].image) : "";
        nextGroupDraft[g.CardGuide] = fromManifest || g.imageUrl || g.image || "";
      }
      setGroupLinkDraft(nextGroupDraft);
    } catch (e) {
      setMsg(`تعذر التحميل: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => String(p.ProductName || "").toLowerCase().includes(q));
  }, [products, query]);
  const filteredGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => String(g.GroupName || "").toLowerCase().includes(q));
  }, [groups, groupQuery]);

  async function bootstrapMenu() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/menu/bootstrap`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "فشل bootstrap");
      setMsg("تم التأكد من جداول المنيو وحقول الصور.");
      void load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function syncManifestToDb() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/products/image-manifest/sync-to-db`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "فشل المزامنة");
      setMsg(`تمت مزامنة ${Number(j.updated || 0)} روابط صورة إلى TBL007.`);
      void load();
    } catch (e) {
      setMsg(String(e));
    }
  }
  async function syncGroupManifestToDb() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/product-groups/image-manifest/sync-to-db`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "فشل مزامنة المجموعات");
      setMsg(`تمت مزامنة ${Number(j.updated || 0)} روابط صورة إلى TBL006.`);
      void load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function saveImageLink(cardGuide: string) {
    setMsg("");
    const imageUrl = String(linkDraft[cardGuide] || "").trim();
    if (!imageUrl) {
      setMsg("أدخل رابط صورة أولاً.");
      return;
    }
    try {
      const r = await fetch(`${base}/api/products/${encodeURIComponent(cardGuide)}/image-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "فشل حفظ الرابط");
      setMsg(`تم حفظ رابط الصورة لـ ${cardGuide}.`);
      void load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function uploadImage(cardGuide: string, file: File | null) {
    if (!file) return;
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${base}/api/products/${encodeURIComponent(cardGuide)}/image`, {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "فشل رفع الصورة");
      setMsg(`تم رفع صورة ${cardGuide}.`);
      void load();
    } catch (e) {
      setMsg(String(e));
    }
  }
  async function saveGroupImageLink(cardGuide: string) {
    setMsg("");
    const imageUrl = String(groupLinkDraft[cardGuide] || "").trim();
    if (!imageUrl) {
      setMsg("أدخل رابط صورة المجموعة أولاً.");
      return;
    }
    try {
      const r = await fetch(`${base}/api/product-groups/${encodeURIComponent(cardGuide)}/image-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "فشل حفظ رابط المجموعة");
      setMsg(`تم حفظ رابط صورة المجموعة ${cardGuide}.`);
      void load();
    } catch (e) {
      setMsg(String(e));
    }
  }
  async function uploadGroupImage(cardGuide: string, file: File | null) {
    if (!file) return;
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${base}/api/product-groups/${encodeURIComponent(cardGuide)}/image`, {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "فشل رفع صورة المجموعة");
      setMsg(`تم رفع صورة المجموعة ${cardGuide}.`);
      void load();
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div className="card" style={{ padding: "1rem" }}>
      <h2 style={{ marginTop: 0 }}>إدارة صور المنيو</h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button className="btn btn-secondary" onClick={() => void bootstrapMenu()} disabled={busy}>
          تهيئة المنيو والجداول
        </button>
        <button className="btn btn-secondary" onClick={() => void syncManifestToDb()} disabled={busy}>
          مزامنة JSON → قاعدة البيانات
        </button>
        <button className="btn btn-secondary" onClick={() => void syncGroupManifestToDb()} disabled={busy}>
          مزامنة صور المجموعات (TBL006)
        </button>
        <button className="btn btn-secondary" onClick={() => void load()} disabled={busy}>
          تحديث
        </button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث باسم الصنف..."
          style={{ width: "100%", maxWidth: 380, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
      </div>

      {msg ? (
        <div style={{ marginBottom: 10, color: msg.includes("تم") ? "#14532d" : "#b91c1c", fontWeight: 700 }}>{msg}</div>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map((p) => {
          const gid = String(p.CardGuide || "").toUpperCase();
          const preview = resolveMediaUrl(manifest[gid]?.image || p.imageUrl || p.image || `${base}/api/products/${encodeURIComponent(p.CardGuide)}/image`);
          return (
            <div
              key={p.CardGuide}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10,
                background: "#fff",
                display: "grid",
                gap: 8,
                gridTemplateColumns: "110px 1fr",
              }}
            >
              <div style={{ width: 100, height: 100, borderRadius: 10, overflow: "hidden", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <img
                  src={preview}
                  alt={p.ProductName}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 800 }}>{p.ProductName}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: 6 }}>
                  {p.CardGuide} · {Number(p.Price || 0).toFixed(2)} ج.م
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    value={linkDraft[p.CardGuide] || ""}
                    onChange={(e) => setLinkDraft((prev) => ({ ...prev, [p.CardGuide]: e.target.value }))}
                    placeholder="https://... أو /api/products/{guid}/image"
                    style={{ flex: 1, minWidth: 220, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                  <button className="btn btn-secondary" onClick={() => void saveImageLink(p.CardGuide)}>
                    حفظ الرابط
                  </button>
                  <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
                    رفع صورة
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => void uploadImage(p.CardGuide, e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <h3 style={{ margin: 0 }}>صور مجموعات الأصناف (TBL006)</h3>
        <div style={{ margin: "8px 0 10px" }}>
          <input
            value={groupQuery}
            onChange={(e) => setGroupQuery(e.target.value)}
            placeholder="بحث باسم المجموعة..."
            style={{ width: "100%", maxWidth: 380, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
          />
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {filteredGroups.map((g) => {
            const gid = String(g.CardGuide || "").toUpperCase();
            const preview = resolveMediaUrl(groupManifest[gid]?.image || g.imageUrl || g.image || `${base}/api/product-groups/${encodeURIComponent(g.CardGuide)}/image`);
            return (
              <div
                key={`grp-${g.CardGuide}`}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 10,
                  background: "#fff",
                  display: "grid",
                  gap: 8,
                  gridTemplateColumns: "110px 1fr",
                }}
              >
                <div style={{ width: 100, height: 100, borderRadius: 10, overflow: "hidden", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <img
                    src={preview}
                    alt={g.GroupName}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div>
                  <div style={{ fontWeight: 800 }}>{g.GroupName}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: 6 }}>{g.CardGuide}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input
                      value={groupLinkDraft[g.CardGuide] || ""}
                      onChange={(e) => setGroupLinkDraft((prev) => ({ ...prev, [g.CardGuide]: e.target.value }))}
                      placeholder="https://... أو /api/product-groups/{guid}/image"
                      style={{ flex: 1, minWidth: 220, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)" }}
                    />
                    <button className="btn btn-secondary" onClick={() => void saveGroupImageLink(g.CardGuide)}>
                      حفظ الرابط
                    </button>
                    <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
                      رفع صورة
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => void uploadGroupImage(g.CardGuide, e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
