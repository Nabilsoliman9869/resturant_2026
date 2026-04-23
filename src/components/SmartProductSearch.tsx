import { useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/apiBase";

type ProductHit = {
    CardGuide: string;
    ProductName: string;
    AgentPrice?: number;
};

type ProductHitContext = {
    title?: string;
    lines: string[];
};

function normArabic(s: string) {
    const t = (s || "").toLowerCase();
    return t
        .normalize("NFKD")
        .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // حركات وتطويل
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/ة/g, "ه")
        .trim();
}

export default function SmartProductSearch({
    onSelect,
    placeholder = "ابحث باسم الصنف…",
    getContext,
}: {
    onSelect: (hit: ProductHit) => void;
    placeholder?: string;
    getContext?: (hit: ProductHit) => ProductHitContext | null;
}) {
    const base = getApiBase();
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<ProductHit[]>([]);
    const [busy, setBusy] = useState(false);
    const timer = useRef<number | null>(null);

    useEffect(() => {
        if (timer.current) window.clearTimeout(timer.current);
        const qq = q.trim();
        if (qq.length < 2) {
            setHits([]);
            return;
        }
        setBusy(true);
        timer.current = window.setTimeout(async () => {
            try {
                const r = await fetch(`${base}/api/products/search?search_text=${encodeURIComponent(qq)}`);
                const j = await r.json().catch(() => ({}));
                const arr = Array.isArray(j.products) ? j.products : [];
                const unique = new Map<string, ProductHit>();
                for (const p of arr) {
                    const id = String(p.CardGuide || p.ProductGuide || "");
                    if (!id) continue;
                    unique.set(id, { CardGuide: id, ProductName: String(p.ProductName || ""), AgentPrice: Number(p.AgentPrice || 0) });
                }
                const list = Array.from(unique.values());
                // lightweight client-side boost using normalized includes
                const nq = normArabic(qq);
                list.sort((a, b) => {
                    const an = normArabic(a.ProductName);
                    const bn = normArabic(b.ProductName);
                    const ai = an.indexOf(nq);
                    const bi = bn.indexOf(nq);
                    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
                });
                setHits(list.slice(0, 20));
            } catch {
                setHits([]);
            } finally {
                setBusy(false);
            }
        }, 220);
        return () => {
            if (timer.current) window.clearTimeout(timer.current);
        };
    }, [q, base]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && hits.length) {
            onSelect(hits[0]);
            setQ("");
            setHits([]);
            e.preventDefault();
        }
    };

    const openHitContext = (hit: ProductHit): boolean => {
        if (!getContext) return false;
        const ctx = getContext(hit);
        if (!ctx) return false;
        const header = ctx.title ? `${ctx.title}\n` : "";
        const body = (ctx.lines || []).join("\n");
        window.alert(`${header}${body}`.trim());
        return true;
    };

    return (
        <div style={{ position: "relative", marginBottom: "0.75rem" }}>
            <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                style={{
                    width: "100%",
                    fontSize: "1.15rem",
                    padding: "12px 14px",
                    border: "2px solid var(--border)",
                    borderRadius: 12,
                    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
                }}
                aria-label="بحث عن صنف"
            />
            {q && (
                <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 10, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, marginTop: 6, maxHeight: 280, overflowY: "auto" }}>
                    {busy && hits.length === 0 ? (
                        <div style={{ padding: 10, color: "var(--muted)" }}>بحث…</div>
                    ) : hits.length === 0 ? (
                        <div style={{ padding: 10, color: "var(--muted)" }}>لا نتائج</div>
                    ) : (
                        hits.map((h) => (
                            <button
                                key={h.CardGuide}
                                type="button"
                                onClick={() => {
                                    onSelect(h);
                                    setQ("");
                                    setHits([]);
                                }}
                                onContextMenu={(e) => {
                                    if (!openHitContext(h)) return;
                                    e.preventDefault();
                                }}
                                onMouseDown={(e) => {
                                    if (e.button !== 2) return;
                                    if (!openHitContext(h)) return;
                                    e.preventDefault();
                                }}
                                onAuxClick={(e) => {
                                    if (e.button !== 2) return;
                                    if (!openHitContext(h)) return;
                                    e.preventDefault();
                                }}
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    width: "100%",
                                    textAlign: "right",
                                    padding: "10px 12px",
                                    borderBottom: "1px solid var(--border)",
                                    background: "#fff",
                                    cursor: "pointer",
                                }}
                            >
                                <div>
                                    <div style={{ fontWeight: 700 }}>{h.ProductName}</div>
                                    <div style={{ color: "var(--muted)", fontSize: "0.85rem", fontFamily: "monospace" }}>{h.CardGuide}</div>
                                </div>
                                <div style={{ fontWeight: 700 }}>{Math.round(h.AgentPrice || 0)} ج.م</div>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

