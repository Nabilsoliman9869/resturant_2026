import { useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { networkErrorResponse, safeFetch } from "../lib/safeFetch";

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
  const [cfgDb, setCfgDb] = useState<string | null>(null);
  const [serverLabel, setServerLabel] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [dbDetail, setDbDetail] = useState<string | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeText, setProbeText] = useState<string | null>(null);

  async function runConnectionProbe() {
    const base = getApiBase();
    setProbeBusy(true);
    setProbeText(null);
    const lines: string[] = [];
    const urls: Array<[string, string]> = [
      ["GET /api/ping", `${base}/api/ping`],
      ["GET /api/ready (بدون فحص DB)", `${base}/api/ready`],
      ["GET /api/ready?check_db=1", `${base}/api/ready?check_db=1`],
      ["GET /api/settings/connection", `${base}/api/settings/connection`],
      ["GET /api/agents/by-group-name (owners&vip)", `${base}/api/agents/by-group-name?group_name=${encodeURIComponent("owners&vip")}`],
    ];
    for (const [label, url] of urls) {
      const t0 = performance.now();
      try {
        const r = await fetch(url, { cache: "no-store" });
        const ms = Math.round(performance.now() - t0);
        lines.push(`${label}\n  → HTTP ${r.status} • ${ms} ms`);
      } catch (e) {
        const ms = Math.round(performance.now() - t0);
        lines.push(`${label}\n  → خطأ شبكة بعد ${ms} ms:\n  ${String(e)}`);
      }
    }
    lines.push("");
    lines.push("تفسير سريع:");
    lines.push("• HTTP غير 200 أو خطأ شبكة → الخادم متوقف، أو المنفذ خطأ، أو انقطاع فعلي.");
    lines.push("• كل الطلبات سريعة وـ200 لكن الواجهة «ترتعش» → غالباً استطلاع متكرر أو بطء طلب معيّن (نسخ النص أعلاه للمطوّر).");
    setProbeText(lines.join("\n"));
    setProbeBusy(false);
  }

  useEffect(() => {
    let cancelled = false;
    const pollCountRef = { current: 0 };

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
        /** أولاً: ping خفيف — يثبت أن FastAPI يعمل حتى لو فحص ODBC في /ready بطيء أو فاشل */
        const [rPing, rCfg] = await Promise.all([
          safeFetch(`${base}/api/ping`),
          safeFetch(`${base}/api/settings/connection`),
        ]);
        const { cfgDb: cfgDbParsed, cfgServer } = await parseConnectionCfg(rCfg.ok ? rCfg : networkErrorResponse());
        if (!cancelled) {
          setCfgDb(cfgDbParsed);
        }

        let apiAlive = false;
        if (rPing.ok) {
          try {
            const pj = (await rPing.json()) as { ok?: boolean };
            apiAlive = pj?.ok === true;
          } catch {
            apiAlive = false;
          }
        }

        if (!apiAlive) {
          if (!cancelled) {
            setApiDown(true);
            setOk(false);
            setDbName(cfgDbParsed);
            setServerLabel(cfgServer);
            setDbDetail(null);
          }
          return;
        }

        if (!cancelled) setApiDown(false);

        pollCountRef.current += 1;
        const deepDbCheck = pollCountRef.current === 1 || pollCountRef.current % 5 === 0;
        const rReady = await safeFetch(
          deepDbCheck ? `${base}/api/ready?check_db=1` : `${base}/api/ready`,
        );
        if (cancelled) return;
        if (!rReady.ok) {
          setOk(false);
          setDbName(cfgDbParsed);
          setServerLabel(cfgServer);
          setDbDetail("تعذر فحص الخادم");
          return;
        }
        const j = (await rReady.json()) as { database?: ReadyDb };
        const db = j.database;
        const st = db?.status;
        if (deepDbCheck) {
          setOk(st === "ok");
          const liveName = db?.databaseName?.trim() || null;
          setDbName(liveName || cfgDbParsed);
          setServerLabel(db?.serverLabel?.trim() || cfgServer);
          setDbDetail(st === "ok" ? null : db?.detail?.trim() || st || null);
        } else if (!cancelled) {
          setOk(true);
          setDbName(cfgDbParsed);
          setServerLabel(cfgServer);
          setDbDetail(null);
        }
      } catch {
        try {
          const rCfg = await safeFetch(`${base}/api/settings/connection`);
          const { cfgDb: cfgDbParsed, cfgServer } = await parseConnectionCfg(rCfg.ok ? rCfg : networkErrorResponse());
          if (!cancelled) {
            setCfgDb(cfgDbParsed);
            setDbName(cfgDbParsed);
            setServerLabel(cfgServer);
            setDbDetail(null);
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
    const t = window.setInterval(poll, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const label = apiDown
    ? "API متوقف — شغّل run_full_stack.bat (2288 + 9999)"
    : ok
      ? dbName || cfgDb || "متصل"
      : cfgDb
        ? `SQL غير متصل (${cfgDb})`
        : "لم تُحفَظ إعدادات القاعدة — اتصال القاعدة → حفظ";

  const sub = apiDown ? "http://127.0.0.1:2288/api/ping" : dbDetail || serverLabel || null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 6 : 8,
        maxWidth: compact ? "100%" : 280,
      }}
    >
      <div
        title={
          apiDown
            ? "يجب تشغيل API على 2288 (run_api.bat) والواجهة من Vite على 9999. جرّب: http://127.0.0.1:2288/api/ping"
            : sub || undefined
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: compact ? "0.35rem" : "0.5rem",
          fontSize: compact ? "0.78rem" : "0.85rem",
          color: "var(--muted, #94a3b8)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flexWrap: "wrap",
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
        <span style={{ display: "flex", flexDirection: "column", gap: 0, lineHeight: 1.25, minWidth: 0, flex: "1 1 auto" }}>
          <span style={{ color: "var(--fg, #e2e8f0)" }}>
            {apiDown ? "خدمة API: " : "قاعدة البيانات: "}
            <span style={{ fontWeight: 600 }}>{label}</span>
          </span>
          {!compact && sub ? (
            <span style={{ fontSize: "0.72rem", opacity: 0.85 }}>{sub}</span>
          ) : null}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={probeBusy}
          onClick={() => void runConnectionProbe()}
          style={{
            fontSize: compact ? "0.72rem" : "0.78rem",
            padding: "0.2rem 0.45rem",
            flexShrink: 0,
            fontWeight: 700,
          }}
          title="قياس زمن الاستجابة لعدة مسارات — لتمييز انقطاع الشبكة عن بطء الخادم"
        >
          {probeBusy ? "…" : "فحص"}
        </button>
      </div>
      {probeText ? (
        <pre
          style={{
            margin: 0,
            padding: "0.5rem 0.55rem",
            fontSize: "0.68rem",
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "rgba(0,0,0,0.35)",
            border: "1px solid var(--border, rgba(148,163,184,0.35))",
            borderRadius: 8,
            maxHeight: compact ? 140 : 220,
            overflow: "auto",
          }}
        >
          {probeText}
        </pre>
      ) : null}
    </div>
  );
}
