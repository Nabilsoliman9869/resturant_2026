import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { OperationalRoleHeader } from "../components/OperationalRoleHeader";
import { buildMat3amActor } from "../lib/mat3amActor";
import { getApiBase } from "../lib/apiBase";
import { normalizeTableDisplayLabel } from "../lib/restaurantTableView";
import { mapTablesToFloorPlanLabels } from "../lib/restaurantTableView";
import "../styles/operationalRoles.css";

type TableStatus = "ready" | "occupied" | "reserved" | "dirty" | "cleaning";

type TableRow = {
  id: string;
  name: string;
  status: TableStatus;
  seats: number;
  number?: number;
  features?: Record<string, unknown>;
};

function normalizeStatus(raw: string): TableStatus {
  const s = (raw || "").toLowerCase();
  if (s.includes("occupy") || s === "occupied" || s === "busy" || s === "مشغولة") return "occupied";
  if (s.includes("reserv") || s === "reserved" || s === "محجوزة") return "reserved";
  if (s === "dirty" || s === "متسخة") return "dirty";
  if (s === "cleaning" || s === "تنظيف") return "cleaning";
  return "ready";
}

function statusLabel(st: TableStatus) {
  switch (st) {
    case "occupied":
      return "مشغولة";
    case "reserved":
      return "محجوزة";
    case "dirty":
      return "متسخة";
    case "cleaning":
      return "قيد التنظيف";
    default:
      return "جاهزة";
  }
}

