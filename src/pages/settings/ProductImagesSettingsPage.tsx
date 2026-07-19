import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const groupsSectionRef = useRef<HTMLElement | null>(null);
  const productsSectionRef = useRef<HTMLElement | null>(null);

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
  const [busyProducts, setBusyProducts] = useState(false);
  const [busyGroups, setBusyGroups] = useState(false);
  const [msg, setMsg] = useState("");

  const loadProducts = useCallback(async () => {
    setBusyProducts(true);
    try {
      const [pr, mr] = await Promise.all([
        fetch(`${base}/api/products`),
        fetch(`${base}/api/products/image-manifest`).catch(() => new Response("{}")),
      ]);
      const pj = await pr.json().catch(() => ({}));
      const mj = await mr.json().catch(() => ({}));
      const rows: ProductRow[] = Array.isArray(pj.products) ? pj.products : [];
      const images = mj?.images && typeof mj.images === "object" ? mj.images : {};
      setProducts(rows);
      setManifest(images);
      const nextDraft: Record<string, string> = {};
      for (const p of rows) {
        const gid = String(p.CardGuide || "").toUpperCase();
        const fromManifest = images?.[gid]?.image ? String(images[gid].image) : "";
        nextDraft[p.CardGuide] = fromManifest || p.imageUrl || p.image || "";
      }
      setLinkDraft(nextDraft);
    } catch (e) {
      setMsg(`تعذر تحميل الأصناف (TBL007): ${String(e)}`);
    } finally {
      setBusyProducts(false);
    }
  }, [base]);

  const loadGroups = useCallback(async () => {
    setBusyGroups(true);
    try {
      const [gr, gmr] = await Promise.all([
        fetch(`${base}/api/product-groups`),
        fetch(`${base}/api/product-groups/image-manifest`).catch(() => new Response("{}")),
      ]);
      const gj = await gr.json().catch(() => ({}));
      const gmj = await gmr.json().catch(() => ({}));
      const gRows: GroupRow[] = Array.isArray(gj.groups) ? gj.groups : [];
      const gImages = gmj?.images && typeof gmj.images === "object" ? gmj.images : {};
      setGroups(gRows);
      setGroupManifest(gImages);
      const nextGroupDraft: Record<string, string> = {};
      for (const g of gRows) {
        const gid = String(g.CardGuide || "").toUpperCase();
        const fromManifest = gImages?.[gid]?.image ? String(gImages[gid].image) : "";
        nextGroupDraft[g.CardGuide] = fromManifest || g.imageUrl || g.image || "";
      }
      setGroupLinkDraft(nextGroupDraft);
    } catch (e) {
      setMsg(`تعذر تحميل المجموعات (TBL006): ${String(e)}`);
    } finally {
      setBusyGroups(false);
    }
  }, [base]);

  const loadAll = useCallback(async () => {
    setMsg("");
    await Promise.all([loadProducts(), loadGroups()]);
  }, [loadProducts, loadGroups]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

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

  function scrollToSection(ref: { current: HTMLElement | null }) {
    window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  async function bootstrapMenu() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/menu/bootstrap`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "فشل bootstrap");
      setMsg("تم التأكد من جداول المنيو وحقول الصور (TBL006 + TBL007).");
      await loadAll();
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
      setMsg(`[TBL007] تمت مزامنة ${Number(j.updated || 0)} رابطاً من product_images.json إلى الأصناف.`);
      await loadProducts();
      scrollToSection(productsSectionRef);
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
      setMsg(`[TBL006] تمت مزامنة ${Number(j.updated || 0)} رابطاً من group_images.json إلى المجموعات.`);
      await loadGroups();
      scrollToSection(groupsSectionRef);
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function saveImageLink(cardGuide: string) {
    setMsg("");
    const imageUrl = String(linkDraft[cardGuide] || "").trim();
    if (!imageUrl) {
      setMsg("أدخل رابط صورة الصنف أولاً.");
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
      setMsg(`[TBL007] تم حفظ رابط الصورة.`);
      await loadProducts();
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
      setMsg(`[TBL007] تم رفع الصورة.`);
      await loadProducts();
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
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        dbUpdated?: boolean;
        rowsUpdated?: number;
        manifestSaved?: boolean;
      };
      if (!r.ok) throw new Error(String(j.detail || "فشل حفظ رابط المجموعة"));
      if (j.dbUpdated === false) {
        setMsg(
          `[TBL006] تحذير: ${String(j.detail || "لم يُكتب في SQL")}\n` +
            "ابحث في SSMS عن العمود GroupImageUrl (وليس CardImage). جرّب «مزامنة JSON → TBL006» بعد التأكد من الاتصال.",
        );
      } else {
        setMsg(`[TBL006] تم الحفظ في SQL (GroupImageUrl) + group_images.json — صفوف: ${j.rowsUpdated ?? 1}.`);
      }
      await loadGroups();
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
      setMsg(`[TBL006] تم رفع صورة المجموعة.`);
      await loadGroups();
    } catch (e) {
      setMsg(String(e));
    }
  }

  const busy = busyProducts || busyGroups;

  return (
    <div className="card product-images-settings" style={{ padding: "1rem" }}>
      <h2 style={{ marginTop: 0 }}>إدارة صور المنيو</h2>
      <p style={{ margin: "0 0 12px", fontSize: "0.88rem", color: "var(--muted)", lineHeight: 1.5 }}>
        عند التشغيل: أسماء وروابط الصور من <strong>SQL</strong> (<code>ProductImageUrl</code> /{" "}
        <code>GroupImageUrl</code>). ملفات JSON للمزامنة اليدوية فقط؛ الرفع يحدّث SQL + ملف على القرص ({" "}
        <code>CardImage</code> في SQL اختياري من إكسترا القديم — لا نملؤه تلقائياً).
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" className="btn btn-secondary" onClick={() => void bootstrapMenu()} disabled={busy}>
          تهيئة المنيو والجداول
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void loadAll()} disabled={busy}>
          تحديث الكل
        </button>
      </div>

      {msg ? (
        <div
          role="status"
          style={{
            marginBottom: 14,
            color: msg.includes("تم") ? "var(--ok)" : "var(--danger)",
            fontWeight: 700,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg}
        </div>
      ) : null}

      <section ref={productsSectionRef} className="product-images-settings__section" aria-labelledby="prod-images-h">
        <div className="product-images-settings__section-head">
          <div>
            <h3 id="prod-images-h" style={{ margin: 0 }}>
              صور الأصناف (TBL007)
            </h3>
            <p className="product-images-settings__hint">
              القائمة من <code>/api/products</code> — المزامنة من <code>config/restaurant/product_images.json</code>
            </p>
          </div>
          <div className="product-images-settings__section-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void syncManifestToDb()} disabled={busyProducts}>
              مزامنة JSON → TBL007
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void loadProducts()} disabled={busyProducts}>
              تحديث الأصناف
            </button>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="product-images-settings__search-label" htmlFor="prod-img-search">
            بحث في الأصناف (TBL007)
          </label>
          <input
            id="prod-img-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="اسم الصنف..."
          />
          <span className="product-images-settings__count">
            {filtered.length} / {products.length} صنف
            {busyProducts ? " · جاري التحميل…" : ""}
          </span>
        </div>
        <div className="product-images-settings__list">
          {filtered.map((p) => {
            const gid = String(p.CardGuide || "").toUpperCase();
            const preview = resolveMediaUrl(
              manifest[gid]?.image ||
                p.imageUrl ||
                p.image ||
                `${base}/api/products/${encodeURIComponent(p.CardGuide)}/image`,
            );
            return (
              <div key={p.CardGuide} className="product-images-settings-row">
                <div className="product-images-settings-row__thumb">
                  <img
                    key={preview}
                    src={preview}
                    alt={p.ProductName}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div>
                  <div className="product-images-settings-row__title">{p.ProductName}</div>
                  <div className="product-images-settings-row__meta">
                    {p.CardGuide} · {Number(p.Price || 0).toFixed(2)} ج.م
                  </div>
                  <div className="product-images-settings-row__actions">
                    <input
                      value={linkDraft[p.CardGuide] || ""}
                      onChange={(e) => setLinkDraft((prev) => ({ ...prev, [p.CardGuide]: e.target.value }))}
                      placeholder="https://... أو /api/products/{guid}/image"
                    />
                    <button type="button" className="btn btn-secondary" onClick={() => void saveImageLink(p.CardGuide)}>
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
      </section>

      <section
        ref={groupsSectionRef}
        className="product-images-settings__section product-images-settings__section--groups"
        aria-labelledby="grp-images-h"
      >
        <div className="product-images-settings__section-head">
          <div>
            <h3 id="grp-images-h" style={{ margin: 0 }}>
              صور مجموعات الأصناف (TBL006)
            </h3>
            <p className="product-images-settings__hint">
              القائمة من <code>/api/product-groups</code> — المزامنة من <code>config/restaurant/group_images.json</code>
            </p>
          </div>
          <div className="product-images-settings__section-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void syncGroupManifestToDb()} disabled={busyGroups}>
              مزامنة JSON → TBL006
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void loadGroups()} disabled={busyGroups}>
              تحديث المجموعات
            </button>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="product-images-settings__search-label" htmlFor="grp-img-search">
            بحث في المجموعات (TBL006)
          </label>
          <input
            id="grp-img-search"
            value={groupQuery}
            onChange={(e) => setGroupQuery(e.target.value)}
            placeholder="اسم المجموعة..."
          />
          <span className="product-images-settings__count">
            {filteredGroups.length} / {groups.length} مجموعة
            {busyGroups ? " · جاري التحميل…" : ""}
          </span>
        </div>
        <div className="product-images-settings__list">
          {filteredGroups.map((g) => {
            const gid = String(g.CardGuide || "").toUpperCase();
            const preview = resolveMediaUrl(
              groupManifest[gid]?.image ||
                g.imageUrl ||
                g.image ||
                `${base}/api/product-groups/${encodeURIComponent(g.CardGuide)}/image`,
            );
            return (
              <div key={`grp-${g.CardGuide}`} className="product-images-settings-row">
                <div className="product-images-settings-row__thumb">
                  <img
                    key={preview}
                    src={preview}
                    alt={g.GroupName}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div>
                  <div className="product-images-settings-row__title">{g.GroupName}</div>
                  <div className="product-images-settings-row__meta">{g.CardGuide}</div>
                  <div className="product-images-settings-row__actions">
                    <input
                      value={groupLinkDraft[g.CardGuide] || ""}
                      onChange={(e) => setGroupLinkDraft((prev) => ({ ...prev, [g.CardGuide]: e.target.value }))}
                      placeholder="https://... أو /api/product-groups/{guid}/image"
                    />
                    <button type="button" className="btn btn-secondary" onClick={() => void saveGroupImageLink(g.CardGuide)}>
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
      </section>
    </div>
  );
}
