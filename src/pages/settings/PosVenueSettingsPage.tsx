import { useEffect, useState } from "react";
import { useVenue } from "../../context/VenueContext";
import { getApiBase } from "../../lib/apiBase";
import type { VenueType } from "../../lib/venueType";

export default function PosVenueSettingsPage() {
  const base = getApiBase();
  const { refresh: refreshVenue } = useVenue();
  const [venueType, setVenueType] = useState<VenueType>("restaurant");
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const r = await fetch(`${base}/api/restaurant/venue`);
      const vj = await r.json();
      setVenueType(vj.venueType === "coffee_shop" ? "coffee_shop" : "restaurant");
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
        body: JSON.stringify({ venueType }),
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
      <h2 style={{ marginTop: 0 }}>نوع المنشأ</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        يحدّد تسميات الواجهة والافتراض في نقطة البيع (طاولة مقابل سفري). سير العمل التشغيلي (استقبال، جلسة، مطبخ) لا يتغيّر.
      </p>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="radio" name="venue" checked={venueType === "restaurant"} onChange={() => setVenueType("restaurant")} />
            مطعم (افتراضي طاولة في POS)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="radio" name="venue" checked={venueType === "coffee_shop"} onChange={() => setVenueType("coffee_shop")} />
            كوفي شوب (افتراضي سفري في POS)
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void saveVenue()}>
            حفظ
          </button>
        </div>
      </div>
      {msg ? <p style={{ color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}
