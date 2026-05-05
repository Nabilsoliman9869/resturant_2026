import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import PosPlaceholder from "./PosPlaceholder";
import "../styles/operationalRoles.css";

/** نقطة بيع «المواقع» — نفس واجهة نقاط البيع الموحدة بقناة sites (كاشير / دور المواقع). */
export default function SpeedOrderEntryPage() {
  const loc = useLocation();
  const backTo = useMemo(() => {
    if (loc.pathname.startsWith("/app/cashier")) return "/app/cashier/dashboard";
    return "/app/speed_order";
  }, [loc.pathname]);

  return (
    <div className="role-op role-op--waiter">
      <div className="role-op__main" style={{ height: "100%", minHeight: 0 }}>
        <PosPlaceholder
          saleChannel="sites"
          pageTitle="نقاط بيع المواقع"
          backTo={backTo}
        />
      </div>
    </div>
  );
}
