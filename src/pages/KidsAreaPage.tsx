import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { safeFetch } from "../lib/safeFetch";
import { useAuth } from "../auth/AuthContext";
import { buildMat3amActor } from "../lib/mat3amActor";

type KItem = {
  productGuide: string;
  name: string;
  price: number;
  isKitchen: boolean;
  minutes: number;
};

type KPackage = {
  packageGuide: string;
  packageName: string;
  latinName: string;
  items: KItem[];
  totalPrice: number;
  durationMinutes: number;
};

type KLine = {
  lineId: string;
  productGuide: string;
  name: string;
  quantity: number;
  unitPrice: number;
  isKitchen: boolean;
  kitchenStatus?: string | null;
  kitchenSentAt?: string;
  kitchenOrderId?: string;
  minutes: number;
  addedAt: string;
  fromPackage: boolean;
};

type KPayment = {
  id: string;
  kind: string;
  amount: number;
  method: string;
  at: string;
  note?: string;
};

type KAlert = { id: string; text: string; at: string; by?: string };

type KOvertime = {
  applicable: boolean;
  exempt: boolean;
  alreadyApplied: boolean;
  rawMinutes: number;
  billableMinutes: number;
  ratePerMinute: number;
  packageMinutes: number;
  packageTimePrice: number;
  charge: number;
  refProductGuide: string | null;
  refName: string | null;
  exitExpectedAt: string | null;
};

type KTicket = {
  id: string;
  status: "active" | "closed" | string;
  childName: string;
  fatherName: string;
  phone: string;
  age: number | null;
  packageGuide: string;
  packageName: string;
  packageMinutes: number;
  packageTotal: number;
  companionsNote: string;
  entryAt: string;
  exitExpectedAt: string | null;
  exitAt: string | null;
  lines: KLine[];
  invoice: {
    cardGuide: string;
    billNumber: number;
    invoiceTypeGuide: string;
    agentGuide: string;
    costCenter: string | null;
  };
  payments: KPayment[];
  alerts: KAlert[];
  notes: KAlert[];
  overtime?: KOvertime;
  overtimeExempt?: boolean;
  overtimeAppliedAt?: string;
  overtimeMinutesApplied?: number;
  overtimeChargeApplied?: number;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number) => Number(n || 0).toFixed(2);
const sumLines = (lines: KLine[]) =>
  lines.reduce((s, l) => s + num(l.quantity) * num(l.unitPrice), 0);
const sumPayments = (pays: KPayment[]) =>
  pays.reduce((s, p) => s + num(p.amount), 0);

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}
function fmtRemainingMinutes(iso: string | null): string {
  if (!iso) return "—";
  try {
    const ms = new Date(iso).getTime() - Date.now();
    const mins = Math.round(ms / 60000);
    if (mins <= 0) return "انتهت المدة";
    if (mins < 60) return `${mins} د`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} س` : `${h} س ${m} د`;
  } catch {
    return "—";
  }
}
function fmtDuration(mins: number): string {
  if (!mins || mins <= 0) return "غير محدد";
  if (mins < 60) return `${mins} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} ساعة` : `${h} س ${m} د`;
}
function fmtMinsCompact(mins: number): string {
  if (mins <= 0) return "0 د";
  if (mins < 60) return `${mins} د`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} س` : `${h} س ${m} د`;
}

/* ============================================================
   نمط بصري موحد — يتناسق مع ثيم --bg/--surface/--accent
   ============================================================ */
