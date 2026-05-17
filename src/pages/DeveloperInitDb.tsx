import { Navigate, useLocation } from "react-router-dom";

/** مسار قديم — يُوجَّه مباشرة لصفحة الاتصال والتهيئة المرقّمة */
export default function DeveloperInitDb() {
  const loc = useLocation();
  const settingsBase = loc.pathname.match(/^(\/app\/[^/]+\/settings)/)?.[1] ?? "/app/developer/settings";
  return <Navigate to={`${settingsBase}/connection`} replace />;
}
