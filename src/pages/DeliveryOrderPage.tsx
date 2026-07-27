import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import WaiterOrderPage from "./WaiterOrderPage";
import "../styles/deliveryOrderPage.css";

/**
 * شاشة طلب التوصيل = نفس نقطة بيع جرسون الطلبات (WaiterOrderPage)
 * مع embeddedChannel="delivery" (بدون طاولات/مقاعد، وبحث عميل + محببات داخل شاشة الجرسون).
 */
export default function DeliveryOrderPage() {
  const { user } = useAuth();
  const role = String(user?.role || "cashier");
  const backTo = useMemo(() => `/app/${role}/delivery-hub`, [role]);

  return (
    <div className="delivery-order-page delivery-order-page--waiter" dir="rtl">
      <WaiterOrderPage
        embeddedChannel="delivery"
        pageTitle="طلب دليفري — جرسون التوصيل"
        backTo={backTo}
      />
    </div>
  );
}
