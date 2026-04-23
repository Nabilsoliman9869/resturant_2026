import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type Policy = {
  servicePercent: number;
  vatPercent: number;
  applyDiscountBeforeTax: boolean;
  serviceBeforeVat: boolean;
};

export default function PosTaxPolicySettingsPage() {
  const base = getApiBase();
  const [policy, setPolicy] = useState<Policy>({
    servicePercent: 12.5,
    vatPercent: 14,
    applyDiscountBeforeTax: true,
    serviceBeforeVat: true,
  });
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const pRes = await fetch(`${base}/api/pos/policy`);
      const p = await pRes.json();
      setPolicy({
        servicePercent: Number(p.servicePercent ?? 12.5),
        vatPercent: Number(p.vatPercent ?? 14),
        applyDiscountBeforeTax: Boolean(p.applyDiscountBeforeTax ?? true),
        serviceBeforeVat: Boolean(p.serviceBeforeVat ?? true),
      });
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void load();
  }, [base]);

  async function savePolicy() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/pos/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
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
      <h2 style={{ marginTop: 0 }}>سياسة الضريبة والخدمة</h2>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: 6 }}>
          خدمة (%)
          <input
            type="number"
            step="any"
            value={policy.servicePercent}
            onChange={(e) => setPolicy((s) => ({ ...s, servicePercent: Number(e.target.value) || 0 }))}
            style={{ width: "100%", marginTop: 4 }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          VAT (%)
          <input
            type="number"
            step="any"
            value={policy.vatPercent}
            onChange={(e) => setPolicy((s) => ({ ...s, vatPercent: Number(e.target.value) || 0 }))}
            style={{ width: "100%", marginTop: 4 }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={policy.applyDiscountBeforeTax}
            onChange={(e) => setPolicy((s) => ({ ...s, applyDiscountBeforeTax: e.target.checked }))}
          />{" "}
          الخصم قبل الضريبة
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={policy.serviceBeforeVat}
            onChange={(e) => setPolicy((s) => ({ ...s, serviceBeforeVat: e.target.checked }))}
          />{" "}
          الخدمة قبل VAT
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void savePolicy()}>
          حفظ
        </button>
      </div>
      {msg ? <p style={{ color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}