const STYLES = `
.kids {
  --kpad: 16px;
  font-family: var(--font);
  direction: rtl;
  padding: var(--kpad);
  color: var(--text);
}
.kids__hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px 18px;
  border-radius: var(--radius);
  background: linear-gradient(135deg, rgba(249,115,22,0.18), rgba(34,211,238,0.10));
  border: 1px solid var(--border);
}
.kids__hdr h2 { margin: 0; font-family: var(--display); font-size: 1.35rem; }
.kids__hdr p  { margin: 2px 0 0; color: var(--muted); font-size: 13px; }

.kids__alert {
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 14px;
  border: 1px solid var(--border);
  font-weight: 600;
}
.kids__alert--ok  { background: rgba(52,211,153,0.12); color: var(--ok);    border-color: rgba(52,211,153,0.25); }
.kids__alert--err { background: rgba(251,113,133,0.14); color: var(--danger); border-color: rgba(251,113,133,0.30); }
.kids__alert--info{ background: rgba(34,211,238,0.10); color: var(--accent2); border-color: rgba(34,211,238,0.25); }

/* —— شبكة شرائح —— */
.kids__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.kids__empty {
  padding: 28px 16px;
  text-align: center;
  border: 2px dashed var(--border);
  border-radius: 14px;
  color: var(--muted);
}

/* —— بطاقة تذكرة —— */
.kids__card {
  background: linear-gradient(160deg, var(--surface), var(--surface2));
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: transform .12s ease, box-shadow .15s ease, border-color .15s ease;
}
.kids__card:hover { transform: translateY(-2px); border-color: rgba(34,211,238,0.35); box-shadow: 0 10px 28px rgba(0,0,0,0.30); }
.kids__card.is-overdue { border-color: rgba(251,191,36,0.55); background: linear-gradient(160deg, rgba(251,191,36,0.10), var(--surface2)); }
.kids__card.is-active  { box-shadow: 0 0 0 3px rgba(34,211,238,0.45); border-color: rgba(34,211,238,0.45); }

.kids__card-h { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
.kids__card-h .name { font-size: 1.05rem; font-weight: 800; color: var(--text); }
.kids__card-h .age  { color: var(--muted); font-weight: 600; font-size: 12px; margin-inline-start: 4px; }
.kids__bill-no { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); color: var(--muted); font-weight: 700; letter-spacing: .04em; }

.kids__pkg-line { font-weight:700; color: var(--accent); font-size: 0.95rem; }
.kids__meta { display:flex; justify-content:space-between; gap:8px; font-size: 12px; color: var(--muted); }
.kids__meta b { color: var(--text); font-weight: 700; }
.kids__remain { font-weight:700; }
.kids__remain.ok    { color: var(--ok); }
.kids__remain.warn  { color: var(--warn); }

.kids__totals {
  display:grid; grid-template-columns: repeat(3, 1fr);
  gap: 6px; padding: 8px;
  background: rgba(255,255,255,0.04);
  border-radius: 10px;
  font-size: 12px;
  text-align: center;
}
.kids__totals span { color: var(--muted); }
.kids__totals b { display:block; font-size: 14px; color: var(--text); font-weight:800; margin-top:2px; }
.kids__totals .due  { color: var(--danger); }
.kids__totals .paid { color: var(--ok); }

.kids__pill {
  padding: 4px 10px; border-radius: 999px; font-size: 11.5px; font-weight:700;
  display:inline-flex; align-items:center; gap:5px;
  border: 1px solid transparent;
}
.kids__pill--warn  { background: rgba(251,191,36,0.14); color: var(--warn); border-color: rgba(251,191,36,0.30); }
.kids__pill--alert { background: rgba(251,113,133,0.14); color: var(--danger); border-color: rgba(251,113,133,0.30); }
.kids__pill--ok    { background: rgba(52,211,153,0.14); color: var(--ok); border-color: rgba(52,211,153,0.30); }
.kids__pill--ot    { background: rgba(249,115,22,0.14); color: var(--accent); border-color: rgba(249,115,22,0.35); }

/* —— شريحة الوقت الإضافي —— */
.kids__ot {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 10px;
  background: rgba(249,115,22,0.10);
  border: 1px solid rgba(249,115,22,0.30);
  font-size: 12.5px; color: var(--text);
}
.kids__ot.exempt { background: rgba(52,211,153,0.10); border-color: rgba(52,211,153,0.30); color: var(--ok); }
.kids__ot.applied{ background: rgba(94,234,212,0.08); border-color: rgba(94,234,212,0.25); color: var(--accent2); }
.kids__ot b { color: var(--accent); font-weight: 800; }
.kids__ot.exempt b { color: var(--ok); }
.kids__ot.applied b { color: var(--accent2); }

/* —— أزرار ثانوية —— */
.kids__btn-row { display:flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.btn-warning { background: linear-gradient(135deg, var(--warn), #f59e0b); color: #0f172a; font-weight:700; }
.btn-success { background: linear-gradient(135deg, var(--ok), #10b981); color: #0f172a; font-weight:700; }
.btn-danger  { background: linear-gradient(135deg, var(--danger), #f43f5e); color: #0f172a; font-weight:700; }

/* —— Modal —— */
.kids__modal-bg {
  position: fixed; inset: 0;
  background: rgba(2,6,15,0.78);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
}
.kids__modal {
  width: min(1000px, 100%);
  max-height: 92vh; overflow:auto;
  background: linear-gradient(180deg, var(--surface), var(--surface2));
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 22px 22px 18px;
  box-shadow: 0 30px 60px rgba(0,0,0,0.55);
}
.kids__modal-h { display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px; }
.kids__modal-h h3 { margin: 0; font-family: var(--display); font-size: 1.2rem; }
.kids__modal-sub { color: var(--muted); font-size: 13px; margin: 0 0 16px; }

/* —— خطوات —— */
.kids__steps {
  display:grid; grid-template-columns: repeat(3, 1fr);
  gap: 8px; margin-bottom: 18px;
}
.kids__step {
  text-align:center; padding: 10px 8px;
  border-radius: 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border);
  font-weight:700; font-size: 13px; color: var(--muted);
}
.kids__step.done { color: var(--ok); border-color: rgba(52,211,153,0.30); background: rgba(52,211,153,0.10); }
.kids__step.cur  { color: var(--accent); border-color: rgba(249,115,22,0.45); background: rgba(249,115,22,0.10); }
.kids__step b { display:block; font-size: 11px; opacity: 0.8; }

/* —— شبكة الباقات —— */
.kids__pkgs {
  display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.kids__pkg {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  display:flex; flex-direction:column; gap: 8px;
  cursor:pointer; text-align: right;
  transition: transform .12s ease, border-color .15s ease, background .15s ease;
}
.kids__pkg:hover  { transform: translateY(-2px); border-color: rgba(34,211,238,0.35); }
.kids__pkg.active { border-color: var(--accent); background: rgba(249,115,22,0.10); box-shadow: 0 8px 24px rgba(249,115,22,0.18); }

.kids__pkg-name { font-weight:800; font-size: 1.05rem; }
.kids__pkg-latin{ color: var(--muted); font-size: 12px; }
.kids__pkg-row  { display:flex; justify-content:space-between; align-items:center; }
.kids__pkg-price{ font-size: 1.3rem; font-weight:800; color: var(--accent); }
.kids__pkg-dur  { font-size: 13px; color: var(--accent2); font-weight:700; padding: 3px 8px; border-radius: 999px; background: rgba(34,211,238,0.10); }
.kids__pkg-items{ display:flex; flex-direction:column; gap: 4px; margin-top:6px; padding-top:8px; border-top: 1px dashed var(--border); }
.kids__pkg-item { display:flex; justify-content:space-between; align-items:center; font-size: 12.5px; color: var(--text); }
.kids__pkg-item .ic { color: var(--muted); margin-inline-end: 6px; font-size: 11px; }

/* —— نموذج بيانات الطفل —— */
.kids__form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 14px;
  margin-bottom: 18px;
}
.kids__field { display:flex; flex-direction:column; gap: 6px; }
.kids__field.span2 { grid-column: span 2; }
.kids__field label { font-weight: 700; font-size: 13px; color: var(--muted); }
.kids__field label .req { color: var(--danger); margin-inline-start: 4px; }
.kids__field input, .kids__field textarea {
  width: 100%;
  font-size: 14px;
  padding: 10px 12px;
}

/* —— ملخص الفاتورة قبل التأكيد —— */
.kids__sum {
  display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  background: rgba(34,211,238,0.06);
  border: 1px solid rgba(34,211,238,0.20);
  margin-bottom: 16px;
}
.kids__sum-row { display:flex; flex-direction:column; gap: 2px; }
.kids__sum-row .k { color: var(--muted); font-size: 12px; }
.kids__sum-row .v { color: var(--text); font-size: 1.05rem; font-weight: 800; }
.kids__sum-row .v.accent { color: var(--accent); }

/* —— تفاصيل التذكرة (مودال) —— */
.kids__detail-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap: 8px 12px; padding: 12px; background: rgba(255,255,255,0.04); border-radius: 10px; margin-bottom: 14px; font-size: 13.5px; }
.kids__detail-grid .row { display:flex; justify-content:space-between; gap:8px; }
.kids__detail-grid .row span:first-child { color: var(--muted); }
.kids__detail-grid .row b { color: var(--text); font-weight: 700; }

.kids__lines { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.kids__lines th, .kids__lines td { padding: 8px 10px; border-bottom: 1px solid var(--border); }
.kids__lines th { background: rgba(255,255,255,0.04); color: var(--muted); font-weight: 700; text-align: right; }
.kids__lines td.num { text-align: left; font-variant-numeric: tabular-nums; }
.kids__lines tr.kit-pending { background: rgba(251,191,36,0.06); }
.kids__lines tr.kit-sent    { background: rgba(52,211,153,0.06); }

.kids__notes { display:flex; flex-direction:column; gap: 6px; margin-bottom: 14px; }
.kids__note  { padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.kids__note.alert { background: rgba(251,113,133,0.12); border-inline-end: 3px solid var(--danger); }
.kids__note.note  { background: rgba(34,211,238,0.10);  border-inline-end: 3px solid var(--accent2); }
.kids__note .ts   { color: var(--muted); font-size: 11px; margin-inline-start: 8px; }

/* —— زر CTA كبير —— */
.kids__cta {
  background: linear-gradient(135deg, var(--accent), #ea580c);
  color: #0f172a; font-weight: 800;
  padding: 14px 26px; font-size: 15px;
  border-radius: 12px; border: none;
  box-shadow: 0 10px 28px rgba(249,115,22,0.30);
}
.kids__cta:disabled { opacity: 0.45; cursor: not-allowed; box-shadow:none; }

@media (max-width: 720px) {
  .kids__steps { grid-template-columns: 1fr; }
  .kids__detail-grid { grid-template-columns: 1fr; }
  .kids__field.span2 { grid-column: span 1; }
}
`;

