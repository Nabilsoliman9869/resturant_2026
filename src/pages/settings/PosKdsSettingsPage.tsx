import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getApiBase } from "../../lib/apiBase";
import SettingRow from "../../components/SettingRow";

export default function PosKdsSettingsPage() {
  const base = getApiBase();
  const loc = useLocation();
  const settingsBase = loc.pathname.match(/^(\/app\/[^/]+\/settings)/)?.[1] ?? "/app/manager/settings";
  const [kdsPrep, setKdsPrep] = useState(20);
  const [kdsWarn, setKdsWarn] = useState(5);
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const kRes = await fetch(`${base}/api/restaurant/kds-settings`);
      const kj = await kRes.json();
      setKdsPrep(Number(kj.prepTargetMinutes) || 20);
      setKdsWarn(Number(kj.warnBeforeEndMinutes) || 5);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void load();
  }, [base]);

  async function saveKds() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/kds-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prepTargetMinutes: kdsPrep, warnBeforeEndMinutes: kdsWarn }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setMsg("تم الحفظ.");
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>شاشة المطبخ (KDS)</h2>
      <p style={{ marginTop: "0.5rem" }}>
        <NavLink to={`${settingsBase}/pos-prep-times`} className="btn btn-ghost" style={{ fontSize: "0.9rem" }}>
          أزمنة تحضير لكل صنف (TBL007)
        </NavLink>
      </p>
      <div className="grid-2">
        <SettingRow label="زمن التحضير الافتراضي (دقيقة)" tooltip="الوقت المتوقع لإعداد الطلب في المطبخ. يُستخدم في شاشة KDS لحساب وقت التسليم المتوقع عند عدم وجود زمن مُحدد للصنف في TBL007.">
          <input
            type="number"
            min={1}
            max={240}
            value={kdsPrep}
            onChange={(e) => setKdsPrep(Number(e.target.value) || 20)}
            style={{ width: "100%" }}
          />
        </SettingRow>
        <SettingRow label="تنبيه قبل النهاية (دقيقة)" tooltip="متى يبدأ KDS بإظهار تنبيه باللون الأحمر/البرتقالي قبل انتهاء زمن التحضير. يساعد مدير المطبخ على تتبع الطلبات المتأخرة.">
          <input
            type="number"
            min={0}
            max={120}
            value={kdsWarn}
            onChange={(e) => setKdsWarn(Number(e.target.value) || 5)}
            style={{ width: "100%" }}
          />
        </SettingRow>
      </div>
      <div style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" onClick={() => void saveKds()}>
          حفظ
        </button>
      </div>
      {msg ? <p style={{ color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}
