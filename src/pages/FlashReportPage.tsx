import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/apiBase";

type FlashPayment = {
  qty: number;
  type: string;
  amount: number;
  tip: number;
};

type FlashSalesSummary = {
  grossSales: number;
  checkDiscounts: number;
  itemDiscounts: number;
  priceAdjust: number;
  twoForOneDiscount: number;
  groupDiscount: number;
  coupons: number;
  guest: number;
};

type FlashResult = {
  reportId: string;
  reportDate: string;
  time: string;
  session: string;
  filter: string;
  guestCount: number;
  voidCount: number;
  guestAmount: number;
  payments: FlashPayment[];
  salesSummary: FlashSalesSummary;
  netSales: number;
  taxes: number;
  subtotal: number;
  tips: number;
  hashTotal: number;
  total: number;
};

function fmt(n: number) {
  return n.toFixed(2);
}

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function FlashReportPage() {
  const base = getApiBase();
  const [date, setDate] = useState(yesterdayISO());
  const [result, setResult] = useState<FlashResult | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`${base}/api/reports/flash/run?from_date=${encodeURIComponent(date)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
      setResult(j as FlashResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذر التحميل");
    } finally {
      setLoading(false);
    }
  }, [base, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const ss = result?.salesSummary;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Flash Report</h2>
      <div className="card" style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: "0.35rem 0.5rem" }} />
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load()}>
          تشغيل
        </button>
        <button type="button" className="btn btn-ghost" disabled={!result} onClick={() => window.print()}>
          طباعة
        </button>
      </div>

      {err ? <div style={{ color: "var(--danger)" }}>{err}</div> : null}

      {result && (
        <div
          className="card"
          style={{
            fontFamily: "monospace",
            fontSize: "0.92rem",
            lineHeight: 1.5,
            maxWidth: 420,
            margin: "0 auto",
            background: "#fff",
            color: "#000",
            padding: "1.2rem",
          }}
        >
          <div style={{ textAlign: "center", borderBottom: "2px dashed #000", paddingBottom: 8, marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>FLASH REPORT</div>
            <div style={{ fontSize: "0.82rem", marginTop: 4 }}>FILTER: {result.filter}</div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Date: {result.reportDate}</span>
            <span>Time: {result.time}</span>
          </div>
          <div style={{ marginBottom: 10 }}>Session: {result.session}</div>

          <div style={{ borderTop: "1px dashed #000", borderBottom: "1px dashed #000", padding: "6px 0", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{result.guestCount} Guest</span>
              <span>{fmt(result.guestAmount)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{result.voidCount} Void</span>
              <span>0.00</span>
            </div>
            <div style={{ borderTop: "1px solid #000", marginTop: 4, paddingTop: 4, display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>Total</span>
              <span>{fmt(result.guestAmount)}</span>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ borderBottom: "1px solid #000", display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr", fontWeight: 700, paddingBottom: 2 }}>
              <span>Qty</span>
              <span>Payment</span>
              <span style={{ textAlign: "right" }}>Amount</span>
              <span style={{ textAlign: "right" }}>Tip</span>
            </div>
            {result.payments.map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr", padding: "2px 0" }}>
                <span>{p.qty}</span>
                <span>{p.type}</span>
                <span style={{ textAlign: "right" }}>{fmt(p.amount)}</span>
                <span style={{ textAlign: "right" }}>{fmt(p.tip)}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #000", marginTop: 4, paddingTop: 4, display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr", fontWeight: 700 }}>
              <span></span>
              <span></span>
              <span style={{ textAlign: "right" }}>{fmt(result.total)}</span>
              <span style={{ textAlign: "right" }}>0.00</span>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ textAlign: "center", fontWeight: 700, borderBottom: "1px solid #000", paddingBottom: 4, marginBottom: 6 }}>
              SALES SUMMARY
            </div>
            {ss && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>GROSS SALES</span>
                  <span>{fmt(ss.grossSales)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>CHECK DISCOUNTS</span>
                  <span>{fmt(ss.checkDiscounts)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>ITEM DISCOUNTS</span>
                  <span>{fmt(ss.itemDiscounts)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>PRICE ADJUST</span>
                  <span>{fmt(ss.priceAdjust)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>2 FOR 1 DISCOUNT</span>
                  <span>{fmt(ss.twoForOneDiscount)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Group Discount</span>
                  <span>{fmt(ss.groupDiscount)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>COUPONS</span>
                  <span>{fmt(ss.coupons)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Guest</span>
                  <span>{fmt(ss.guest)}</span>
                </div>
              </>
            )}
          </div>

          <div style={{ borderTop: "2px dashed #000", paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>NET SALES</span>
              <span>{fmt(result.netSales)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>TAXES</span>
              <span>{fmt(result.taxes)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #000", marginTop: 4, paddingTop: 4 }}>
              <span>SUBTOTAL :</span>
              <span>{fmt(result.subtotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>TIPS</span>
              <span>{fmt(result.tips)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>HASH TOTAL</span>
              <span>{fmt(result.hashTotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #000", marginTop: 6, paddingTop: 6, fontWeight: 800 }}>
              <span>TOTAL</span>
              <span>{fmt(result.total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
