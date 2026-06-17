import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import SettingRow from "../../components/SettingRow";

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
      <div className="grid-2">
        <SettingRow label="نسبة الخدمة (%)" tooltip="نسبة الخدمة المضافة تلقائياً على إجمالي الفاتورة. تُحسب على صافي المطلوب أو على المجموع حسب ترتيب التطبيق أدناه.">
          <input
            type="number"
            step="any"
            value={policy.servicePercent}
            onChange={(e) => setPolicy((s) => ({ ...s, servicePercent: Number(e.target.value) || 0 }))}
            style={{ width: "100%" }}
          />
        </SettingRow>

        <SettingRow label="نسبة VAT (%)" tooltip="نسبة الضريبة المضافة. تُطبّق على صافي الفاتورة (بعد الخصم إن وُجد) أو على المجموع + الخدمة حسب الترتيب المُحدد.">
          <input
            type="number"
            step="any"
            value={policy.vatPercent}
            onChange={(e) => setPolicy((s) => ({ ...s, vatPercent: Number(e.target.value) || 0 }))}
            style={{ width: "100%" }}
          />
        </SettingRow>

        <SettingRow label="الخصم قبل الضريبة" tooltip="عند التفعيل: يُطبّق الخصم أولاً على المجموع، ثم تُحسب الخدمة والضريبة على الصافي. عند التعطيل: الخصم يُطرح من الإجمالي النهائي (بعد الخدمة + VAT).">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={policy.applyDiscountBeforeTax}
              onChange={(e) => setPolicy((s) => ({ ...s, applyDiscountBeforeTax: e.target.checked }))}
            />
            <span>نعم — الخصم يُحسب على المجموع أولاً</span>
          </label>
        </SettingRow>

        <SettingRow label="الخدمة قبل VAT" tooltip="عند التفعيل: تُضاف نسبة الخدمة على المجموع، ثم تُحسب VAT على (المجموع + الخدمة). عند التعطيل: VAT تُحسب على المجموع فقط، ثم تُضاف الخدمة في النهاية.">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={policy.serviceBeforeVat}
              onChange={(e) => setPolicy((s) => ({ ...s, serviceBeforeVat: e.target.checked }))}
            />
            <span>نعم — الخدمة تُحسب قبل VAT</span>
          </label>
        </SettingRow>
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" onClick={() => void savePolicy()}>
          حفظ
        </button>
      </div>
      {msg ? <p style={{ color: "var(--accent2)" }}>{msg}</p> : null}
    </div>
  );
}
