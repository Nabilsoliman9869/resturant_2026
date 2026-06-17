import { useEffect, useState } from "react";
import { useVenue } from "../../context/VenueContext";
import { getApiBase } from "../../lib/apiBase";
import SettingRow from "../../components/SettingRow";
import type { VenueType } from "../../lib/venueType";

export default function PosVenueSettingsPage() {
  const base = getApiBase();
  const { refresh: refreshVenue } = useVenue();
  const [venueType, setVenueType] = useState<VenueType>("restaurant");
  const [venueName, setVenueName] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const r = await fetch(`${base}/api/restaurant/venue`);
      const vj = await r.json();
      setVenueType(vj.venueType === "coffee_shop" ? "coffee_shop" : "restaurant");
      setVenueName(String(vj.venueName || ""));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void load();
  }, [base]);

  async function saveVenue() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/venue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueType, venueName: venueName.trim() }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      await refreshVenue();
      setMsg("تم الحفظ.");
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>إعدادات المنشأ</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        يحدّد اسم المطعم/الكوفي ونوع المنشأ لتخصيص الواجهة.
      </p>
      <SettingRow
        label="اسم المنشأ"
        tooltip="يظهر في الشريط الجانبي وعناوين الشاشات الرئيسية. إذا تركته فارغًا يُستخدم الاسم الافتراضي."
      >
        <input
          type="text"
          value={venueName}
          onChange={(e) => setVenueName(e.target.value)}
          placeholder="مثال: مطعم الف ليلة وليلة"
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", minWidth: 260, fontSize: "0.95rem" }}
        />
      </SettingRow>
      <SettingRow
        label="نوع المنشأ"
        tooltip="يُحدّد الوضع الافتراضي عند فتح نقطة البيع: جلسة طاولة (مطعم) أو سفري/دليفري (كوفي شوب). لا يؤثر على سير العمل الداخلي (استقبال، مطبخ، طباعة)."
      >
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="radio" name="venue" checked={venueType === "restaurant"} onChange={() => setVenueType("restaurant")} />
            مطعم (افتراضي طاولة في POS)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="radio" name="venue" checked={venueType === "coffee_shop"} onChange={() => setVenueType("coffee_shop")} />
            كوفي شوب (افتراضي سفري في POS)
          </label>
        </div>
      </SettingRow>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-primary" onClick={() => void saveVenue()}>
          حفظ
        </button>
      </div>
      {msg ? <p style={{ color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}
