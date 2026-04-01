import { NavLink } from "react-router-dom";
import FloorPlanLive from "../../components/FloorPlanLive";

export default function VenueFloorSettingsPage() {
  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>
        المكان والطابق والمساحات
      </h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6, marginTop: 0 }}>
        للرسم والطوابق استخدم{" "}
        <NavLink to="../floor-editor" style={{ fontWeight: 600 }}>
          محرّر مخطط الصالة
        </NavLink>
        . المصدر: <code>floor_plan.json</code> عبر <code>GET/PUT /api/restaurant/floor-plan</code>.
      </p>
      <FloorPlanLive />
    </div>
  );
}
