# -*- coding: utf-8 -*-
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "src" / "pages" / "WaiterOrderPage.tsx"
s = path.read_text(encoding="utf-8")

old_mobile = """                    {sessionOrders.filter((o) => (o.status || "").toLowerCase() !== "cancelled").slice().reverse().map((o) => {
                      const st = (o.status || "").toLowerCase();
                      const canCancel = st === "pending";
                      return (
                        <li key={`sent-top-${o.id}`} style={{ borderBottom: "1px solid rgba(15,23,42,0.08)", padding: "6px 0", fontSize: "0.82rem", display: "flex", justifyContent: "space-between", gap: 8, color: "#cbd5e1" }}>
                          <span><strong style={{ color: "#fff" }}>{o.id.slice(0, 8)}</strong> · {st}</span>
                          {canCancel ? <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ fontSize: "0.72rem", padding: "3px 7px", color: "#f87171", borderColor: "#7f1d1d" }} onClick={() => void cancelServerOrder(o.id)}>إلغاء</button> : null}
                        </li>
                      );
                    })}"""

new_mobile = """                    {sessionOrders.filter((o) => (o.status || "").toLowerCase() !== "cancelled").slice().reverse().map((o) => {
                      const st = (o.status || "").toLowerCase();
                      const canCancel = st === "pending";
                      const lines = activeOrderItems(o).map(formatOrderItemLine);
                      return (
                        <li key={`sent-top-${o.id}`} style={{ borderBottom: "1px solid rgba(15,23,42,0.08)", padding: "8px 0", fontSize: "0.82rem", color: "#e2e8f0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                            <span><strong style={{ color: "#fff" }}>طلب #{o.id.slice(0, 8)}</strong> · {orderStatusLabelAr(st)}</span>
                            {canCancel ? <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" style={{ fontSize: "0.72rem", padding: "3px 7px", color: "#f87171", borderColor: "#7f1d1d" }} onClick={() => void cancelServerOrder(o.id)}>إلغاء</button> : null}
                          </div>
                          <ul style={{ margin: 0, paddingInlineStart: 16, color: "#cbd5e1", lineHeight: 1.45 }}>
                            {lines.length ? lines.map((ln, idx) => <li key={`${o.id}-ln-${idx}`}>{ln}</li>) : <li>بدون بنود</li>}
                          </ul>
                        </li>
                      );
                    })}"""
old_desktop = """                    const items = (o.items || []).map((i) => `${i.name || "صنف"} ×${i.quantity ?? 1}`).slice(0, 3);
                    return (
                      <div
                        key={`sum-${o.id}`}
                        style={{
                          minWidth: 320,
                          maxWidth: 380,
                          border: "1px solid #dbeafe",
                          borderRadius: 12,
                          padding: "12px 14px",
                          background: "#f8fbff",
                        }}
                      >
                        <div style={{ fontSize: "0.84rem", fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>
                          {o.id.slice(0, 8)} · {st} {o.generalOrder ? "· عام" : ""}
                        </div>
                        <div style={{ fontSize: "0.9rem", color: "#334155", lineHeight: 1.6 }}>
                          {items.length ? items.join(" · ") : "بدون تفاصيل بنود"}
                        </div>
                      </div>
                    );"""

new_desktop = """                    const lines = activeOrderItems(o).map(formatOrderItemLine);
                    const canCancel = st === "pending";
                    return (
                      <div
                        key={`sum-${o.id}`}
                        style={{
                          minWidth: 320,
                          maxWidth: 380,
                          border: "1px solid #dbeafe",
                          borderRadius: 12,
                          padding: "12px 14px",
                          background: "#f8fbff",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.84rem",
                            fontWeight: 800,
                            marginBottom: 6,
                            color: "#0f172a",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 6,
                          }}
                        >
                          <span>
                            طلب #{o.id.slice(0, 8)} · {orderStatusLabelAr(st)}
                            {o.generalOrder ? " · عام" : ""}
                          </span>
                          {canCancel ? (
                            <button
                              type="button"
                              className="waiter-pos__btn waiter-pos__btn--ghost"
                              style={{ fontSize: "0.72rem", padding: "2px 6px" }}
                              onClick={() => void cancelServerOrder(o.id)}
                            >
                              إلغاء
                            </button>
                          ) : null}
                        </div>
                        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: "0.88rem", color: "#334155", lineHeight: 1.55 }}>
                          {lines.length ? lines.map((ln, idx) => <li key={`${o.id}-${idx}`}>{ln}</li>) : <li>بدون بنود نشطة</li>}
                        </ul>
                      </div>
                    );"""

if old_mobile in s:
    s = s.replace(old_mobile, new_mobile)
    print("patched mobile sent orders")
else:
    print("WARN: mobile block not found")

if old_desktop in s:
    s = s.replace(old_desktop, new_desktop)
    print("patched desktop sent orders")
else:
    print("WARN: desktop block not found")

btn_anchor = '              <h3 style={{ marginTop: 6, marginBottom: 0 }}>خيارات الطاولات</h3>'
btn_insert = """              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  className="waiter-pos__btn waiter-pos__btn--ghost"
                  style={{ width: "100%", fontWeight: 800 }}
                  disabled={!activeSessionId || returnableLines.length === 0}
                  onClick={() => setReturnModalOpen(true)}
                >
                  طلب مرتجع ضيف
                </button>
              </div>
"""
if btn_anchor in s and "طلب مرتجع ضيف" not in s:
    s = s.replace(btn_anchor, btn_insert + btn_anchor)
    print("patched return button")

modal_anchor = "    </div>\n  );\n}\n"
modal_block = """      <GuestReturnRequestModal
        open={returnModalOpen}
        onClose={() => setReturnModalOpen(false)}
        sessionId={activeSessionId || ""}
        tableId={selectedTableId}
        tableLabel={selectedTable?.name || selectedTableId}
        lines={returnableLines}
        actor={{
          userId: user?.id != null ? String(user.id) : "",
          name: user?.displayName || user?.username || "",
          role: user?.role || "waiter",
        }}
        onSubmitted={() => setMsg("تم إرسال طلب المرتجع للمدير.")}
      />
"""
if "GuestReturnRequestModal" not in s and modal_anchor in s:
    s = s.replace(modal_anchor, modal_block + modal_anchor, 1)
    print("patched modal")

path.write_text(s, encoding="utf-8")