export default function KidsAreaPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const role = user?.role || "";
  const isCashier = role === "cashier" || role === "manager" || role === "developer";
  const actor = buildMat3amActor(user);

  const [packages, setPackages] = useState<KPackage[]>([]);
  const [tickets, setTickets] = useState<KTicket[]>([]);
  const [msg, setMsg] = useState<{ type: "info" | "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [pickedPkg, setPickedPkg] = useState<string>("");
  const [childName, setChildName] = useState("");
  const [age, setAge] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [phone, setPhone] = useState("");
  const [companionsNote, setCompanionsNote] = useState("");
  const [downPaymentInput, setDownPaymentInput] = useState<string>("");

  const [openTicketId, setOpenTicketId] = useState<string>("");

  const showMsg = (type: "info" | "ok" | "err", text: string, ms = 4500) => {
    setMsg({ type, text });
    if (ms > 0) {
      window.setTimeout(() => setMsg((cur) => (cur && cur.text === text ? null : cur)), ms);
    }
  };

  const loadPackages = useCallback(async () => {
    try {
      const r = await safeFetch(`${base}/api/kids/packages?bootstrap=true`);
      if (!r.ok) {
        showMsg("err", `تعذّر تحميل الباقات (${r.status || "ش.ش"})`);
        return;
      }
      const j = await r.json();
      setPackages(Array.isArray(j?.packages) ? j.packages : []);
    } catch (e) {
      showMsg("err", `فشل قراءة الباقات: ${String((e as Error)?.message || e)}`);
    }
  }, [base]);

  const loadTickets = useCallback(async () => {
    try {
      const r = await safeFetch(`${base}/api/kids/tickets?status=active`);
      if (!r.ok) return;
      const j = await r.json();
      setTickets(Array.isArray(j?.tickets) ? j.tickets : []);
    } catch {
      /* تجاهل */
    }
  }, [base]);

  useEffect(() => {
    void loadPackages();
    void loadTickets();
  }, [loadPackages, loadTickets]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadTickets();
    }, 7000);
    return () => window.clearInterval(id);
  }, [loadTickets]);

  // مؤشر تنبيه live: نُعيد رسم العدّاد كل 30 ثانية حتى لو لم يصل polling جديد
  const [, setTickClock] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTickClock((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  const resetNewForm = () => {
    setPickedPkg("");
    setChildName("");
    setAge("");
    setFatherName("");
    setPhone("");
    setCompanionsNote("");
    setDownPaymentInput("");
  };

  const pickedPkgObj = useMemo(
    () => packages.find((p) => p.packageGuide === pickedPkg) || null,
    [packages, pickedPkg],
  );

  const stepDone1 = !!pickedPkg;
  const stepDone2 = stepDone1 && !!childName.trim() && !!phone.trim();
  const canSubmit = stepDone2 && !busy;

  const submitNewTicket = async () => {
    if (!pickedPkg) return showMsg("err", "اختر باقة أولاً");
    if (!childName.trim() || !phone.trim()) return showMsg("err", "اسم الطفل ورقم هاتف الوالد مطلوبان");
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageGuide: pickedPkg,
          childName: childName.trim(),
          fatherName: fatherName.trim(),
          phone: phone.trim(),
          age: age.trim() || null,
          companionsNote: companionsNote.trim(),
          downPayment: downPaymentInput === "" ? undefined : Number(downPaymentInput),
          mat3amActor: actor,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        showMsg("err", `تعذّر فتح التذكرة: ${t || r.status}`);
        return;
      }
      const tk = (await r.json()) as KTicket;
      showMsg("ok", `فُتحت تذكرة #${tk.invoice?.billNumber ?? "—"} للطفل ${tk.childName}`);
      resetNewForm();
      setShowNew(false);
      await loadTickets();
      setOpenTicketId(tk.id);
    } catch (e) {
      showMsg("err", `خطأ: ${String((e as Error)?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  const fireKitchen = async (t: KTicket) => {
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/tickets/${t.id}/fire-kitchen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mat3amActor: actor }),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string; fired?: number };
      if (!r.ok) return showMsg("err", j?.detail || `فشل إرسال المطبخ (${r.status})`);
      showMsg("ok", `أُرسلت ${j?.fired || 0} وجبة للمطبخ`);
      await loadTickets();
    } finally {
      setBusy(false);
    }
  };

  const settleTicket = async (t: KTicket) => {
    if (!isCashier) return;
    const baseTotal = sumLines(t.lines);
    const paid = sumPayments(t.payments);
    const ot = t.overtime;
    const otCharge = ot && ot.applicable ? Number(ot.charge || 0) : 0;
    const finalTotal = baseTotal + otCharge;
    const remaining = Math.max(0, finalTotal - paid);
    const otNote = otCharge > 0
      ? `\nسيُضاف وقت إضافي: ${fmtMinsCompact(ot!.billableMinutes)} = ${fmt(otCharge)} ج.م`
      : "";
    const input = window.prompt(
      `تسوية تذكرة ${t.childName}\nالإجمالي قبل الإضافي: ${fmt(baseTotal)}${otNote}\nالإجمالي النهائي: ${fmt(finalTotal)}\nمدفوع: ${fmt(paid)}\nالمتبقي: ${fmt(remaining)}\n\nقيمة الدفعة الأخيرة (افتراضي = المتبقي):`,
      String(remaining.toFixed(2)),
    );
    if (input === null) return;
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount < 0) return showMsg("err", "قيمة غير صالحة");
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/tickets/${t.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountPaid: amount, method: "cash", mat3amActor: actor }),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string; overtimeApplied?: { minutes: number; charge: number } };
      if (!r.ok) return showMsg("err", j?.detail || `فشل الإقفال (${r.status})`);
      const otMsg = j?.overtimeApplied
        ? ` (مع وقت إضافي ${j.overtimeApplied.minutes} د = ${fmt(j.overtimeApplied.charge)})`
        : "";
      showMsg("ok", `تم إقفال التذكرة${otMsg}`);
      await loadTickets();
      setOpenTicketId("");
    } finally {
      setBusy(false);
    }
  };

  const exemptOvertime = async (t: KTicket) => {
    if (!(role === "manager" || role === "developer")) return;
    const reason = window.prompt(`سبب إعفاء الوقت الإضافي على تذكرة ${t.childName}:`, "");
    if (reason === null) return;
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/tickets/${t.id}/exempt-overtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), mat3amActor: actor }),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string };
      if (!r.ok) return showMsg("err", j?.detail || `فشل الإعفاء (${r.status})`);
      showMsg("ok", "تم إعفاء الوقت الإضافي");
      await loadTickets();
    } finally {
      setBusy(false);
    }
  };

  const addInterimPayment = async (t: KTicket) => {
    if (!isCashier) return;
    const input = window.prompt(`دفعة جزئية على تذكرة ${t.childName} (نقدي):`, "");
    if (input === null) return;
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0) return showMsg("err", "قيمة غير صالحة");
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/tickets/${t.id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, method: "cash", mat3amActor: actor }),
      });
      if (!r.ok) {
        const t2 = await r.text();
        return showMsg("err", `تعذّرت الدفعة: ${t2 || r.status}`);
      }
      showMsg("ok", `سُجّلت دفعة ${fmt(amount)}`);
      await loadTickets();
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (t: KTicket, kind: "note" | "alert") => {
    const text = window.prompt(kind === "alert" ? "نص التنبيه:" : "نص الملاحظة:", "");
    if (!text || !text.trim()) return;
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/tickets/${t.id}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), kind, mat3amActor: actor }),
      });
      if (!r.ok) return showMsg("err", `تعذّر الحفظ (${r.status})`);
      showMsg("ok", "تم الحفظ");
      await loadTickets();
    } finally {
      setBusy(false);
    }
  };

  const addCustomLine = async (t: KTicket) => {
    if (!isCashier) return;
    const productGuide = window.prompt("ProductGuide للصنف الإضافي:", "");
    if (!productGuide || !productGuide.trim()) return;
    const qtyStr = window.prompt("الكمية:", "1");
    const qty = Number(qtyStr || 1);
    if (!Number.isFinite(qty) || qty <= 0) return showMsg("err", "كمية غير صالحة");
    setBusy(true);
    try {
      const r = await safeFetch(`${base}/api/kids/tickets/${t.id}/add-line`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productGuide: productGuide.trim(), quantity: qty, mat3amActor: actor }),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string };
      if (!r.ok) return showMsg("err", j?.detail || `تعذّرت الإضافة (${r.status})`);
      showMsg("ok", "أُضيف الصنف للفاتورة");
      await loadTickets();
    } finally {
      setBusy(false);
    }
  };

  const openTicket = useMemo(
    () => tickets.find((t) => t.id === openTicketId) || null,
    [tickets, openTicketId],
  );
  const pendingKitchenCount = (t: KTicket) =>
    (t.lines || []).filter((l) => l.isKitchen && (!l.kitchenStatus || l.kitchenStatus === "pending")).length;

  return (
    <div className="kids">
      <style>{STYLES}</style>

      <header className="kids__hdr">
        <div>
          <h2>منطقة الأطفال — التذاكر</h2>
          <p>{isCashier ? "كاشير: افتح تذاكر، سجّل الدفعات، وأقفل عند الخروج." : "خدمة الكيدز: أرسل الوجبات للمطبخ + ملاحظات/تنبيهات."}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => void loadTickets()} disabled={busy}>تحديث</button>
          {isCashier ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { resetNewForm(); setShowNew(true); }}
              disabled={busy}
            >
              + تذكرة جديدة
            </button>
          ) : null}
        </div>
      </header>

      {msg ? (
        <div role="alert" className={`kids__alert kids__alert--${msg.type}`}>{msg.text}</div>
      ) : null}

      {/* —— شبكة الشرائح —— */}
      <section className="kids__grid">
        {tickets.length === 0 ? (
          <div className="kids__empty" style={{ gridColumn: "1/-1" }}>
            لا توجد تذاكر نشطة. {isCashier ? "اضغط «+ تذكرة جديدة» لفتح أول تذكرة." : ""}
          </div>
        ) : null}

        {tickets.map((t) => {
          const total = sumLines(t.lines);
          const paid = sumPayments(t.payments);
          const remaining = Math.max(0, total - paid);
          const pendingK = pendingKitchenCount(t);
          const overdue = !!t.exitExpectedAt && new Date(t.exitExpectedAt).getTime() < Date.now();
          const cardCls = ["kids__card"];
          if (overdue) cardCls.push("is-overdue");
          if (openTicketId === t.id) cardCls.push("is-active");
          return (
            <article key={t.id} className={cardCls.join(" ")} onClick={() => setOpenTicketId(t.id)}>
              <div className="kids__card-h">
                <div>
                  <span className="name">{t.childName}</span>
                  {t.age ? <span className="age"> · {t.age} سنة</span> : null}
                </div>
                <span className="kids__bill-no">#{t.invoice?.billNumber ?? "—"}</span>
              </div>

              <div className="kids__meta">
                <span><b>الوالد:</b> {t.fatherName || "—"}</span>
                <span><b>هاتف:</b> {t.phone || "—"}</span>
              </div>

              <div className="kids__pkg-line">{t.packageName}</div>

              <div className="kids__meta">
                <span>دخول: <b>{fmtTime(t.entryAt)}</b></span>
                <span>خروج: <b>{fmtTime(t.exitExpectedAt)}</b></span>
                <span className={`kids__remain ${overdue ? "warn" : "ok"}`}>{fmtRemainingMinutes(t.exitExpectedAt)}</span>
              </div>

              <div className="kids__totals">
                <div><span>إجمالي</span><b>{fmt(total)}</b></div>
                <div><span>مدفوع</span><b className="paid">{fmt(paid)}</b></div>
                <div><span>متبقي</span><b className={remaining > 0 ? "due" : "paid"}>{fmt(remaining)}</b></div>
              </div>

              {pendingK > 0 ? (
                <span className="kids__pill kids__pill--warn">🍽 {pendingK} وجبة بانتظار الإرسال</span>
              ) : null}
              {t.overtime?.exempt ? (
                <div className="kids__ot exempt">⏱ معفى من الوقت الإضافي ✓</div>
              ) : t.overtime?.applicable ? (
                <div className="kids__ot">⏱ تجاوز <b>{fmtMinsCompact(t.overtime.billableMinutes)}</b> ⇐ سيُضاف <b>{fmt(t.overtime.charge)} ج.م</b> عند الإقفال</div>
              ) : null}
              {(t.alerts?.length || 0) > 0 ? (
                <span className="kids__pill kids__pill--alert">⚠ {t.alerts[t.alerts.length - 1].text}</span>
              ) : null}
            </article>
          );
        })}
      </section>

      {/* ============================================================
           حوار تذكرة جديدة (للكاشير فقط)
           ============================================================ */}
      {showNew && isCashier ? (
        <div className="kids__modal-bg" onClick={() => setShowNew(false)}>
          <div className="kids__modal" onClick={(e) => e.stopPropagation()}>
            <div className="kids__modal-h">
              <h3>تذكرة جديدة — Kids Area</h3>
              <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>إغلاق ✕</button>
            </div>
            <p className="kids__modal-sub">اختر باقة، ثم سجّل بيانات الطفل ووالده، ثم اضغط «فتح التذكرة».</p>

            {/* خطوات */}
            <div className="kids__steps">
              <div className={`kids__step ${stepDone1 ? "done" : "cur"}`}><b>الخطوة 1</b>اختيار الباقة {stepDone1 ? "✓" : ""}</div>
              <div className={`kids__step ${stepDone2 ? "done" : stepDone1 ? "cur" : ""}`}><b>الخطوة 2</b>بيانات الطفل {stepDone2 ? "✓" : ""}</div>
              <div className={`kids__step ${stepDone2 ? "cur" : ""}`}><b>الخطوة 3</b>تأكيد وفتح</div>
            </div>

            {/* —— شبكة الباقات —— */}
            <h4 style={{ margin: "0 0 8px", fontSize: 14, color: "var(--muted)" }}>الباقات المتاحة</h4>
            <div className="kids__pkgs">
              {packages.length === 0 ? (
                <div className="kids__empty" style={{ gridColumn: "1/-1" }}>
                  لا توجد باقات بعد — حاول إعادة التحميل (الباقة الافتراضية تُهيّأ تلقائياً).
                </div>
              ) : null}
              {packages.map((p) => {
                const active = pickedPkg === p.packageGuide;
                const noPrice = (p.totalPrice || 0) <= 0;
                return (
                  <button
                    key={p.packageGuide}
                    type="button"
                    onClick={() => setPickedPkg(p.packageGuide)}
                    className={`kids__pkg ${active ? "active" : ""}`}
                  >
                    <div>
                      <div className="kids__pkg-name">{p.packageName || p.latinName}</div>
                      {p.latinName ? <div className="kids__pkg-latin">{p.latinName}</div> : null}
                    </div>
                    <div className="kids__pkg-row">
                      <span className="kids__pkg-price">
                        {noPrice ? "—" : `${fmt(p.totalPrice)} ج.م`}
                      </span>
                      <span className="kids__pkg-dur">{fmtDuration(p.durationMinutes)}</span>
                    </div>
                    {noPrice ? (
                      <div className="kids__pill kids__pill--warn" style={{ alignSelf: "flex-start" }}>
                        لم تُسعَّر بعد — راجع TBL007.AgentPrice
                      </div>
                    ) : null}
                    <div className="kids__pkg-items">
                      {p.items.map((it) => (
                        <div key={it.productGuide} className="kids__pkg-item">
                          <span>
                            <span className="ic">{it.isKitchen ? "🍽" : "🕒"}</span>
                            {it.name}
                          </span>
                          <span>{fmt(it.price)}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* —— حقول بيانات الطفل —— */}
            <h4 style={{ margin: "8px 0", fontSize: 14, color: "var(--muted)" }}>بيانات الطفل / الوالد</h4>
            <div className="kids__form">
              <div className="kids__field">
                <label htmlFor="kid-name">اسم الطفل <span className="req">*</span></label>
                <input id="kid-name" value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="مثال: يوسف" />
              </div>
              <div className="kids__field">
                <label htmlFor="kid-age">العمر</label>
                <input id="kid-age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ""))} placeholder="بالسنوات" />
              </div>
              <div className="kids__field">
                <label htmlFor="kid-father">اسم الوالد</label>
                <input id="kid-father" value={fatherName} onChange={(e) => setFatherName(e.target.value)} placeholder="مثال: أحمد" />
              </div>
              <div className="kids__field">
                <label htmlFor="kid-phone">هاتف الوالد <span className="req">*</span></label>
                <input id="kid-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
              </div>
              <div className="kids__field span2">
                <label htmlFor="kid-notes">ملاحظات (مرافقون / حساسية / مخاوف…)</label>
                <input id="kid-notes" value={companionsNote} onChange={(e) => setCompanionsNote(e.target.value)} />
              </div>
              <div className="kids__field">
                <label htmlFor="kid-down">دفعة الحجز</label>
                <input
                  id="kid-down"
                  inputMode="decimal"
                  value={downPaymentInput}
                  onChange={(e) => setDownPaymentInput(e.target.value)}
                  placeholder={pickedPkgObj ? `افتراضي: ${fmt(pickedPkgObj.totalPrice)}` : "اختر باقة"}
                />
              </div>
            </div>

            {/* —— ملخص ما قبل التأكيد —— */}
            {pickedPkgObj ? (
              <div className="kids__sum">
                <div className="kids__sum-row"><span className="k">الباقة</span><span className="v accent">{pickedPkgObj.packageName}</span></div>
                <div className="kids__sum-row"><span className="k">المدة</span><span className="v">{fmtDuration(pickedPkgObj.durationMinutes)}</span></div>
                <div className="kids__sum-row"><span className="k">الإجمالي</span><span className="v">{fmt(pickedPkgObj.totalPrice)} ج.م</span></div>
                <div className="kids__sum-row">
                  <span className="k">دفعة الحجز</span>
                  <span className="v">{fmt(downPaymentInput === "" ? pickedPkgObj.totalPrice : Number(downPaymentInput) || 0)} ج.م</span>
                </div>
                <div className="kids__sum-row"><span className="k">الطفل</span><span className="v">{childName.trim() || "—"}{age ? ` (${age}س)` : ""}</span></div>
                <div className="kids__sum-row"><span className="k">هاتف الوالد</span><span className="v">{phone.trim() || "—"}</span></div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)} disabled={busy}>إلغاء</button>
              <button type="button" className="kids__cta" onClick={() => void submitNewTicket()} disabled={!canSubmit}>
                {busy ? "جارٍ الفتح…" : "فتح التذكرة"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ============================================================
           تفاصيل تذكرة (مودال)
           ============================================================ */}
      {openTicket ? (
        <div className="kids__modal-bg" onClick={() => setOpenTicketId("")}>
          <div className="kids__modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(800px, 100%)" }}>
            <div className="kids__modal-h">
              <h3>تذكرة #{openTicket.invoice?.billNumber ?? "—"} — {openTicket.childName}</h3>
              <button type="button" className="btn btn-ghost" onClick={() => setOpenTicketId("")}>إغلاق ✕</button>
            </div>

            <div className="kids__detail-grid">
              <div className="row"><span>الوالد</span><b>{openTicket.fatherName || "—"}</b></div>
              <div className="row"><span>الهاتف</span><b>{openTicket.phone || "—"}</b></div>
              <div className="row"><span>الباقة</span><b>{openTicket.packageName}</b></div>
              <div className="row"><span>المدة</span><b>{fmtDuration(openTicket.packageMinutes)}</b></div>
              <div className="row"><span>الدخول</span><b>{fmtTime(openTicket.entryAt)}</b></div>
              <div className="row"><span>الخروج المتوقّع</span><b>{fmtTime(openTicket.exitExpectedAt)} ({fmtRemainingMinutes(openTicket.exitExpectedAt)})</b></div>
            </div>

            <h4 style={{ margin: "0 0 8px", fontSize: 14, color: "var(--muted)" }}>بنود الفاتورة</h4>
            <table className="kids__lines">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th style={{ textAlign: "center" }}>كمية</th>
                  <th style={{ textAlign: "left" }}>السعر</th>
                  <th style={{ textAlign: "left" }}>الإجمالي</th>
                  <th style={{ textAlign: "center" }}>المطبخ</th>
                </tr>
              </thead>
              <tbody>
                {openTicket.lines.map((l) => (
                  <tr
                    key={l.lineId}
                    className={l.isKitchen ? (l.kitchenStatus === "sent" ? "kit-sent" : "kit-pending") : ""}
                  >
                    <td>{l.name}{l.fromPackage ? "" : " (إضافة)"}</td>
                    <td className="num" style={{ textAlign: "center" }}>{l.quantity}</td>
                    <td className="num">{fmt(l.unitPrice)}</td>
                    <td className="num">{fmt(l.unitPrice * l.quantity)}</td>
                    <td className="num" style={{ textAlign: "center" }}>
                      {l.isKitchen
                        ? (l.kitchenStatus === "sent"
                          ? <span className="kids__pill kids__pill--ok">أُرسلت {fmtTime(l.kitchenSentAt)}</span>
                          : <span className="kids__pill kids__pill--warn">معلّق</span>)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(() => {
              const baseT = sumLines(openTicket.lines);
              const ot = openTicket.overtime;
              const otCharge = ot && ot.applicable ? Number(ot.charge || 0) : 0;
              const finalT = baseT + otCharge;
              const paidT = sumPayments(openTicket.payments);
              const remT = Math.max(0, finalT - paidT);
              return (
                <>
                  {ot?.exempt ? (
                    <div className="kids__ot exempt" style={{ marginTop: 12 }}>
                      ⏱ معفى من الوقت الإضافي ✓
                    </div>
                  ) : openTicket.overtimeAppliedAt ? (
                    <div className="kids__ot applied" style={{ marginTop: 12 }}>
                      ⏱ أُضيف للفاتورة: <b>{fmtMinsCompact(openTicket.overtimeMinutesApplied || 0)}</b> = <b>{fmt(openTicket.overtimeChargeApplied || 0)} ج.م</b>
                    </div>
                  ) : ot?.applicable ? (
                    <div className="kids__ot" style={{ marginTop: 12 }}>
                      ⏱ تجاوز خام <b>{fmtMinsCompact(ot.rawMinutes)}</b> · مهلة 5 د · يُحاسَب <b>{fmtMinsCompact(ot.billableMinutes)}</b> × {ot.ratePerMinute.toFixed(3)} ج.م/د = <b>{fmt(ot.charge)} ج.م</b>
                    </div>
                  ) : null}
                  <div className="kids__totals" style={{ marginTop: 10, gridTemplateColumns: "repeat(4, 1fr)" }}>
                    <div><span>قبل الإضافي</span><b>{fmt(baseT)}</b></div>
                    <div><span>وقت إضافي</span><b style={{ color: otCharge > 0 ? "var(--accent)" : "var(--muted)" }}>{fmt(otCharge)}</b></div>
                    <div><span>مدفوع</span><b className="paid">{fmt(paidT)}</b></div>
                    <div><span>متبقي</span><b className="due">{fmt(remT)}</b></div>
                  </div>
                </>
              );
            })()}

            {((openTicket.notes?.length || 0) + (openTicket.alerts?.length || 0)) > 0 ? (
              <>
                <h4 style={{ margin: "16px 0 6px", fontSize: 14, color: "var(--muted)" }}>ملاحظات وتنبيهات</h4>
                <div className="kids__notes">
                  {openTicket.alerts.map((a) => (
                    <div key={a.id} className="kids__note alert">⚠ {a.text} <span className="ts">{fmtTime(a.at)}</span></div>
                  ))}
                  {openTicket.notes.map((n) => (
                    <div key={n.id} className="kids__note note">{n.text} <span className="ts">{fmtTime(n.at)}</span></div>
                  ))}
                </div>
              </>
            ) : null}

            <div className="kids__btn-row" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-ghost" onClick={() => void addNote(openTicket, "note")} disabled={busy}>+ ملاحظة</button>
              <button type="button" className="btn btn-ghost" onClick={() => void addNote(openTicket, "alert")} disabled={busy}>+ تنبيه</button>
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => void fireKitchen(openTicket)}
                disabled={busy || pendingKitchenCount(openTicket) === 0}
              >
                🍽 اطلب الوجبة الآن ({pendingKitchenCount(openTicket)})
              </button>
              {(role === "manager" || role === "developer") && openTicket.overtime?.applicable ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void exemptOvertime(openTicket)}
                  disabled={busy}
                  title="إعفاء التذكرة من الوقت الإضافي عند الإقفال"
                >
                  ✓ إعفاء الوقت الإضافي
                </button>
              ) : null}
              {isCashier ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => void addCustomLine(openTicket)} disabled={busy}>+ بند إضافي</button>
                  <button type="button" className="btn btn-ghost" onClick={() => void addInterimPayment(openTicket)} disabled={busy}>دفعة جزئية</button>
                  <button type="button" className="btn btn-success" onClick={() => void settleTicket(openTicket)} disabled={busy}>تسوية وإقفال</button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