export default function ReceptionPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [msg, setMsg] = useState("");
  const [modal, setModal] = useState<TableRow | null>(null);
  const [guestCount, setGuestCount] = useState(2);
  const [childrenCount, setChildrenCount] = useState(0);
  const [allergy, setAllergy] = useState(false);
  const [special, setSpecial] = useState("");

  const load = useCallback(async () => {
    setMsg("");
    try {
      const [tablesRes, floorPlanRes] = await Promise.all([
        fetch(`${base}/api/restaurant/tables`),
        fetch(`${base}/api/restaurant/floor-plan?t=${Date.now()}`),
      ]);
      const j = await tablesRes.json();
      const floorPlanJson = await floorPlanRes.json().catch(() => ({}));
      const rows = Array.isArray(j.tables) ? j.tables : [];
      const labeledRows = mapTablesToFloorPlanLabels(floorPlanJson?.plan, rows);
      setTables(
        labeledRows.map(
          (t: {
            id?: string;
            name?: string;
            status?: string;
            seats?: number;
            number?: number;
            features?: Record<string, unknown>;
          }) => ({
            id: String(t.id || ""),
            name: String(t.name || "طاولة"),
            status: normalizeStatus(String(t.status || "ready")) as TableStatus,
            seats: Number(t.seats) || 4,
            number: t.number,
            features: t.features,
          })
        )
      );
    } catch (e) {
      setMsg(`تعذر تحميل الطاولات: ${String(e)}`);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  function openSeat(t: TableRow) {
    setMsg("");
    if (t.status === "occupied") {
      setMsg("الطاولة مشغولة حالياً.");
      return;
    }
    if (t.status === "reserved") {
      setMsg("الطاولة محجوزة — راجع الحالة قبل الإسكان.");
      return;
    }
    if (t.status === "dirty" || t.status === "cleaning") {
      setMsg("الطاولة غير جاهزة بعد. أكمل دورة التنظيف أولاً.");
      return;
    }
    setGuestCount(Math.min(t.seats || 4, 4));
    setChildrenCount(0);
    setAllergy(false);
    setSpecial("");
    setModal(t);
  }

  async function confirmSeat() {
    if (!modal) return;
    setMsg("");
    try {
      const seatR = await fetch(`${base}/api/restaurant/table-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: modal.id,
          mat3amActor: buildMat3amActor(user),
          guestCount: Math.max(1, guestCount),
          childrenCount: Math.max(0, childrenCount),
          preferences: {
            source: "reception",
            hasAllergy: allergy,
            specialRequests: special.trim(),
          },
        }),
      });
      const seatText = await seatR.text();
      if (!seatR.ok) {
        let detail = seatText || `HTTP ${seatR.status}`;
        try {
          const parsed = JSON.parse(seatText) as { detail?: unknown; approvalRequested?: boolean; message?: string };
          if (parsed?.approvalRequested && typeof parsed?.message === "string" && parsed.message.trim()) detail = parsed.message;
          if (typeof parsed?.detail === "string" && parsed.detail.trim()) detail = parsed.detail;
        } catch {}
        setMsg(detail);
        return;
      }
      try {
        const parsed = JSON.parse(seatText) as { approvalRequested?: boolean; message?: string };
        if (parsed?.approvalRequested) {
          setMsg(typeof parsed.message === "string" && parsed.message.trim() ? parsed.message : "تم رفع طلب موافقة للمدير.");
          setModal(null);
          await load();
          return;
        }
      } catch {}
      try {
        await fetch(`${base}/api/restaurant/tables/${encodeURIComponent(modal.id)}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "occupied" }),
        });
      } catch {
        /* ignore: backend already attempts to update status */
      }
      setModal(null);
      await load();
      setMsg(`تم إسكان العملاء على ${modal.name}`);
    } catch (e) {
      setMsg(`فشل الإسكان: ${String(e)}`);
    }
  }

  return (
    <div className="role-op waiter-pos">
      <OperationalRoleHeader roleTitle="جارسون الاستقبال" hideBack />

      <div className="role-op__main">
        <h2 className="role-op__section-title">خريطة الطاولات</h2>
        <p style={{ color: "var(--wp-muted)", fontSize: "0.9rem", marginTop: "-0.5rem", marginBottom: "1rem" }}>
          اختر طاولة متاحة ثم إسكان العملاء (عدد الأفراد، الأطفال، الحساسية، الطلبات الخاصة).
        </p>

        {tables.length === 0 ? (
          <div style={{ color: "var(--wp-muted)" }}>لا توجد طاولات من الخادم.</div>
        ) : (
          <div className="role-op__map-grid">
            {tables.map((t) => {
              const st = t.status;
              const cardClass =
                st === "occupied"
                  ? "role-op__map-card role-op__map-card--occupied"
                  : st === "reserved"
                    ? "role-op__map-card role-op__map-card--reserved"
                    : st === "dirty" || st === "cleaning"
                      ? "role-op__map-card role-op__map-card--reserved"
                      : "role-op__map-card role-op__map-card--available";
              const num = normalizeTableDisplayLabel(t.name, t.number, t.id);
              const btnClass =
                st === "occupied"
                  ? "role-op__map-status-btn role-op__map-status-btn--occ"
                  : st === "reserved"
                    ? "role-op__map-status-btn role-op__map-status-btn--res"
                    : "role-op__map-status-btn role-op__map-status-btn--avail";
              const feats = t.features && typeof t.features === "object" ? t.features : {};
              const vip = Boolean((feats as { vipSection?: boolean }).vipSection);
              const nearB = Boolean((feats as { nearBalcony?: boolean }).nearBalcony);

              return (
                <button
                  key={t.id}
                  type="button"
                  className={cardClass}
                  onClick={() => openSeat(t)}
                >
                  <div className="role-op__map-card-head">
                    <span className="role-op__map-num">{num}</span>
                    <span className={st === "ready" ? "role-op__map-icon-ok" : "role-op__map-icon-no"} aria-hidden>
                    {st === "ready" ? "✓" : "✕"}
                    </span>
                  </div>
                  <div className="role-op__map-seats">🪑 مقاعد {t.seats}</div>
                  <div className="role-op__map-features">
                    <span className="role-op__feat" style={{ background: "#fce7f3" }} title="ميزة">
                      ●
                    </span>
                    <span className="role-op__feat" style={{ background: "#dbeafe" }} title="موقع">
                      ≈
                    </span>
                    {vip && (
                      <span className="role-op__feat" style={{ background: "#fef08a" }} title="VIP">
                        ♛
                      </span>
                    )}
                    {nearB && (
                      <span className="role-op__feat" style={{ background: "#e5e7eb" }} title="شرفة">
                        ▢
                      </span>
                    )}
                  </div>
                  <div className={btnClass} role="presentation">
                    {statusLabel(st)}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {msg && <p className="waiter-pos__msg">{msg}</p>}
      </div>

      {modal && (
        <div className="role-op__modal-overlay" role="dialog" aria-modal>
          <div className="role-op__modal">
            <div className="role-op__modal-head">
              <h3 className="role-op__modal-title">إسكان عملاء — {modal.name}</h3>
              <button type="button" className="role-op__modal-close" onClick={() => setModal(null)} aria-label="إغلاق">
                ×
              </button>
            </div>
            <div className="role-op__field">
              <label htmlFor="guests">عدد الأفراد</label>
              <input
                id="guests"
                type="number"
                min={1}
                max={Math.max(1, modal.seats)}
                value={guestCount}
                onChange={(e) => setGuestCount(Number(e.target.value) || 1)}
              />
            </div>
            <div className="role-op__field">
              <label htmlFor="children">عدد الأطفال</label>
              <input
                id="children"
                type="number"
                min={0}
                value={childrenCount}
                onChange={(e) => setChildrenCount(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="role-op__field">
              <label className="role-op__check-row">
                <input type="checkbox" checked={allergy} onChange={(e) => setAllergy(e.target.checked)} />
                <span>يوجد حساسية من أطعمة معينة</span>
                <span aria-hidden>⚠️</span>
              </label>
            </div>
            <div className="role-op__field">
              <label htmlFor="special">طلبات خاصة</label>
              <textarea
                id="special"
                value={special}
                onChange={(e) => setSpecial(e.target.value)}
                placeholder="مواصفات خاصة، قرب الشرفة، إلخ"
              />
            </div>
            <div className="role-op__modal-actions">
              <button type="button" className="waiter-pos__btn waiter-pos__btn--primary" onClick={() => void confirmSeat()}>
                ✓ إسكان العملاء
              </button>
              <button type="button" className="waiter-pos__btn waiter-pos__btn--ghost" onClick={() => setModal(null)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
