import { useEffect, useState, type ReactNode } from "react";
import {
  downloadHallDayExcel,
  fetchHallDayReport,
  type HallDayReport,
  type HallSessionBrief,
} from "../lib/hallDayReport";
import "../styles/hallDayReport.css";

type Props = {
  open: boolean;
  onClose: () => void;
  tableId?: string | null;
  tableName?: string | null;
  apiBase?: string;
};

function money(n: unknown) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0.00";
  return v.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(iso?: string | null) {
  const s = String(iso || "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s.replace("T", " ").slice(0, 16);
  return d.toLocaleString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

function statusAr(st: string) {
  const s = String(st || "").toLowerCase();
  const map: Record<string, string> = {
    active: "نشطة",
    closed: "مغلقة",
    completed: "مكتملة",
    orders_only: "طلبات بلا جلسة",
    cancelled: "ملغى",
    pending: "انتظار",
    preparing: "تحضير",
    ready: "جاهز",
    served: "مُقدَّم",
    approved: "معتمد",
    rejected: "مرفوض",
    paid: "مسدّدة",
    open: "مفتوحة",
    invoiced: "من فاتورة",
  };
  return map[s] || st || "—";
}

export function HallDayReportPanel({ open, onClose, tableId, tableName, apiBase }: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [report, setReport] = useState<HallDayReport | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr("");
    setReport(null);
    void (async () => {
      const res = await fetchHallDayReport({ tableId: tableId || undefined, base: apiBase });
      if (cancelled) return;
      setLoading(false);
      if (!res.ok || !res.data) {
        setErr(res.error || "تعذر تحميل التقرير");
        return;
      }
      setReport(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tableId, apiBase]);

  if (!open) return null;

  const displayName = tableName || report?.tableName || tableId;
  const title = tableId
    ? `فواتير الطاولة — ${displayName}`
    : "فواتير الصالة — مجمع اليوم";

  const s = report?.summary || {};
  const briefs = (report?.sessionBriefs || []) as HallSessionBrief[];
  const svcPct = Number(s.servicePercent ?? report?.policy?.servicePercent ?? 12);
  const vatPct = Number(s.vatPercent ?? report?.policy?.vatPercent ?? 14);

  return (
    <>
      <div className="hall-day-report__backdrop" onClick={onClose} />
      <div className="hall-day-report" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="hall-day-report__header">
          <div>
            <div className="hall-day-report__title">{title}</div>
            <div className="hall-day-report__subtitle">
              {report?.labelAr || "يوم تشغيلي 10:00 → 04:00"}
              {" · "}
              خدمة {svcPct}% · ضريبة {vatPct}%
            </div>
          </div>
          <div className="hall-day-report__actions">
            <button
              type="button"
              className="hall-day-report__btn hall-day-report__btn--primary"
              disabled={busy || loading}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setErr("");
                  const r = await downloadHallDayExcel({
                    tableId: tableId || undefined,
                    store: true,
                    base: apiBase,
                  });
                  setBusy(false);
                  if (!r.ok) setErr(r.error || "فشل تنزيل Excel");
                })();
              }}
            >
              {busy ? "…" : "Excel + تخزين"}
            </button>
            <button type="button" className="hall-day-report__btn" onClick={onClose}>
              إغلاق
            </button>
          </div>
        </div>

        {loading ? <p className="hall-day-report__muted">جاري تحميل فواتير/جلسات اليوم…</p> : null}
        {err ? <p className="hall-day-report__error">{err}</p> : null}

        {report ? (
          <>
            <Section title="جلسات اليوم (نسخة فاتورة مبسّطة)">
              {briefs.length === 0 ? (
                <p className="hall-day-report__empty">لا جلسات ضمن اليوم التشغيلي لهذه الطاولة.</p>
              ) : (
                <div className="hall-day-report__sessions">
                  {briefs.map((b) => (
                    <SessionInvoiceCard key={`sess-${b.seq}-${b.sessionId || b.tableId}`} brief={b} />
                  ))}
                </div>
              )}
            </Section>

            {!tableId && Array.isArray(report.captains) && report.captains.length > 0 ? (
              <Section title="ملخص الكباتن">
                <div className="hall-day-report__scroll">
                  <table className="hall-day-report__table">
                    <thead>
                      <tr>
                        <th>الكابتن</th>
                        <th>جلسات</th>
                        <th>طلبات</th>
                        <th>قيمة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.captains.slice(0, 40).map((c, i) => (
                        <tr key={`cap-${i}`}>
                          <td>{String(c.captainName || c.captainLogin || "—")}</td>
                          <td>{Number(c.sessions || 0)}</td>
                          <td>{Number(c.orders || 0)}</td>
                          <td>{money(c.orderValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            ) : null}

            <Section title="التجميعات">
              <div className="hall-day-report__stats">
                <Stat label="جلسات" value={s.sessions ?? briefs.length} />
                <Stat label="طلبات" value={s.orders ?? 0} />
                <Stat label="صافي" value={`${money(s.net ?? s.orderValue)} ج`} />
                <Stat label={`خدمة (${svcPct}%)`} value={`${money(s.service)} ج`} />
                <Stat label={`ضريبة (${vatPct}%)`} value={`${money(s.tax)} ج`} />
                <Stat label="الإجمالي" value={`${money(s.total)} ج`} />
                <Stat label="ملغى" value={s.cancelledOrders ?? 0} tone="danger" />
                <Stat label="مرتجعات" value={s.returns ?? 0} />
                <Stat label="اعتمادات" value={s.approvals ?? 0} />
                <Stat label="ضيوف" value={s.guests ?? 0} />
              </div>
            </Section>

            <p className="hall-day-report__footer">
              أُنشئ في {new Date(report.generatedAt).toLocaleString("ar-EG")}
              {report.storedPath ? ` · مخزّن: ${report.storedPath}` : ""}
            </p>
          </>
        ) : null}
      </div>
    </>
  );
}

function SessionInvoiceCard({ brief }: { brief: HallSessionBrief }) {
  const lines = Array.isArray(brief.itemLines) ? brief.itemLines : [];
  const fin = brief.financials || {};
  const approvals = Array.isArray(brief.approvals) ? brief.approvals : [];
  const returns = Array.isArray(brief.returns) ? brief.returns : [];
  const src =
    brief.financialSource === "invoice"
      ? brief.invoice?.status === "paid"
        ? "من فاتورة مسدّدة"
        : "من فاتورة"
      : "تقدير من الطلبات";

  return (
    <article className="hall-day-report__session hall-day-report__invoice">
      <div className="hall-day-report__invoice-head">
        <div className="hall-day-report__session-title">
          <span className="hall-day-report__badge">جلسة {brief.seq}</span>
          <strong>{String(brief.tableName || brief.tableId || "—")}</strong>
          <span className="hall-day-report__chip">{statusAr(String(brief.status || ""))}</span>
          {brief.guestSession ? <span className="hall-day-report__chip hall-day-report__chip--guest">ضيف</span> : null}
          {brief.invoice?.billNumber != null ? (
            <span className="hall-day-report__chip">فاتورة #{String(brief.invoice.billNumber)}</span>
          ) : null}
        </div>
      </div>

      <div className="hall-day-report__invoice-meta">
        <div>
          <span className="hall-day-report__meta-k">تسكين</span>
          <span className="hall-day-report__meta-v">{fmtTime(brief.startTime)}</span>
        </div>
        <div>
          <span className="hall-day-report__meta-k">إنهاء</span>
          <span className="hall-day-report__meta-v">{fmtTime(brief.endTime)}</span>
        </div>
        <div>
          <span className="hall-day-report__meta-k">الكابتن</span>
          <span className="hall-day-report__meta-v">{String(brief.captainName || "—")}</span>
        </div>
        <div>
          <span className="hall-day-report__meta-k">الضيوف</span>
          <span className="hall-day-report__meta-v">{Number(brief.guestCount || 0)}</span>
        </div>
        <div>
          <span className="hall-day-report__meta-k">المصدر</span>
          <span className="hall-day-report__meta-v">{src}</span>
        </div>
      </div>

      {lines.length > 0 ? (
        <table className="hall-day-report__table hall-day-report__table--invoice">
          <thead>
            <tr>
              <th>الصنف / الطلب</th>
              <th>كمية</th>
              <th>سعر</th>
              <th>قيمة</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, i) => (
              <tr key={`ln-${i}`} className={ln.cancelled ? "hall-day-report__row--cancelled" : undefined}>
                <td>
                  {String(ln.name || "—")}
                  {ln.cancelled ? " (ملغى)" : ""}
                </td>
                <td>{money(ln.quantity).replace(/\.00$/, "")}</td>
                <td>{money(ln.unitPrice)}</td>
                <td>{money(ln.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hall-day-report__empty">لا أصناف/طلبات في هذه الجلسة.</p>
      )}

      <div className="hall-day-report__totals">
        <div>
          <span>صافي الجلسة</span>
          <strong>{money(fin.net)} ج</strong>
        </div>
        <div>
          <span>الخدمة ({Number(fin.servicePercent ?? 0)}%)</span>
          <strong>{money(fin.service)} ج</strong>
        </div>
        <div>
          <span>الضريبة ({Number(fin.vatPercent ?? 0)}%)</span>
          <strong>{money(fin.tax)} ج</strong>
        </div>
        <div className="hall-day-report__totals-grand">
          <span>إجمالي الجلسة</span>
          <strong>{money(fin.total)} ج</strong>
        </div>
      </div>

      {returns.length > 0 ? (
        <div className="hall-day-report__block">
          <div className="hall-day-report__block-title">مرتجعات</div>
          <ul className="hall-day-report__mini-list">
            {returns.map((r, i) => (
              <li key={`ret-${i}`}>
                {fmtTime(String(r.at || ""))} · {statusAr(String(r.status || ""))} · {money(r.value)} ج
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {approvals.length > 0 ? (
        <div className="hall-day-report__block">
          <div className="hall-day-report__block-title">اعتمادات</div>
          <ul className="hall-day-report__mini-list">
            {approvals.map((a, i) => (
              <li key={`ap-${i}`}>
                {fmtTime(String(a.at || ""))} · {String(a.approvalType || a.type || "—")} ·{" "}
                {statusAr(String(a.status || ""))}
                {a.note ? ` — ${String(a.note)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" }) {
  return (
    <div className={`hall-day-report__stat${tone === "danger" ? " hall-day-report__stat--danger" : ""}`}>
      <div className="hall-day-report__stat-value">{value}</div>
      <div className="hall-day-report__stat-label">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="hall-day-report__section">
      <h3 className="hall-day-report__section-title">{title}</h3>
      {children}
    </section>
  );
}
