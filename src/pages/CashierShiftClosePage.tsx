import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { useAuth } from "../auth/AuthContext";
import { sessionDisplayName } from "../auth/displayUser";
import { buildMat3amActor } from "../lib/mat3amActor";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";

type Breakdown = { cash: number; visa: number; wallet: number; instapay: number };
type InvRow = {
  invoiceId: string;
  billNumber?: number | string;
  tableLabel?: string;
  paidAt?: string;
  total: number;
  paymentBreakdown?: Breakdown;
  routeCash?: number;
  routeVisa?: number;
  routeWallet?: number;
  routeInstapay?: number;
};
type Outflow = {
  outflowId: string;
  kind: string;
  amount: number;
  category?: string;
  note?: string;
  createdAt?: string;
};
type Hist = {
  closeId: string;
  status: string;
  submittedAt?: string;
  invoiceCount?: number;
  cashAmount?: number;
  visaAmount?: number;
  instapayAmount?: number;
  netHandover?: number;
  variance?: number;
};

const DENOM_KEYS = [1, 5, 10, 50, 100, 200] as const;

function money(n: number) {
  return (Number(n) || 0).toFixed(2);
}

/**
 * إقفال شيفت الكاشير — تقرير متحصلات + فئات نقدية + خصم مصروفات/مشتريات
 * ثم إرسال لاعتماد المدير (بدون حذف أي أنواع اعتماد أخرى).
 */
