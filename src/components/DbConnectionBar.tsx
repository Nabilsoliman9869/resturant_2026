import { useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";

type ReadyDb = {
  status?: string;
  detail?: string | null;
  databaseName?: string | null;
  serverLabel?: string | null;
};

function dotColor(ok: boolean, pending: boolean): string {
  if (pending) return "#888";
  return ok ? "#22c55e" : "#ef4444";
}

export function DbConnectionBar({ compact }: { compact?: boolean }) {
  const [pending, setPending] = useState(true);
  const [ok, setOk] = useState(false);
  const [dbName, setDbName] = useState<string | null>(null);
  const [serverLabel, setServerLabel] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function parseConnectionCfg(r: Response): Promise<{ cfgDb: string | null; cfgServer: string | null }> {
      if (!r.ok) return { cfgDb: null, cfgServer: null };
      try {
        const c = (await r.json()) as { database?: string; server?: string; port?: number | string | null };
        const d = typeof c.database === "string" ? c.database.trim() : "";
        const s = typeof c.server === "string" ? c.server.trim() : "";
        const p = c.port != null && String(c.port).trim() !== "" ? String(c.port).trim() : "";
        return {
          cfgDb: d || null,
          cfgServer: s ? (p ? `${s},${p}` : s) : null,
        };
      } catch {
        return { cfgDb: null, cfgServer: null };
      }
    }

    async function poll() {
      const base = getApiBase();
      try {
        const [rReady, rCfg] = await Promise.all([
          fetch(`${base}/api/ready?check_db=1`, { cache: "no-store" }),
          fetch(`${base}/api/settings/connection`, { cache: "no-store" }),
        ]);
        const { cfgDb, cfgServer } = await parseConnectionCfg(rCfg);
        if (!rReady.ok) {
          if (!cancelled) {
            setApiDown(true);
            setOk(false);
            setDbName(cfgDb);
            setServerLabel(cfgServer);
          }
          return;
        }
        const j = (await rReady.json()) as { database?: ReadyDb };
        if (cancelled) return;
        setApiDown(false);
        const db = j.database;
        const st = db?.status;
        setOk(st === "ok");
        const liveName = db?.databaseName?.trim() || null;
        setDbName(liveName || cfgDb);
        setServerLabel(db?.serverLabel?.trim() || cfgServer);
      } catch {
        try {
          const rCfg = await fetch(`${base}/api/settings/connection`, { cache: "no-store" });
          const { cfgDb, cfgServer } = await parseConnectionCfg(rCfg);
          if (!cancelled) {
            setDbName(cfgDb);
            setServerLabel(cfgServer);
          }
        } catch {
          if (!cancelled) {
            setDbName(null);
            setServerLabel(null);
          }
        }
        if (!cancelled) {
          setApiDown(true);
          setOk(false);
        }
      } finally {
        if (!cancelled) setPending(false);
      }
    }

    poll();
    const t = window.setInterval(poll, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const label = apiDown
    ? "تعذر الاتصال بالخادم"
    : dbName
      ? dbName
      : "لم تُحفَظ إعدادات القاعدة — افتح «اتصال القاعدة» واضغط حفظ";

  const sub = serverLabel ? serverLabel : null;

  return (
    <div
      title={apiDown ? "تحقق من تشغيل API والشبكة" : sub || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? "0.35rem" : "0.5rem",
        fontSize: compact ? "0.78rem" : "0.85rem",
        color: "var(--muted, #94a3b8)",
        whiteSpace: "nowrap",
        maxWidth: compact ? 200 : 280,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: dotColor(ok && !apiDown, pending),
          flexShrink: 0,
        }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 0, lineHeight: 1.25, minWidth: 0 }}>
        <span style={{ color: "var(--fg, #e2e8f0)" }}>
          قاعدة البيانات: <span style={{ fontWeight: 600 }}>{label}</span>
        </span>
        {!compact && sub ? (
          <span style={{ fontSize: "0.72rem", opacity: 0.85 }}>{sub}</span>
        ) : null}
      </span>
    </div>
  );
}
