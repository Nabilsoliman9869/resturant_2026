import { NavLink } from "react-router-dom";
import FloorPlanLive from "../../components/FloorPlanLive";

export default function VenueFloorSettingsPage() {
  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>
        المكان والطابق والمساحات
      </h1>
      <p style={{ marginTop: "0.5rem" }}>
        <NavLink to="../floor-editor" className="btn btn-ghost" style={{ fontSize: "0.9rem" }}>
          محرّر مخطط الصالة
        </NavLink>
      </p>
      <FloorPlanLive />
    </div>
  );
}
