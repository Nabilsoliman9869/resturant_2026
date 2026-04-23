import { Link, useLocation } from "react-router-dom";

export default function DeveloperInitDb() {
  const loc = useLocation();
  const settingsBase = loc.pathname.match(/^(\/app\/[^/]+\/settings)/)?.[1] ?? "/app/developer/settings";

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>تهيئة SQL</h2>
      <p>
        <Link to={`${settingsBase}/connection`} className="btn btn-primary">
          اتصال القاعدة وتنفيذ التهيئة
        </Link>
      </p>
    </div>
  );
}
