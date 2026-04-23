import { useState } from "react";

export default function CashExpensePage() {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("عام");

  function save(e: React.FormEvent) {
    e.preventDefault();
    alert(
      `مسودة محلية فقط.\nالمبلغ: ${amount}\nالبيان: ${note}\nالتصنيف: ${category}\n\nالخطوة التالية: ربط POST بخادم إكسترا (سند صرف / مصروف).`
    );
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>صرف مصروفات</h2>
      <form className="card" onSubmit={save} style={{ maxWidth: 480 }}>
        <label style={{ display: "block", marginBottom: 6 }}>المبلغ</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          step="0.01"
          style={{ width: "100%", marginBottom: "1rem" }}
        />
        <label style={{ display: "block", marginBottom: 6 }}>التصنيف</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ width: "100%", marginBottom: "1rem" }}
        >
          <option value="عام">عام</option>
          <option value="مشتريات يومية">مشتريات يومية</option>
          <option value="صيانة">صيانة</option>
          <option value="نثريات">نثريات</option>
        </select>
        <label style={{ display: "block", marginBottom: 6 }}>البيان</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          style={{ width: "100%", marginBottom: "1rem" }}
        />
        <button type="submit" className="btn btn-primary">
          تسجيل الصرف
        </button>
      </form>
    </div>
  );
}
