import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import PosPlaceholder from "./PosPlaceholder";
import "../styles/deliveryOrderPage.css";

/** نقطة طلب الدليفري المستقلة — منيو + شحن + بيانات العميل، بدون طاولات وبدون لمس شاشة جرسون الصالة. */
export default function DeliveryOrderPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = String(user?.role || "cashier");
  const backTo = useMemo(() => `/app/${role}/delivery-hub`, [role]);

  const name = String(params.get("name") || "").trim();
  const phone = String(params.get("phone") || "").trim();

  return (
    <div className="delivery-order-page" dir="rtl">
      <div className="delivery-order-page__banner">
        <div>
          <p className="delivery-order-page__eyebrow">طلب دليفري</p>
          <h1>شاشة طلب التوصيل</h1>
          <p>
            {name || phone
              ? `${name || "عميل"}${phone ? ` · ${phone}` : ""}`
              : "أدخل الأصناف والشحن — بيانات العميل تظهر في الفاتورة والطباعة"}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => navigate(backTo)}>
          رجوع لإدارة الدليفري
        </button>
      </div>
      <PosPlaceholder
        saleChannel="delivery"
        deliveryOnly
        pageTitle="طلب دليفري — أصناف وشحن"
        backTo={backTo}
      />
    </div>
  );
}
