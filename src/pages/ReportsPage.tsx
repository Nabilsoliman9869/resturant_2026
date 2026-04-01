import { useCallback, useEffect, useMemo, useState } from "react";
import { apiBase } from "../lib/apiBase";

type ReportMeta = {
  id: string;
  name_ar: string;
  name_en: string;
  params: string[];
};

type RunResult = {
  columns: string[];
  rows: unknown[][];
  message?: string;
};

function todayISO() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function monthStartISO() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-01`;
}

function buildRunQuery(p: {
  from_date: string;
  to_date: string;
  account_guide: string;
  agent_guide: string;
  product_guide: string;
  currency_guide: string;
  source_bill_guide: string;
  show_opening_balance: boolean;
  posted_only: boolean;
  show_only_unlinked: boolean;
}): string {
  const u = new URLSearchParams();
  if (p.from_date) u.set("from_date", p.from_date);
  if (p.to_date) u.set("to_date", p.to_date);
  if (p.account_guide.trim()) u.set("account_guide", p.account_guide.trim());
  if (p.agent_guide.trim()) u.set("agent_guide", p.agent_guide.trim());
  if (p.product_guide.trim()) u.set("product_guide", p.product_guide.trim());
  if (p.currency_guide.trim()) u.set("currency_guide", p.currency_guide.trim());
  if (p.source_bill_guide.trim()) u.set("source_bill_guide", p.source_bill_guide.trim());
  if (p.show_opening_balance) u.set("show_opening_balance", "true");
  if (p.posted_only) u.set("posted_only", "true");
  if (p.show_only_unlinked) u.set("show_only_unlinked", "true");
  return u.toString();
}

export default function ReportsPage() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [listErr, setListErr] = useState("");

  const [reportId, setReportId] = useState("");
  const [fromDate, setFromDate] = useState(monthStartISO);
  const [toDate, setToDate] = useState(todayISO);
  const [accountGuide, setAccountGuide] = useState("");
  const [agentGuide, setAgentGuide] = useState("");
  const [productGuide, setProductGuide] = useState("");
  const [currencyGuide, setCurrencyGuide] = useState("");
  const [sourceBillGuide, setSourceBillGuide] = useState("");
  const [showOpeningBalance, setShowOpeningBalance] = useState(false);
  const [postedOnly, setPostedOnly] = useState(false);
  const [showOnlyUnlinked, setShowOnlyUnlinked] = useState(false);

  const [result, setResult] = useState<RunResult | null>(null);
  const [runErr, setRunErr] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);

  const base = apiBase();

  const refreshPing = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/ping`);
      setApiOk(r.ok);
    } catch {
      setApiOk(false);
    }
  }, [base]);

  useEffect(() => {
    refreshPing();
  }, [refreshPing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setListErr("");
      try {
        const r = await fetch(`${base}/api/reports`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const list = (j.reports || []) as ReportMeta[];
        if (!cancelled) {
          setReports(list);
          if (list.length && !reportId) setReportId(list[0].id);
        }
      } catch (e) {
        if (!cancelled) setListErr(e instanceof Error ? e.message : "تعذر جلب التقارير");
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const meta = useMemo(() => reports.find((x) => x.id === reportId), [reports, reportId]);

  const needs = useCallback(
    (name: string) => !!meta?.params?.includes(name),
    [meta],
  );

  const runReport = async (opts?: { forPicklist?: boolean }) => {
    setRunErr("");
    if (!opts?.forPicklist) setResult(null);
    setLoadingRun(true);

    const pickQ = buildRunQuery({
      from_date: needs("from_date") ? fromDate : "",
      to_date: needs("to_date") ? toDate : "",
      account_guide: "",
      agent_guide: "",
      product_guide: "",
      currency_guide: currencyGuide,
      source_bill_guide: sourceBillGuide,
      show_opening_balance: showOpeningBalance,
      posted_only: postedOnly,
      show_only_unlinked: showOnlyUnlinked,
    });

    if (opts?.forPicklist) {
      try {
        const r = await fetch(`${base}/api/reports/${reportId}/run?${pickQ}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
        setResult(j as RunResult);
      } catch (e) {
        setRunErr(e instanceof Error ? e.message : "فشل التحميل");
      } finally {
        setLoadingRun(false);
      }
      return;
    }

    const q = buildRunQuery({
      from_date: needs("from_date") ? fromDate : "",
      to_date: needs("to_date") ? toDate : "",
      account_guide: accountGuide,
      agent_guide: agentGuide,
      product_guide: productGuide,
      currency_guide: currencyGuide,
      source_bill_guide: sourceBillGuide,
      show_opening_balance: showOpeningBalance,
      posted_only: postedOnly,
      show_only_unlinked: showOnlyUnlinked,
    });

    try {
      const r = await fetch(`${base}/api/reports/${reportId}/run?${q}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
      setResult(j as RunResult);
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : "فشل تشغيل التقرير");
    } finally {
      setLoadingRun(false);
    }
  };

  const onPickRow = (row: unknown[]) => {
    if (!result?.columns?.includes("CardGuide")) return;
    const idx = result.columns.indexOf("CardGuide");
    const g = String(row[idx] ?? "").trim();
    if (!g) return;
    if (needs("account_guide")) setAccountGuide(g);
    if (needs("agent_guide")) setAgentGuide(g);
    if (needs("product_guide")) setProductGuide(g);
    setResult(null);
    setRunErr("");
  };

  const showPickHint =
    result?.message &&
    result.rows?.length > 0 &&
    result.columns?.includes("CardGuide");

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>تقارير الحسابات</h2>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        تشغيل من خادم إكسترا: <code style={{ color: "var(--accent2)" }}>{base}</code>
      </p>

      <div className="card" style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <span style={{ color: "var(--muted)" }}>الخادم:</span>
        <span style={{ color: apiOk ? "var(--ok)" : apiOk === false ? "var(--danger)" : "var(--muted)" }}>
          {apiOk === null ? "…" : apiOk ? "متصل" : "غير متصل"}
        </span>
        <button type="button" className="btn btn-ghost" onClick={refreshPing}>
          تحديث
        </button>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        {loadingList ? (
          <span style={{ color: "var(--muted)" }}>جاري تحميل قائمة التقارير…</span>
        ) : listErr ? (
          <span style={{ color: "var(--danger)" }}>{listErr}</span>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>التقرير</label>
              <select
                value={reportId}
                onChange={(e) => {
                  setReportId(e.target.value);
                  setResult(null);
                  setRunErr("");
                }}
                style={{ width: "100%", maxWidth: 480 }}
              >
                {reports.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.name_ar} — {rep.name_en}
                  </option>
                ))}
              </select>
            </div>

            {(needs("from_date") || needs("to_date")) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
                {needs("from_date") && (
                  <div>
                    <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>من تاريخ</label>
                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                  </div>
                )}
                {needs("to_date") && (
                  <div>
                    <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>إلى تاريخ</label>
                    <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                  </div>
                )}
              </div>
            )}

            {needs("account_guide") && (
              <div>
                <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>حساب (CardGuide)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    value={accountGuide}
                    onChange={(e) => setAccountGuide(e.target.value)}
                    placeholder="الصق CardGuide أو اختر من القائمة"
                    style={{ flex: "1 1 280px", minWidth: 200 }}
                  />
                  <button type="button" className="btn btn-ghost" disabled={loadingRun} onClick={() => runReport({ forPicklist: true })}>
                    تحميل قائمة الحسابات
                  </button>
                </div>
              </div>
            )}

            {needs("agent_guide") && (
              <div>
                <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>عميل / طرف (CardGuide)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    value={agentGuide}
                    onChange={(e) => setAgentGuide(e.target.value)}
                    placeholder="الصق CardGuide أو اختر من القائمة"
                    style={{ flex: "1 1 280px", minWidth: 200 }}
                  />
                  <button type="button" className="btn btn-ghost" disabled={loadingRun} onClick={() => runReport({ forPicklist: true })}>
                    تحميل قائمة العملاء
                  </button>
                </div>
              </div>
            )}

            {needs("product_guide") && (
              <div>
                <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>صنف (CardGuide)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    value={productGuide}
                    onChange={(e) => setProductGuide(e.target.value)}
                    placeholder="الصق CardGuide أو اختر من القائمة"
                    style={{ flex: "1 1 280px", minWidth: 200 }}
                  />
                  <button type="button" className="btn btn-ghost" disabled={loadingRun} onClick={() => runReport({ forPicklist: true })}>
                    تحميل قائمة الأصناف
                  </button>
                </div>
              </div>
            )}

            {needs("currency_guide") && (
              <div>
                <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>عملة (اختياري)</label>
                <input
                  value={currencyGuide}
                  onChange={(e) => setCurrencyGuide(e.target.value)}
                  placeholder="CardGuide من TBL001"
                  style={{ width: "100%", maxWidth: 480 }}
                />
              </div>
            )}

            {needs("source_bill_guide") && (
              <div>
                <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>فاتورة مصدر (CardGuide)</label>
                <input
                  value={sourceBillGuide}
                  onChange={(e) => setSourceBillGuide(e.target.value)}
                  style={{ width: "100%", maxWidth: 480 }}
                />
              </div>
            )}

            {needs("show_opening_balance") && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={showOpeningBalance} onChange={(e) => setShowOpeningBalance(e.target.checked)} />
                إظهار رصيد افتتاحي
              </label>
            )}

            {needs("posted_only") && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={postedOnly} onChange={(e) => setPostedOnly(e.target.checked)} />
                مرحّل فقط
              </label>
            )}

            {needs("show_only_unlinked") && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={showOnlyUnlinked} onChange={(e) => setShowOnlyUnlinked(e.target.checked)} />
                غير مرتبط بقيد فقط
              </label>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" disabled={loadingRun || !reportId} onClick={() => runReport()}>
                {loadingRun ? "جاري التشغيل…" : "تشغيل التقرير"}
              </button>
            </div>
          </div>
        )}
      </div>

      {runErr && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--danger)", color: "var(--danger)" }}>
          {runErr}
        </div>
      )}

      {showPickHint && (
        <p style={{ color: "var(--warn)", marginBottom: "0.75rem" }}>
          {result.message} — انقر صفاً لاستخدام <strong>CardGuide</strong>.
        </p>
      )}

      {result && result.columns?.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "auto", maxHeight: "65vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--muted)", position: "sticky", top: 0, background: "var(--surface2)" }}>
                {result.columns.map((c) => (
                  <th key={c} style={{ padding: "0.6rem 0.5rem", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, ri) => (
                <tr
                  key={ri}
                  onClick={() => showPickHint && onPickRow(row)}
                  style={{
                    borderTop: "1px solid var(--border)",
                    cursor: showPickHint ? "pointer" : "default",
                  }}
                >
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: "0.5rem", verticalAlign: "top" }}>
                      {cell === null || cell === undefined ? "" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

