import { Navigate } from "react-router-dom";

/** كول سنتر منفصل أُخفي — المسار يوجّه لمركز إدارة الدليفري. */
export default function CallCenterPage() {
  return <Navigate to="../delivery-hub" replace />;
}
