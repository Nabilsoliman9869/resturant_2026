import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type RouteRow = {
  routeKey: string;
  displayName: string;
  accountGuide: string | null;
  sortOrder: number;
  isActive: boolean;
};

type AccountOpt = { cardGuide: string; cardCode: string; accountName: string };

export default function PaymentRoutingSettingsPage() {
  const base = getApiBase();
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [acctQ, setAcctQ] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const loadRoutes = useCallback(async () => {
    const r = await fetch(`${base}/api/restaurant/settings/payment-routing`);
    const j = await r.json();
    if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "فشل التحميل");
    const list = Array.isArray(j.routes) ? j.routes : [];
    setRoutes(
      list.map((x: Record<string, unknown>) => ({
        routeKey: String(x.routeKey || ""),
        displayName: String(x.displayName || ""),
        accountGuide: x.accountGuide ? String(x.accountGuide) : null,
        sortOrder: Number(x.sortOrder ?? 100),
        isActive: Boolean(x.isActive ?? true),
      })),
    );
  }, [base]);

  const loadAccounts = useCallback(async () => {
    const q = acctQ.trim();
    const url = q
      ? `${base}/api/restaurant/accounts-for-routing?q=${encodeURIComponent(q)}`
      : `${base}/api/restaurant/accounts-for-routing`;
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) return;
    const list = Array.isArray(j.accounts) ? j.accounts : [];
    setAccounts(
      list.map((x: Record<string, unknown>) => ({
        cardGuide: String(x.cardGuide || ""),
        cardCode: String(x.cardCode || ""),
        accountName: String(x.accountName || ""),
      })),
    );
  }, [base, acctQ]);

  useEffect(() => {
    void loadRoutes().catch(() => {});
  }, [loadRoutes]);

  useEffect(() => {
    const t = window.setTimeout(() => void loadAccounts(), 200);
    return () => window.clearTimeout(t);
  }, [loadAccounts, acctQ]);

  async function saveAll() {
    setMsg("");
    setLoading(true);
    try {
      const r = await fetch(`${base}/api/restaurant/settings/payment-routing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes }),
      });
      const t = await r.text();
      const j = (() => {
        try {
          return JSON.parse(t) as { routes?: RouteRow[] };
        } catch {
          return {};
        }
      })();
      if (!r.ok) throw new Error(t.slice(0, 200));
      if (Array.isArray(j.routes)) {
        setRoutes(
          j.routes.map((x) => ({
            routeKey: String(x.routeKey || ""),
            displayName: String(x.displayName || ""),
            accountGuide: x.accountGuide ? String(x.accountGuide) : null,
            sortOrder: Number(x.sortOrder ?? 100),
            isActive: Boolean(x.isActive ?? true),
          })),
        );
      }
      setMsg("تم الحفظ في قاعدة البيانات.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }

  function addRow() {
    setRoutes((prev) => [
      ...prev,
      {
        routeKey: `route_${prev.length + 1}`,
        displayName: "طريقة جديدة",
        accountGuide: null,
        sortOrder: (prev[prev.length - 1]?.sortOrder ?? 0) + 10,
        isActive: true,
      },
    ]);
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>ربط طرق التحصيل بالحسابات</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.92rem", maxWidth: 720 }}>
        تُخزَّن الإعدادات في جدول <code>MAT3AM_PAYMENT_ROUTING</code>. عند تسديد الكاشير تُسجَّل المبالغ في{" "}
        <code>MAT3AM_INV_PAYMENT_LINE</code> مع مرجع الحساب المختار. المفاتيح الافتراضية للواجهة:{" "}
        <code>cash</code>، <code>visa</code>، <code>wallet</code>، <code>instapay</code> — يمكنك إضافة مثل{" "}
        <code>visa_b2</code> لاحقاً عند توسيع شاشة الدفع.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={() => void loadRoutes()}>
            إعادة تحميل
          </button>
          <button type="button" className="btn btn-secondary" onClick={addRow}>
            + صف
          </button>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void saveAll()}>
            حفظ في SQL
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", minWidth: 560 }}>
            <thead>
              <tr>
                <th>المفتاح</th>
                <th>الاسم</th>
                <th>الحساب (TBL004)</th>
                <th>ترتيب</th>
                <th>نشط</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((row, i) => (
                <tr key={`${row.routeKey}-${i}`}>
                  <td>
                    <input
                      value={row.routeKey}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRoutes((prev) => prev.map((x, j) => (j === i ? { ...x, routeKey: v } : x)));
                      }}
                      style={{ width: "100%", minWidth: 120 }}
                    />
                  </td>
                  <td>
                    <input
                      value={row.displayName}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRoutes((prev) => prev.map((x, j) => (j === i ? { ...x, displayName: v } : x)));
                      }}
                      style={{ width: "100%", minWidth: 160 }}
                    />
                  </td>
                  <td>
                    <select
                      value={row.accountGuide || ""}
                      onChange={(e) => {
                        const v = e.target.value || null;
                        setRoutes((prev) => prev.map((x, j) => (j === i ? { ...x, accountGuide: v } : x)));
                      }}
                      style={{ width: "100%", minWidth: 220 }}
                    >
                      <option value="">— بدون ربط —</option>
                      {accounts.map((a) => (
                        <option key={a.cardGuide} value={a.cardGuide}>
                          {a.cardCode} — {a.accountName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.sortOrder}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setRoutes((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, sortOrder: Number.isFinite(v) ? v : 0 } : x)),
                        );
                      }}
                      style={{ width: 72 }}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setRoutes((prev) => prev.map((x, j) => (j === i ? { ...x, isActive: v } : x)));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <label style={{ display: "block", marginBottom: 8 }}>
          بحث في الحسابات (TBL004)
          <input
            value={acctQ}
            onChange={(e) => setAcctQ(e.target.value)}
            placeholder="كود أو اسم أو جزء من GUID"
            style={{ width: "100%", marginTop: 6, maxWidth: 400 }}
          />
        </label>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          اختر حساباً من القائمة المنسدلة لكل صف. إن لم يظهر الحساب، اضبط البحث ثم أعد فتح القائمة.
        </p>
      </div>

      {msg ? <p style={{ color: "var(--accent2)", marginTop: "1rem" }}>{msg}</p> : null}
    </div>
  );
}
