import { Navigate } from "react-router-dom";

/** طابور الدليفري أصبح تبويباً داخل مركز الدليفري الموحّد. */
export default function DeliveryManagementPage() {
  return <Navigate to="../delivery-hub?tab=queue" replace />;
}
