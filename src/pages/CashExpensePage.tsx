import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { buildMat3amActor } from "../lib/mat3amActor";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";

export default function CashExpensePage() {
  const base = getApiBase();
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("عام");
  const [kind, setKind] = useState<"expense" | "purchase">("expense");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setMsg("أدخل مبلغاً صالحاً");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/outflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mat3amActor: buildMat3amActor(user),
          kind,
          amount: amt,
          category,
          note,
        }),
      });
      const j = tryParseJson<{ detail?: string; outflowId?: string }>(await r.text()) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "فشل الحفظ");
      setMsg(`تم التسجيل · سيُخصم عند إقفال الشيفت (${String(j.outflowId || "").slice(0, 8)}…)`);
      setAmount("");
      setNote("");
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>صرف مصروفات / مشتريات الصندوق</h2>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        تُحفظ في SQL وتُخصم تلقائياً من النقدي عند «اقفال الشيفت» لنفس المستخدم.
      </p>
      <form className="card" onSubmit={(e) => void save(e)} style={{ maxWidth: 480 }}>
        <label style={{ display: "block", marginBottom: 6 }}>النوع</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as "expense" | "purchase")} style={{ width: "100%", marginBottom: "1rem" }}>
          <option value="expense">صرف مصروفات</option>
          <option value="purchase">مشتريات نقدية</option>
        </select>
        <label style={{ display: "block", marginBottom: 6 }}>المبلغ</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          step="0.01"
          style={{ width: "100%", marginBottom: "1rem" }}
        />
        <label style={{ display: "block", marginBottom: 6 }}>التصنيف</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "100%", marginBottom: "1rem" }}>
          <option value="عام">عام</option>
          <option value="مشتريات يومية">مشتريات يومية</option>
          <option value="صيانة">صيانة</option>
          <option value="نثريات">نثريات</option>
        </select>
        <label style={{ display: "block", marginBottom: 6 }}>البيان</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ width: "100%", marginBottom: "1rem" }} />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          تسجيل الصرف
        </button>
        {msg ? <p style={{ marginTop: "0.75rem" }}>{msg}</p> : null}
      </form>
    </div>
  );
}