export default function CashierShiftClosePage() {
  const base = getApiBase();
  const { user } = useAuth();
  const uid = String(user?.id || "");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [invoices, setInvoices] = useState<InvRow[]>([]);
  const [unassigned, setUnassigned] = useState<InvRow[]>([]);
  const [outflows, setOutflows] = useState<Outflow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [claimUnassigned, setClaimUnassigned] = useState(false);
  const [selectedOut, setSelectedOut] = useState<Record<string, boolean>>({});
  const [denoms, setDenoms] = useState<Record<number, string>>({
    1: "0",
    5: "0",
    10: "0",
    50: "0",
    100: "0",
    200: "0",
  });
  const [visaReceipts, setVisaReceipts] = useState("0");
  const [transferNotices, setTransferNotices] = useState("0");
  const [extraExpense, setExtraExpense] = useState("0");
  const [extraPurchase, setExtraPurchase] = useState("0");
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<Hist[]>([]);

  const show = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    window.setTimeout(() => setMsg((c) => (c && c.text === text ? null : c)), 6000);
  };

  const load = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    try {
      const r = await fetch(
        `${base}/api/restaurant/cashier/shift-close/open?userId=${encodeURIComponent(uid)}`,
        { cache: "no-store" },
      );
      const j =
        tryParseJson<{
          invoices?: InvRow[];
          unassignedInvoices?: InvRow[];
          outflows?: Outflow[];
          detail?: string;
        }>(await r.text()) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "تعذر التحميل");
      const invs = Array.isArray(j.invoices) ? j.invoices : [];
      const unas = Array.isArray(j.unassignedInvoices) ? j.unassignedInvoices : [];
      const outs = Array.isArray(j.outflows) ? j.outflows : [];
      setInvoices(invs);
      setUnassigned(unas);
      setOutflows(outs);
      const sel: Record<string, boolean> = {};
      for (const x of invs) sel[x.invoiceId] = true;
      setSelected(sel);
      const so: Record<string, boolean> = {};
      for (const o of outs) so[o.outflowId] = true;
      setSelectedOut(so);

      const h = await fetch(
        `${base}/api/restaurant/cashier/shift-close/history?userId=${encodeURIComponent(uid)}&limit=12`,
        { cache: "no-store" },
      );
      const hj = tryParseJson<{ closes?: Hist[] }>(await h.text()) ?? {};
      setHistory(Array.isArray(hj.closes) ? hj.closes : []);
    } catch (e) {
      show("err", String(e));
    } finally {
      setBusy(false);
    }
  }, [base, uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const pool = useMemo(() => {
    const list = [...invoices];
    if (claimUnassigned) list.push(...unassigned);
    return list.filter((x) => selected[x.invoiceId]);
  }, [invoices, unassigned, claimUnassigned, selected]);

  const totals = useMemo(() => {
    let cash = 0;
    let visa = 0;
    let wallet = 0;
    let instapay = 0;
    let invoiceTotal = 0;
    for (const inv of pool) {
      const bd = inv.paymentBreakdown || {
        cash: inv.routeCash || 0,
        visa: inv.routeVisa || 0,
        wallet: inv.routeWallet || 0,
        instapay: inv.routeInstapay || 0,
      };
      cash += Number(bd.cash) || 0;
      visa += Number(bd.visa) || 0;
      wallet += Number(bd.wallet) || 0;
      instapay += Number(bd.instapay) || 0;
      invoiceTotal += Number(inv.total) || 0;
    }
    let expenses = Number(extraExpense) || 0;
    let purchases = Number(extraPurchase) || 0;
    for (const o of outflows) {
      if (!selectedOut[o.outflowId]) continue;
      if (o.kind === "expense") expenses += Number(o.amount) || 0;
      if (o.kind === "purchase") purchases += Number(o.amount) || 0;
    }
    const deductions = expenses + purchases;
    const expectedCash = cash - deductions;
    let declared = 0;
    for (const k of DENOM_KEYS) {
      declared += (Number(denoms[k]) || 0) * k;
    }
    return {
      cash,
      visa,
      wallet,
      instapay,
      invoiceTotal,
      invoiceCount: pool.length,
      expenses,
      purchases,
      deductions,
      expectedCash,
      declaredCash: declared,
      variance: declared - expectedCash,
      netHandover: declared,
    };
  }, [pool, outflows, selectedOut, extraExpense, extraPurchase, denoms]);

  async function submit() {
    if (!uid) {
      show("err", "المستخدم غير معروف");
      return;
    }
    if (pool.length === 0) {
      show("err", "لا توجد فواتير محددة للإقفال");
      return;
    }
    const ok = window.confirm(
      `إرسال إقفال الشيفت لاعتماد المدير؟\n` +
        `فواتير: ${totals.invoiceCount} · نقدي ${money(totals.cash)} · فيزا ${money(totals.visa)} · إنستا ${money(totals.instapay)}\n` +
        `صافي تسليم (معدود): ${money(totals.netHandover)} ج.م`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/shift-close/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mat3amActor: buildMat3amActor(user),
          invoiceIds: pool.map((x) => x.invoiceId),
          claimUnassigned,
          outflowIds: outflows.filter((o) => selectedOut[o.outflowId]).map((o) => o.outflowId),
          expensesAmount: Number(extraExpense) || 0,
          purchasesAmount: Number(extraPurchase) || 0,
          denominations: Object.fromEntries(DENOM_KEYS.map((k) => [String(k), Number(denoms[k]) || 0])),
          visaReceiptsCount: Number(visaReceipts) || 0,
          transferNoticesCount: Number(transferNotices) || 0,
          notes,
        }),
      });
      const j = tryParseJson<{ detail?: string; closeId?: string }>(await r.text()) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "فشل الإرسال");
      show("ok", `تم إرسال الإقفال لاعتماد المدير · ${String(j.closeId || "").slice(0, 8)}…`);
      setDenoms({ 1: "0", 5: "0", 10: "0", 50: "0", 100: "0", 200: "0" });
      setNotes("");
      await load();
    } catch (e) {
      show("err", String(e));
    } finally {
      setBusy(false);
    }
  }

  const statusLabel: Record<string, string> = {
    pending_manager: "بانتظار المدير",
    approved: "معتمد / مقفل",
    rejected: "مرفوض",
    draft: "مسودة",
  };

  return (
    <div className="role-op shift-close" dir="rtl">
      <style>{CSS}</style>
      <OperationalRoleHeader roleTitle="اقفال الشيفت" hideBack />
      <div className="role-op__main shift-close__wrap">
        <header className="shift-close__hero">
          <div>
            <h2>تقرير إقفال الشيفت</h2>
            <p>
              {sessionDisplayName(user)} — العمليات غير المقفلة فقط. بعد اعتماد المدير تُصفَّر ولن تظهر هنا مرة أخرى.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>
            تحديث
          </button>
        </header>

        {msg ? <div className={`shift-close__msg is-${msg.type}`}>{msg.text}</div> : null}

        <section className="shift-close__kpis">
          <div className="kpi kpi--cash">
            <span>نقدي</span>
            <strong>{money(totals.cash)}</strong>
          </div>
          <div className="kpi kpi--visa">
            <span>فيزا</span>
            <strong>{money(totals.visa)}</strong>
          </div>
          <div className="kpi kpi--insta">
            <span>إنستا / تحويل</span>
            <strong>{money(totals.instapay)}</strong>
          </div>
          <div className="kpi">
            <span>محفظة</span>
            <strong>{money(totals.wallet)}</strong>
          </div>
          <div className="kpi kpi--total">
            <span>مجمل الفواتير ({totals.invoiceCount})</span>
            <strong>{money(totals.invoiceTotal)}</strong>
          </div>
        </section>

        <div className="shift-close__grid">
          <section className="card shift-close__panel">
            <h3>العمليات غير المقفلة</h3>
            {invoices.length === 0 ? (
              <p className="muted">لا توجد فواتير مسدَّدة منسوبة لك بانتظار الإقفال.</p>
            ) : (
              <div className="shift-close__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>فاتورة</th>
                      <th>طاولة</th>
                      <th>نقدي</th>
                      <th>فيزا</th>
                      <th>إنستا</th>
                      <th>الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const bd: Breakdown = inv.paymentBreakdown || {
                        cash: Number(inv.routeCash) || 0,
                        visa: Number(inv.routeVisa) || 0,
                        wallet: Number(inv.routeWallet) || 0,
                        instapay: Number(inv.routeInstapay) || 0,
                      };
                      return (
                        <tr key={inv.invoiceId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(selected[inv.invoiceId])}
                              onChange={(e) => setSelected((s) => ({ ...s, [inv.invoiceId]: e.target.checked }))}
                            />
                          </td>
                          <td>{inv.billNumber || inv.invoiceId.slice(0, 8)}</td>
                          <td>{inv.tableLabel || "—"}</td>
                          <td>{money(Number(bd.cash) || 0)}</td>
                          <td>{money(Number(bd.visa) || 0)}</td>
                          <td>{money(Number(bd.instapay) || 0)}</td>
                          <td>{money(inv.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {unassigned.length > 0 ? (
              <div className="shift-close__unassigned">
                <label>
                  <input type="checkbox" checked={claimUnassigned} onChange={(e) => setClaimUnassigned(e.target.checked)} />
                  ضم فواتير قديمة غير منسوبة ({unassigned.length}) لهذا الشيفت
                </label>
                {claimUnassigned ? (
                  <ul>
                    {unassigned.map((u) => (
                      <li key={u.invoiceId}>
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[u.invoiceId])}
                            onChange={(e) => setSelected((s) => ({ ...s, [u.invoiceId]: e.target.checked }))}
                          />{" "}
                          {u.billNumber || u.invoiceId.slice(0, 8)} · {money(u.total)}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="card shift-close__panel">
            <h3>تسليم الفئات النقدية (جنيه)</h3>
            <div className="shift-close__denoms">
              {DENOM_KEYS.map((k) => (
                <label key={k}>
                  <span>× {k}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={denoms[k]}
                    onChange={(e) => setDenoms((d) => ({ ...d, [k]: e.target.value }))}
                  />
                  <em>{money((Number(denoms[k]) || 0) * k)}</em>
                </label>
              ))}
            </div>
            <div className="shift-close__declared">
              المعدود نقداً: <strong>{money(totals.declaredCash)}</strong>
              <span className={Math.abs(totals.variance) > 0.02 ? "is-warn" : ""}>
                {" "}
                · الفرق عن المتوقع: {money(totals.variance)}
              </span>
            </div>

            <h3 style={{ marginTop: "1.25rem" }}>إثباتات غير نقدية</h3>
            <div className="shift-close__pair">
              <label>
                عدد إيصالات الفيزا
                <input type="number" min={0} value={visaReceipts} onChange={(e) => setVisaReceipts(e.target.value)} />
              </label>
              <label>
                عدد إشعارات التحويل / إنستا
                <input type="number" min={0} value={transferNotices} onChange={(e) => setTransferNotices(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="card shift-close__panel">
            <h3>الخصومات (مصروفات / مشتريات)</h3>
            {outflows.length === 0 ? (
              <p className="muted">لا مصروفات مسجّلة من نوافذ الكاشير لهذا الشيفت.</p>
            ) : (
              <ul className="shift-close__outflows">
                {outflows.map((o) => (
                  <li key={o.outflowId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedOut[o.outflowId])}
                        onChange={(e) => setSelectedOut((s) => ({ ...s, [o.outflowId]: e.target.checked }))}
                      />
                      <span>{o.kind === "purchase" ? "مشتريات" : "صرف"}</span>
                      <strong>{money(o.amount)}</strong>
                      <em>{o.category || o.note || ""}</em>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="shift-close__pair">
              <label>
                خصم إضافي — مصروفات
                <input type="number" min={0} step={0.5} value={extraExpense} onChange={(e) => setExtraExpense(e.target.value)} />
              </label>
              <label>
                خصم إضافي — مشتريات
                <input type="number" min={0} step={0.5} value={extraPurchase} onChange={(e) => setExtraPurchase(e.target.value)} />
              </label>
            </div>
            <div className="shift-close__net">
              <div>
                نقدي متوقع بعد الخصم: <strong>{money(totals.expectedCash)}</strong>
              </div>
              <div>
                الصافي المسلم (حسب العدّ): <strong className="net">{money(totals.netHandover)}</strong>
              </div>
            </div>
            <label className="shift-close__notes">
              ملاحظات للكاشير / المدير
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="فروقات · عهدة ناقصة · …" />
            </label>
            <button type="button" className="btn btn-primary shift-close__submit" disabled={busy || pool.length === 0} onClick={() => void submit()}>
              إرسال للإقفال واعتماد المدير
            </button>
            <p className="muted tiny">
              لن يُصفَّر الشيفت نهائياً إلا بعد اعتماد المدير من «موافقات المدير». الرفض يعيد العمليات للقائمة.
            </p>
          </section>
        </div>

        <section className="card shift-close__panel">
          <h3>سجل إقفالاتك</h3>
          {history.length === 0 ? (
            <p className="muted">لا إقفالات سابقة.</p>
          ) : (
            <div className="shift-close__table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الحالة</th>
                    <th>وقت الإرسال</th>
                    <th>فواتير</th>
                    <th>نقدي</th>
                    <th>فيزا</th>
                    <th>إنستا</th>
                    <th>صافي</th>
                    <th>فرق</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.closeId}>
                      <td>{statusLabel[h.status] || h.status}</td>
                      <td>{String(h.submittedAt || "").slice(0, 16).replace("T", " ")}</td>
                      <td>{h.invoiceCount ?? 0}</td>
                      <td>{money(Number(h.cashAmount) || 0)}</td>
                      <td>{money(Number(h.visaAmount) || 0)}</td>
                      <td>{money(Number(h.instapayAmount) || 0)}</td>
                      <td>{money(Number(h.netHandover) || 0)}</td>
                      <td>{money(Number(h.variance) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const CSS = `
.shift-close__wrap { display: grid; gap: 1rem; }
.shift-close__hero { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
.shift-close__hero h2 { margin: 0 0 0.25rem; font-size: 1.35rem; }
.shift-close__hero p { margin: 0; color: var(--muted); max-width: 52rem; }
.shift-close__msg { padding: 0.65rem 0.9rem; border-radius: 10px; font-weight: 600; }
.shift-close__msg.is-ok { background: #ecfdf5; color: #166534; }
.shift-close__msg.is-err { background: #fef2f2; color: #991b1b; }
.shift-close__kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.65rem; }
.shift-close__kpis .kpi { background: linear-gradient(160deg, #0f172a 0%, #1e293b 100%); color: #f8fafc; border-radius: 14px; padding: 0.85rem 1rem; display: grid; gap: 0.2rem; }
.shift-close__kpis .kpi span { font-size: 0.78rem; opacity: 0.8; }
.shift-close__kpis .kpi strong { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
.kpi--cash { background: linear-gradient(160deg, #14532d, #166534) !important; }
.kpi--visa { background: linear-gradient(160deg, #1e3a8a, #1d4ed8) !important; }
.kpi--insta { background: linear-gradient(160deg, #4c1d95, #7c3aed) !important; }
.kpi--total { background: linear-gradient(160deg, #7c2d12, #c2410c) !important; }
.shift-close__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.85rem; align-items: start; }
.shift-close__panel h3 { margin: 0 0 0.75rem; font-size: 1rem; }
.shift-close__table-wrap { overflow: auto; }
.shift-close__panel table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.shift-close__panel th, .shift-close__panel td { padding: 0.4rem 0.35rem; border-bottom: 1px solid #e2e8f0; text-align: right; white-space: nowrap; }
.shift-close__denoms { display: grid; gap: 0.45rem; }
.shift-close__denoms label { display: grid; grid-template-columns: 3.5rem 1fr auto; gap: 0.5rem; align-items: center; }
.shift-close__denoms input { padding: 0.35rem 0.5rem; border-radius: 8px; border: 1px solid #cbd5e1; }
.shift-close__denoms em { font-style: normal; font-variant-numeric: tabular-nums; color: #334155; min-width: 4.5rem; text-align: left; }
.shift-close__declared { margin-top: 0.75rem; font-size: 0.92rem; }
.shift-close__declared .is-warn { color: #b45309; font-weight: 700; }
.shift-close__pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; margin-top: 0.65rem; }
.shift-close__pair label, .shift-close__notes { display: grid; gap: 0.3rem; font-size: 0.86rem; font-weight: 600; }
.shift-close__pair input, .shift-close__notes textarea { font-weight: 500; padding: 0.4rem 0.55rem; border-radius: 8px; border: 1px solid #cbd5e1; }
.shift-close__outflows { list-style: none; padding: 0; margin: 0 0 0.75rem; display: grid; gap: 0.35rem; }
.shift-close__outflows label { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; font-size: 0.88rem; }
.shift-close__net { margin: 0.85rem 0; display: grid; gap: 0.35rem; padding: 0.75rem; border-radius: 12px; background: #f8fafc; border: 1px solid #e2e8f0; }
.shift-close__net .net { color: #166534; font-size: 1.15rem; }
.shift-close__submit { width: 100%; margin-top: 0.75rem; padding: 0.7rem 1rem; font-weight: 800; }
.shift-close__unassigned { margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px dashed #cbd5e1; }
.shift-close__unassigned ul { margin: 0.4rem 0 0; padding: 0; list-style: none; display: grid; gap: 0.25rem; }
.muted { color: var(--muted); }
.tiny { font-size: 0.8rem; margin-top: 0.5rem; }
@media (max-width: 720px) {
  .shift-close__pair { grid-template-columns: 1fr; }
}
`;
