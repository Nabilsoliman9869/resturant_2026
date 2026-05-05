import WaiterOrderPage from "./WaiterOrderPage";

/** شاشة كول سنتر: واجهة الجرسون على قناة الدليفري مع ربط العميل ومركز التكلفة (TBL016↔TBL005). */
export default function CallCenterPage() {
  return (
    <WaiterOrderPage
      embeddedChannel="delivery"
      pageTitle="Call Center — استقبال طلبات الدليفري"
      backTo="/app/cashier/dashboard"
    />
  );
}
