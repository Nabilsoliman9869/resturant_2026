import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { useAuth } from "../auth/AuthContext";
import { buildMat3amActor } from "../lib/mat3amActor";

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** إزالة GUIDs من ملاحظات الفاتورة في نسخة العميل */
function sanitizeCustomerNote(s: string): string {
  let t = String(s || "").replace(/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,36}/g, " ");
  t = t.replace(/\s{2,}/g, " ").replace(/مطعم\s*-\s*جلسة\s*$/i, "").trim();
  return t;
}

export type CashierInvoiceLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  seatNo?: number | null;
};

type CashierInvoiceSourceLine = CashierInvoiceLine & {
  orderId?: string;
  lineId?: string;
  productGuide?: string;
};

export type CashierInvoiceRow = {
  sessionId?: string;
  invoiceId?: string;
  total?: number;
  paidAt?: string | null;
  requestedAt?: string;
  awaitingPayment?: boolean;
  paymentMethod?: string;
  splitName?: string | null;
  billNumber?: number;
  subtotal?: number;
  tax?: number;
  serviceCharge?: number;
  discount?: number;
  tipAmount?: number;
  lines?: CashierInvoiceLine[];
  sourceLines?: CashierInvoiceSourceLine[];
  billingProfile?: {
    active?: boolean;
    noService?: boolean;
    noVat?: boolean;
    discountPct?: number;
    source?: string;
  } | null;
  /** من السيرفر: تسمية الطاولة للعرض (مثل «طاولة 5») */
  tableLabel?: string;
  tableNumber?: number;
  tableName?: string | null;
  tableIdResolved?: string;
  /** من جلسة الطاولة — اقتراح لعدد الأفراد في السبليت */
  sessionGuestCount?: number;
  printCount?: number;
  firstPrintedAt?: string | null;
  firstPrintedByRole?: string | null;
  firstPrintedByName?: string | null;
  lastPrintedAt?: string | null;
  lastPrintedByRole?: string | null;
  lastPrintedByName?: string | null;
  /** اسم العميل المربوط بالفاتورة (مالك / VIP / عميل آجل) */
  agentName?: string | null;
  agentGuid?: string | null;
  paymentStatus?: string | null;
  onAccountAt?: string | null;
};

type CashierPricingSnapshot = {
  ok?: boolean;
  policy?: {
    servicePercent: number;
    vatPercent: number;
    applyDiscountBeforeTax: boolean;
    serviceBeforeVat: boolean;
  };
  tbl007Service?: { matched?: boolean; percent?: number | null; productName?: string | null };
  effectiveServicePercent?: number;
};

type SqlInvoicePayload = {
  BillNumber?: number;
  BillDate?: string;
  AgentName?: string;
  Notes?: string;
  Discount?: number;
  TaxValue?: number;
  LocalAdministrativeTax?: number;
  Items?: Array<{
    ProductName?: string;
    Quantity?: number;
    UnitPrice?: number;
    TotalValue?: number;
  }>;
};

function seatLabel(seatNo?: number | null): string {
  return seatNo != null && Number(seatNo) >= 1 ? `كرسي ${seatNo}` : "بدون كرسي";
}

function parseMoneyInput(s: string): number {
  const t = String(s || "").trim().replace(",", ".");
  if (!t) return 0;
  const n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BILLING_MODE_LABEL: Record<"full_table" | "split_equal" | "split_by_order", string> = {
  full_table: "حساب الطاولة كاملة",
  split_equal: "سبليت بالتساوي",
  split_by_order: "سبليت حسب الطلب / الكرسي",
};

function printHtmlInIframe(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "print");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument;
  if (!idoc) {
    document.body.removeChild(iframe);
    return;
  }
  idoc.open();
  idoc.write(html);
  idoc.close();
  window.setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {
          /* ignore */
        }
      }, 600);
    }
  }, 150);
}

type ThermalReceiptInput = {
  billNo: string;
  billDate: string;
  agentName: string;
  invoiceGuid: string;
  /** تسمية الطاولة للإيصال — لا يُعرض معرّف الجلسة كـ«جلسة» بالخطأ */
  tableLabel?: string | null;
  sessionId?: string | null;
  /** إيصال للعميل: بدون GUID ولا معرفات تقنية */
  customerReceipt?: boolean;
  requestedAt: string;
  lines: CashierInvoiceLine[];
  ledger: {
    linesSum: number;
    discount: number;
    service: number;
    tax: number;
    mode: string;
    vatPct: number;
    serviceLabel: string;
  };
  totalDue: number;
  lockedFromSource: boolean;
  tableTipAdditive: number;
  extraTip: number;
  billingMode: "full_table" | "split_equal" | "split_by_order";
  cash: number;
  visa: number;
  wallet: number;
  instapay: number;
  notes: string;
  splitEqualPersons?: number;
  perPersonShare?: number | null;
  lineSplitSectionHtml?: string;
  seatSectionHtml?: string;
};

function buildThermalReceiptHtml(p: ThermalReceiptInput): string {
  const forCustomer = p.customerReceipt !== false;
  const seatSectionHtml = p.seatSectionHtml || "";
  const lineRows = p.lines
    .map(
      (ln) =>
        `<tr><td colspan="2">${escapeHtml(ln.name)}</td></tr><tr><td>${ln.quantity % 1 === 0 ? String(ln.quantity) : ln.quantity.toFixed(2)}×${ln.unitPrice.toFixed(2)}</td><td style="text-align:left">${ln.lineTotal.toFixed(2)}</td></tr>`,
    )
    .join("");
  const tipBlock =
    !p.lockedFromSource && (p.tableTipAdditive > 0.001 || p.extraTip > 0.001)
      ? `${p.tableTipAdditive > 0.001 ? `<tr><td>تيبس (طاولة)</td><td>${p.tableTipAdditive.toFixed(2)}</td></tr>` : ""}${p.extraTip > 0.001 ? `<tr><td>تيبس إضافي</td><td>${p.extraTip.toFixed(2)}</td></tr>` : ""}`
      : "";
  const payRows =
    p.cash + p.visa + p.wallet + p.instapay > 0.001
      ? `<tr><td>نقدي</td><td>${p.cash.toFixed(2)}</td></tr><tr><td>فيزا</td><td>${p.visa.toFixed(2)}</td></tr><tr><td>محفظة</td><td>${p.wallet.toFixed(2)}</td></tr><tr><td>انستاباي</td><td>${p.instapay.toFixed(2)}</td></tr>`
      : `<tr><td colspan="2" class="muted">لم يُحدَّد الدفع بعد</td></tr>`;
  const tableLine = p.tableLabel
    ? `<div class="c b tbl">الطاولة: ${escapeHtml(p.tableLabel)}</div>`
    : "";
  const billLine =
    p.billNo && p.billNo !== "—"
      ? `<div class="c b billno">رقم الفاتورة: ${escapeHtml(p.billNo)}</div>`
      : "";
  const sessTech =
    forCustomer || !p.sessionId || String(p.sessionId) === String(p.invoiceGuid)
      ? ""
      : `<div class="guid" style="margin-top:4px">معرّف الجلسة (تقني):<br/>${escapeHtml(p.sessionId)}</div>`;
  const guidBlock = forCustomer
    ? ""
    : `<div class="guid">مرجع تقني (CardGuide):<br/>${escapeHtml(p.invoiceGuid)}</div>`;
  const showSplit =
    p.billingMode === "split_equal" &&
    p.splitEqualPersons != null &&
    p.splitEqualPersons >= 1 &&
    p.perPersonShare != null;
  const splitShareValue = showSplit ? Number(p.perPersonShare ?? 0) : 0;
  /** يظهر في أعلى الإيصال حتى تُرى المعاينة دون تمرير طويل */
  const splitTopBanner = showSplit
    ? `<div class="split-top" dir="rtl">
  <span class="split-top-lab">نصيب الفرد (سبليت بالتساوي)</span>
  <span class="split-top-val">${splitShareValue.toFixed(2)} <small>ج.م</small></span>
  <span class="split-top-sub">÷ ${p.splitEqualPersons} أشخاص</span>
</div>`
    : p.billingMode === "split_equal" && !showSplit
      ? `<div class="split-top split-top-warn" dir="rtl">أدخل <strong>عدد الأشخاص</strong> أعلاه ليظهر نصيب الفرد هنا وفي المذيّل.</div>`
      : "";
  const splitBlock = showSplit
    ? `<div class="splitbox">
  <div class="split-title">نصيب كل شخص (تقسيم بالتساوي)</div>
  <div class="split-amt">${splitShareValue.toFixed(2)} <span class="cur">ج.م</span></div>
  <div class="split-sub">الإجمالي مقسوم على ${p.splitEqualPersons} أشخاص — كل عميل يدفع تقريباً هذا المبلغ</div>
  ${p.lineSplitSectionHtml || ""}
</div>`
    : "";
  const notesForPrint = forCustomer ? sanitizeCustomerNote(p.notes) : p.notes;
  const notesBlock = notesForPrint
    ? `<div class="muted" style="margin-top:6px">${escapeHtml(notesForPrint)}</div>`
    : "";
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>إيصال</title>
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    * { box-sizing: border-box; }
    body {
      width: 72mm;
      max-width: 72mm;
      margin: 0 auto;
      padding: 3mm 2mm;
      font-family: Tahoma, "Segoe UI", Arial, sans-serif;
      font-size: 10px;
      line-height: 1.35;
      color: #111;
    }
    .c { text-align: center; }
    .b { font-weight: 700; }
    .hr { border: 0; border-top: 1px dashed #222; margin: 6px 0; }
    .items { width: 100%; border-collapse: collapse; font-size: 9.5px; }
    .items td { padding: 1px 0; word-break: break-word; }
    .tot { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }
    .tot td { padding: 2px 0; }
    .tot td:last-child { text-align: left; font-variant-numeric: tabular-nums; }
    .pay { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-top: 4px; }
    .pay td { padding: 2px 0; }
    .pay td:last-child { text-align: left; font-variant-numeric: tabular-nums; }
    .muted { color: #555; font-size: 9px; }
    .grand { font-size: 12px; font-weight: 800; margin: 8px 0; text-align: center; }
    .guid { font-size: 8px; word-break: break-all; color: #333; margin: 4px 0; }
    .mode { font-size: 9px; margin-top: 6px; padding-top: 4px; border-top: 1px dotted #999; }
    .tbl { font-size: 11px; margin-top: 6px; }
    .billno { font-size: 11px; margin-top: 4px; }
    .splitbox {
      border: 2px solid #111;
      border-radius: 6px;
      padding: 8px 6px;
      margin: 10px 0;
      text-align: center;
      background: #fafafa;
    }
    .split-title { font-size: 10px; font-weight: 700; margin-bottom: 4px; }
    .split-amt { font-size: 18px; font-weight: 900; letter-spacing: 0.02em; }
    .split-amt .cur { font-size: 11px; font-weight: 700; }
    .split-sub { font-size: 8.5px; color: #444; margin-top: 6px; line-height: 1.35; }
    .split-top {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px 10px;
      background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
      border: 2px solid #059669; border-radius: 8px; padding: 8px 6px; margin: 8px 0 10px;
      font-size: 11px; line-height: 1.3;
    }
    .split-top-lab { font-weight: 800; color: #065f46; }
    .split-top-val { font-size: 17px; font-weight: 900; color: #111; font-variant-numeric: tabular-nums; }
    .split-top-val small { font-size: 10px; font-weight: 700; }
    .split-top-sub { font-size: 10px; color: #047857; font-weight: 600; }
    .split-top-warn { background: #fffbeb; border-color: #f59e0b; color: #92400e; font-size: 10px; padding: 7px; }
    .seat-section {
      border: 1px solid #222;
      border-radius: 6px;
      padding: 6px 5px;
      margin: 8px 0;
      background: #fff;
    }
    .seat-section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      border-bottom: 1px dashed #666;
      padding-bottom: 4px;
      margin-bottom: 4px;
      font-size: 10px;
      font-weight: 800;
      color: #111;
    }
    .noprint { font-size: 8px; color: #666; margin-bottom: 6px; }
    @media print { .noprint { display: none !important; } }
  </style>
</head>
<body>
  <div class="noprint">للطباعة أو حفظ PDF: اضغط Ctrl+P واختر الطابعة أو «Microsoft Print to PDF».</div>
  <div class="c b" style="font-size:11px">فاتورة — نسخة عميل</div>
  ${billLine}
  <div class="c muted">${escapeHtml(p.billDate)}${p.agentName && p.agentName !== "—" ? ` · ${escapeHtml(p.agentName)}` : ""}</div>
  ${tableLine}
  ${splitTopBanner}
  ${guidBlock}
  ${sessTech}
  <div class="muted">طلب الحساب: ${escapeHtml(p.requestedAt)}</div>
  <hr class="hr"/>
  ${seatSectionHtml || `<table class="items">${lineRows || `<tr><td colspan="2" class="muted">لا بنود</td></tr>`}</table>`}
  <hr class="hr"/>
  <table class="tot">
    <tr><td>مجموع الأصناف</td><td>${p.ledger.linesSum.toFixed(2)}</td></tr>
    ${p.ledger.discount > 0.001 ? `<tr><td>الخصم</td><td>${p.ledger.discount.toFixed(2)}</td></tr>` : ""}
    <tr><td>${escapeHtml(p.ledger.serviceLabel)}</td><td>${p.ledger.service.toFixed(2)}</td></tr>
    <tr><td>الضريبة${p.ledger.mode === "recalc" ? ` (${p.ledger.vatPct}%)` : ""}</td><td>${p.ledger.tax.toFixed(2)}</td></tr>
    ${tipBlock}
  </table>
  <div class="grand">إجمالي الطاولة: ${p.totalDue.toFixed(2)} ج.م</div>
  ${splitBlock}
  <div class="mode"><span class="b">نوع الحساب:</span> ${escapeHtml(BILLING_MODE_LABEL[p.billingMode])}</div>
  <div class="b" style="margin-top:6px;font-size:10px">توزيع الدفع</div>
  <table class="pay">${payRows}</table>
  ${notesBlock}
  <hr class="hr"/>
  <div class="c muted" style="font-size:8px">شكراً لزيارتكم</div>
</body>
</html>`;
}

function aggregateFromParts(
  parts: Array<{ name?: string; quantity?: number; unitPrice?: number; lineTotal?: number; seatNo?: number | null }>,
): CashierInvoiceLine[] {
  const m = new Map<string, CashierInvoiceLine>();
  for (const p of parts) {
    const name = String(p.name || "صنف").trim() || "صنف";
    const unitPrice = typeof p.unitPrice === "number" ? p.unitPrice : parseFloat(String(p.unitPrice)) || 0;
    const qty = typeof p.quantity === "number" ? p.quantity : parseFloat(String(p.quantity)) || 0;
    const seatNo = p.seatNo != null && Number.isFinite(Number(p.seatNo)) && Number(p.seatNo) >= 1 ? Number(p.seatNo) : null;
    const lineTotal =
      typeof p.lineTotal === "number"
        ? p.lineTotal
        : round2(qty * (typeof p.unitPrice === "number" ? p.unitPrice : unitPrice));
    const key = `${name.toLowerCase()}\0${unitPrice.toFixed(6)}\0${seatNo ?? "none"}`;
    const ex = m.get(key);
    if (ex) {
      ex.quantity = round2(ex.quantity + qty);
      ex.lineTotal = round2(ex.lineTotal + lineTotal);
    } else {
      m.set(key, { name, quantity: round2(qty), unitPrice: round2(unitPrice), lineTotal: round2(lineTotal), seatNo });
    }
  }
  return [...m.values()];
}

function computeCashierLedger(
  lockedFromSource: boolean,
  linesSum: number,
  headerDiscount: number,
  headerTax: number,
  headerService: number,
  storedTotal: number | undefined,
  cashierDiscount: number,
  applyServiceCharge: boolean,
  applyVatCharge: boolean,
  snap: CashierPricingSnapshot | null,
): {
  linesSum: number;
  discount: number;
  service: number;
  tax: number;
  grand: number;
  mode: "header" | "recalc";
  svcPct: number;
  vatPct: number;
  serviceLabel: string;
} {
  if (lockedFromSource) {
    const gd =
      typeof storedTotal === "number" && Number.isFinite(storedTotal)
        ? storedTotal
        : round2(linesSum - headerDiscount + headerTax + headerService);
    return {
      linesSum,
      discount: round2(headerDiscount),
      service: round2(headerService),
      tax: round2(headerTax),
      grand: round2(gd),
      mode: "header",
      svcPct: 0,
      vatPct: 0,
      serviceLabel: "رسوم الخدمة (كما في الفاتورة المحفوظة)",
    };
  }
  const pol = snap?.policy;
  const svcPct = snap?.effectiveServicePercent ?? pol?.servicePercent ?? 12;
  const vatPct = pol?.vatPercent ?? 14;
  const applyDiscBefore = pol?.applyDiscountBeforeTax ?? true;
  const svcBeforeVat = pol?.serviceBeforeVat ?? true;
  const disc = Math.max(0, round2(cashierDiscount));
  const gross = round2(linesSum);
  const netSub = Math.max(0, round2(gross - disc));
  const baseSvc = applyDiscBefore ? netSub : gross;
  const service = applyServiceCharge && svcPct > 0 ? round2((baseSvc * svcPct) / 100) : 0;
  const tax =
    applyVatCharge && vatPct > 0
      ? svcBeforeVat
        ? round2(((netSub + service) * vatPct) / 100)
        : round2((netSub * vatPct) / 100)
      : 0;
  const grand = round2(netSub + service + tax);
  const tbl = snap?.tbl007Service;
  const serviceLabel =
    tbl?.matched && tbl.productName
      ? `رسوم الخدمة (${svcPct}% — ${tbl.productName})`
      : `رسوم الخدمة (${svcPct}% — وفق سياسة المنشأة)`;
  return { linesSum: gross, discount: disc, service, tax, grand, mode: "recalc", svcPct, vatPct, serviceLabel };
}

function aggregateFromSqlItems(items: SqlInvoicePayload["Items"]): CashierInvoiceLine[] {
  const parts =
    (items || []).map((it) => ({
      name: it.ProductName,
      quantity: it.Quantity,
      unitPrice: it.UnitPrice,
      lineTotal: typeof it.TotalValue === "number" ? it.TotalValue : undefined,
      seatNo: null,
    })) || [];
  return aggregateFromParts(parts);
}

function groupLinesBySeat(lines: CashierInvoiceLine[]): Array<{ label: string; seatNo: number | null; lines: CashierInvoiceLine[]; total: number }> {
  const map = new Map<string, { label: string; seatNo: number | null; lines: CashierInvoiceLine[]; total: number }>();
  for (const ln of lines) {
    const seatNo = ln.seatNo != null && Number(ln.seatNo) >= 1 ? Number(ln.seatNo) : null;
    const key = seatNo != null ? `seat:${seatNo}` : "seat:none";
    const bucket = map.get(key) || { label: seatLabel(seatNo), seatNo, lines: [], total: 0 };
    bucket.lines.push(ln);
    bucket.total += Number(ln.lineTotal || 0);
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => {
    const aa = a.seatNo == null ? Number.MAX_SAFE_INTEGER : a.seatNo;
    const bb = b.seatNo == null ? Number.MAX_SAFE_INTEGER : b.seatNo;
    return aa - bb;
  });
}

function buildSeatSectionsHtml(lines: CashierInvoiceLine[]): string {
  const sections = groupLinesBySeat(lines).filter((section) => section.lines.length > 0 && section.lines.some((ln) => ln.seatNo != null && Number(ln.seatNo) >= 1));
  if (sections.length === 0) return "";
  return sections
    .map((section) => {
      const rows = section.lines
        .map(
          (ln) =>
            `<tr><td colspan="2">${escapeHtml(ln.name)}</td></tr><tr><td>${ln.quantity % 1 === 0 ? String(ln.quantity) : ln.quantity.toFixed(2)}×${ln.unitPrice.toFixed(2)}</td><td style="text-align:left">${ln.lineTotal.toFixed(2)}</td></tr>`,
        )
        .join("");
      return `<div class="seat-section"><div class="seat-section-head"><span>${escapeHtml(section.label)}</span><strong>${section.total.toFixed(2)} ج.م</strong></div><table class="items">${rows}</table></div>`;
    })
    .join("");
}

export function CashierPayInvoiceModal({
  open,
  invoiceId,
  initialRow,
  onClose,
  onPaid,
  onChanged,
  allowPayment = true,
  dialogTitle,
  printerHint,
  autoPrintOnOpen = false,
}: {
  open: boolean;
  invoiceId: string | null;
  initialRow?: CashierInvoiceRow | null;
  onClose: () => void;
  onPaid: () => void;
  onChanged?: () => void;
  allowPayment?: boolean;
  dialogTitle?: string;
  printerHint?: string;
  autoPrintOnOpen?: boolean;
}) {
  const base = getApiBase();
  const { user } = useAuth();
  const [row, setRow] = useState<CashierInvoiceRow | null>(null);
  const [lines, setLines] = useState<CashierInvoiceLine[]>([]);
  const [billNumber, setBillNumber] = useState<number | undefined>(undefined);
  const [billDate, setBillDate] = useState<string>("");
  const [agentName, setAgentName] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  /** من رأس الفاتورة (SQL أو JSON) — عند وجود ضريبة/خدمة > 0 نعتمدها ولا نعيد الحساب */
  const [headerDiscount, setHeaderDiscount] = useState(0);
  const [headerTax, setHeaderTax] = useState(0);
  const [headerService, setHeaderService] = useState(0);
  const [lockedFromSource, setLockedFromSource] = useState(false);
  const [detailHint, setDetailHint] = useState<string>("");
  const [discountInput, setDiscountInput] = useState("");
  const [applyServiceCharge, setApplyServiceCharge] = useState(true);
  const [applyVatCharge, setApplyVatCharge] = useState(true);
  const [tipInput, setTipInput] = useState("");
  const [billingMode, setBillingMode] = useState<"full_table" | "split_equal" | "split_by_order">("full_table");
  const [splitGuestsInput, setSplitGuestsInput] = useState("");
  const [splitShareLocked, setSplitShareLocked] = useState(false);
  const [pricingSnapshot, setPricingSnapshot] = useState<CashierPricingSnapshot | null>(null);
  const [cash, setCash] = useState("");
  const [visa, setVisa] = useState("");
  const [wallet, setWallet] = useState("");
  const [instapay, setInstapay] = useState("");
  const [closeSession, setCloseSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [onAccount, setOnAccount] = useState(false);
  const [onAccountBusy, setOnAccountBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [msg, setMsg] = useState("");
  const autoPrintedRef = useRef(false);

  useEffect(() => {
    if (!open || !invoiceId) return;
    setTipInput("");
    setBillingMode("full_table");
    setSplitGuestsInput("");
    setSplitShareLocked(false);
    autoPrintedRef.current = false;
  }, [open, invoiceId]);

  useEffect(() => {
    if (!row) return;
    const g = row.sessionGuestCount;
    if (typeof g === "number" && Number.isFinite(g) && g >= 1) {
      setSplitGuestsInput(String(Math.floor(g)));
    }
  }, [row?.invoiceId, row?.sessionGuestCount]);

  useEffect(() => {
    if (billingMode !== "split_equal") setSplitShareLocked(false);
  }, [billingMode]);

  const loadLocal = useCallback(async () => {
    const id = String(invoiceId || "").trim();
    if (!id) return;
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/invoices-local/by-id/${encodeURIComponent(id)}`);
      const txt = await r.text();
      const j = tryParseJson<CashierInvoiceRow & { detail?: unknown }>(txt) ?? {};
      if (!r.ok) {
        const d = j.detail;
        throw new Error(typeof d === "string" ? d : "تعذر تحميل الفاتورة");
      }
      setRow(j as CashierInvoiceRow);
    } catch (e) {
      setMsg(String(e));
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [base, invoiceId]);

  useEffect(() => {
    if (!open || !invoiceId) {
      setRow(null);
      setLines([]);
      setBillNumber(undefined);
      setBillDate("");
      setAgentName("");
      setNotes("");
      setHeaderDiscount(0);
      setHeaderTax(0);
      setHeaderService(0);
      setLockedFromSource(false);
      setDetailHint("");
      setDiscountInput("");
      setApplyServiceCharge(true);
      setApplyVatCharge(true);
      setPricingSnapshot(null);
      setCash("");
      setVisa("");
      setWallet("");
      setInstapay("");
      setCloseSession(true);
      setOnAccount(false);
      setMsg("");
      return;
    }
    if (initialRow && String(initialRow.invoiceId || "") === invoiceId) {
      setRow(initialRow);
      const bp = initialRow.billingProfile;
      if (bp && typeof bp === "object" && bp.active !== false) {
        if (bp.noService === true) setApplyServiceCharge(false);
        if (bp.noVat === true) setApplyVatCharge(false);
      }
    } else {
      setRow(null);
    }
    void loadLocal();
  }, [open, invoiceId, initialRow, loadLocal]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`${base}/api/restaurant/pricing/cashier-snapshot`);
        const j = (await r.json()) as CashierPricingSnapshot;
        if (!cancelled) setPricingSnapshot(j);
      } catch {
        if (!cancelled)
          setPricingSnapshot({
            policy: { servicePercent: 12, vatPercent: 14, applyDiscountBeforeTax: true, serviceBeforeVat: true },
            effectiveServicePercent: 12,
            tbl007Service: { matched: false },
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, base]);

  useEffect(() => {
    if (!open || !invoiceId || !row) return;
    const invRow = row;
    let cancelled = false;
    const id = String(invoiceId).trim();
    const invUpper = id.toUpperCase();

    async function enrich() {
      setDetailLoading(true);
      setDetailHint("");
      try {
        const localLines = Array.isArray(invRow.lines) ? invRow.lines : [];
        const sourceLines = Array.isArray(invRow.sourceLines) ? invRow.sourceLines : [];
        if (localLines.length > 0 || sourceLines.length > 0) {
          if (cancelled) return;
          const preferredLines =
            sourceLines.length > 0
              ? aggregateFromParts(
                  sourceLines.map((ln) => ({
                    name: ln.name,
                    quantity: ln.quantity,
                    unitPrice: ln.unitPrice,
                    lineTotal: ln.lineTotal,
                    seatNo: ln.seatNo,
                  })),
                )
              : (localLines as CashierInvoiceLine[]);
          setLines(preferredLines);
          setBillNumber(typeof invRow.billNumber === "number" ? invRow.billNumber : undefined);
          setBillDate("");
          setAgentName("");
          setNotes("");
          const ht = typeof invRow.tax === "number" ? invRow.tax : 0;
          const hs = typeof invRow.serviceCharge === "number" ? invRow.serviceCharge : 0;
          const hd = typeof invRow.discount === "number" ? invRow.discount : 0;
          const bp = invRow.billingProfile;
          const hasActiveBillingProfile = !!(bp && typeof bp === "object" && bp.active !== false);
          setHeaderDiscount(hd);
          setHeaderTax(ht);
          setHeaderService(hs);
          setLockedFromSource(
            Math.abs(ht) > 0.001 || Math.abs(hs) > 0.001 || Math.abs(hd) > 0.001 || hasActiveBillingProfile,
          );
          if (hasActiveBillingProfile) {
            if (bp.noService === true) setApplyServiceCharge(false);
            else setApplyServiceCharge(true);
            if (bp.noVat === true) setApplyVatCharge(false);
            else setApplyVatCharge(true);
          }
          setDiscountInput(
            typeof invRow.discount === "number" && invRow.discount > 0 ? String(invRow.discount) : "",
          );
          setDetailHint("");
          return;
        }

        const r = await fetch(`${base}/api/invoices/${encodeURIComponent(id)}`);
        const txt = await r.text();
        const j = tryParseJson<SqlInvoicePayload & { detail?: unknown }>(txt) ?? {};
        if (r.ok && Array.isArray(j.Items) && j.Items.length > 0) {
          if (cancelled) return;
          const agg = aggregateFromSqlItems(j.Items);
          setLines(agg);
          setBillNumber(typeof j.BillNumber === "number" ? j.BillNumber : undefined);
          setBillDate(String(j.BillDate || ""));
          setAgentName(String(j.AgentName || ""));
          setNotes(String(j.Notes || ""));
          const hd = typeof j.Discount === "number" ? j.Discount : parseFloat(String(j.Discount)) || 0;
          const ht = typeof j.TaxValue === "number" ? j.TaxValue : parseFloat(String(j.TaxValue)) || 0;
          const hs =
            typeof j.LocalAdministrativeTax === "number"
              ? j.LocalAdministrativeTax
              : parseFloat(String(j.LocalAdministrativeTax)) || 0;
          const bp2 = invRow.billingProfile;
          const hasActiveBillingProfile2 = !!(bp2 && typeof bp2 === "object" && bp2.active !== false);
          setHeaderDiscount(hd);
          setHeaderTax(ht);
          setHeaderService(hs);
          setLockedFromSource(
            Math.abs(ht) > 0.001 || Math.abs(hs) > 0.001 || Math.abs(hd) > 0.001 || hasActiveBillingProfile2,
          );
          if (hasActiveBillingProfile2) {
            if (bp2.noService === true) setApplyServiceCharge(false);
            else setApplyServiceCharge(true);
            if (bp2.noVat === true) setApplyVatCharge(false);
            else setApplyVatCharge(true);
          }
          setDiscountInput(hd > 0.001 ? String(hd) : "");
          setDetailHint("");
          return;
        }

        const sid = String(invRow.sessionId || "").trim();
        if (!sid) {
          if (!cancelled) setDetailHint("لا توجد بنود محفوظة ولا يمكن الجلب من قاعدة البيانات.");
          return;
        }
        const ro = await fetch(`${base}/api/restaurant/orders?sessionId=${encodeURIComponent(sid)}`);
        const ot = await ro.text();
        const oj = tryParseJson<{ orders?: unknown[] }>(ot) ?? {};
        if (!ro.ok || !Array.isArray(oj.orders)) {
          if (!cancelled) setDetailHint("تعذر تحميل بنود الفاتورة من الطلبات.");
          return;
        }
        const matched = oj.orders.filter((o: unknown) => {
          if (!o || typeof o !== "object") return false;
          const fid = String((o as { finalInvoiceId?: string }).finalInvoiceId || "").toUpperCase();
          if (!fid) return false;
          return fid.split(",").some((x) => x.trim() === invUpper);
        });
        const rawParts: Array<{ name?: string; quantity?: number; unitPrice?: number; lineTotal?: number; seatNo?: number | null }> = [];
        let aggTax = 0;
        let aggSvc = 0;
        let aggSub = 0;
        for (const o of matched) {
          const ord = o as { items?: unknown[]; kitchenTotals?: { tax?: number; serviceCharge?: number; subtotal?: number } };
          const kt = ord.kitchenTotals;
          if (kt && typeof kt === "object") {
            aggTax += parseFloat(String(kt.tax)) || 0;
            aggSvc += parseFloat(String(kt.serviceCharge)) || 0;
            aggSub += parseFloat(String(kt.subtotal)) || 0;
          }
          for (const it of ord.items || []) {
            if (!it || typeof it !== "object") continue;
            const d = it as { name?: string; quantity?: number; unitPrice?: number };
            rawParts.push({
              name: d.name,
              quantity: typeof d.quantity === "number" ? d.quantity : parseFloat(String(d.quantity)) || 0,
              unitPrice: typeof d.unitPrice === "number" ? d.unitPrice : parseFloat(String(d.unitPrice)) || 0,
              seatNo: typeof (d as { seatNo?: number | null }).seatNo === "number" ? (d as { seatNo?: number | null }).seatNo ?? null : null,
            });
          }
        }
        if (cancelled) return;
        if (rawParts.length === 0) {
          setDetailHint("لم تُسترجَع بنود الفاتورة (جرب الاتصال بقاعدة البيانات أو أعد طلب الحساب).");
          setLines([]);
          return;
        }
        const agg = aggregateFromParts(rawParts);
        setLines(agg);
        setBillNumber(undefined);
        setBillDate("");
        setAgentName("");
        setNotes("");
        setHeaderDiscount(0);
        const bp3 = invRow.billingProfile;
        const hasActiveBillingProfile3 = !!(bp3 && typeof bp3 === "object" && bp3.active !== false);
        if (aggSub > 0 || aggTax > 0 || aggSvc > 0) {
          const ht = round2(aggTax);
          const hs = round2(aggSvc);
          setHeaderTax(ht);
          setHeaderService(hs);
          setLockedFromSource(
            Math.abs(ht) > 0.001 || Math.abs(hs) > 0.001 || hasActiveBillingProfile3,
          );
        } else {
          setHeaderTax(0);
          setHeaderService(0);
          setLockedFromSource(hasActiveBillingProfile3);
        }
        if (hasActiveBillingProfile3) {
          if (bp3.noService === true) setApplyServiceCharge(false);
          else setApplyServiceCharge(true);
          if (bp3.noVat === true) setApplyVatCharge(false);
          else setApplyVatCharge(true);
        }
        setDetailHint("تفاصيل مُستخرجة من طلبات الجلسة (احتياطي).");
      } catch {
        if (!cancelled) setDetailHint("تعذر تحميل تفاصيل الفاتورة من السيرفر.");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    void enrich();
    return () => {
      cancelled = true;
    };
  }, [open, invoiceId, row, base]);

  const linesSum = useMemo(() => round2(lines.reduce((s, ln) => s + ln.lineTotal, 0)), [lines]);
  const tableTipFromRow = typeof row?.tipAmount === "number" && Number.isFinite(row.tipAmount) ? Math.max(0, row.tipAmount) : 0;
  const ledger = useMemo(() => {
    if (lines.length === 0 && typeof row?.total === "number" && Number.isFinite(row.total)) {
      return {
        linesSum: 0,
        discount: 0,
        service: 0,
        tax: 0,
        grand: round2(row.total),
        mode: "header" as const,
        svcPct: 0,
        vatPct: 0,
        serviceLabel: "—",
      };
    }
    return computeCashierLedger(
      lockedFromSource,
      linesSum,
      headerDiscount,
      headerTax,
      headerService,
      row?.total,
      parseMoneyInput(discountInput),
      applyServiceCharge,
      applyVatCharge,
      pricingSnapshot,
    );
  }, [
    lines.length,
    linesSum,
    row?.total,
    lockedFromSource,
    headerDiscount,
    headerTax,
    headerService,
    discountInput,
    applyServiceCharge,
    applyVatCharge,
    pricingSnapshot,
  ]);

  const tableTipAdditive = !lockedFromSource ? round2(tableTipFromRow) : 0;
  const extraTip = !lockedFromSource ? parseMoneyInput(tipInput) : 0;
  const totalDue = useMemo(() => {
    if (lines.length === 0 && typeof row?.total === "number" && Number.isFinite(row.total)) {
      return round2(row.total);
    }
    if (lockedFromSource) return round2(ledger.grand);
    return round2(ledger.grand + tableTipAdditive + extraTip);
  }, [lines.length, row?.total, lockedFromSource, ledger.grand, tableTipAdditive, extraTip]);

  const splitPersonsN = useMemo(() => {
    const n = parseInt(String(splitGuestsInput).trim(), 10);
    return Number.isFinite(n) && n >= 1 ? n : 0;
  }, [splitGuestsInput]);

  const perPersonShare = useMemo(() => {
    if (billingMode !== "split_equal" || splitPersonsN < 1) return null;
    return round2(totalDue / splitPersonsN);
  }, [billingMode, splitPersonsN, totalDue]);

  const lineSplitSectionHtml = useMemo(() => {
    if (billingMode !== "split_equal" || splitPersonsN < 1 || lines.length === 0) return "";
    const rows = lines
      .map(
        (ln) =>
          `<tr><td>نصيب تقديري · ${escapeHtml(ln.name)}</td><td>${(ln.lineTotal / splitPersonsN).toFixed(2)}</td></tr>`,
      )
      .join("");
    return `<table class="tot" style="margin-top:4px;font-size:9px">${rows}</table>`;
  }, [billingMode, splitPersonsN, lines]);

  const seatSections = useMemo(() => groupLinesBySeat(lines), [lines]);
  const seatSectionHtml = useMemo(() => buildSeatSectionsHtml(lines), [lines]);

  const foldLocked = splitShareLocked;

  const pbCash = round2(parseMoneyInput(cash));
  const pbVisa = round2(parseMoneyInput(visa));
  const pbWallet = round2(parseMoneyInput(wallet));
  const pbInsta = round2(parseMoneyInput(instapay));
  const sum = round2(pbCash + pbVisa + pbWallet + pbInsta);
  // اعتماد المقارنة على منزلتين عشريتين فقط (قرش) لتفادي كسور الفاصلة العائمة.
  const totalDue2 = round2(totalDue);
  const sum2 = round2(sum);
  const sumOk = sum2 === totalDue2;
  const canSubmit = Boolean(
    allowPayment &&
      row?.awaitingPayment &&
      row?.invoiceId &&
      !loading &&
      !detailLoading &&
      (onAccount || sumOk) &&
      totalDue >= 0 &&
      (lines.length === 0 || ledger.linesSum > 0.0001 || ledger.grand > 0.0001),
  );

  const userRole = String(user?.role || "").trim().toLowerCase();
  const waiterPrintLocked = userRole === "waiter" && Number(row?.printCount || 0) >= 1;

  const suggestRemainder = useCallback(
    (field: "cash" | "visa" | "wallet" | "instapay") => {
      const cur = {
        cash: parseMoneyInput(cash),
        visa: parseMoneyInput(visa),
        wallet: parseMoneyInput(wallet),
        instapay: parseMoneyInput(instapay),
      };
      let o = 0;
      for (const k of ["cash", "visa", "wallet", "instapay"] as const) {
        if (k === field) continue;
        o += cur[k];
      }
      return Math.max(0, round2(totalDue - o));
    },
    [cash, visa, wallet, instapay, totalDue],
  );

  const receiptHtml = useMemo(() => {
    if (!row?.invoiceId) return "";
    return buildThermalReceiptHtml({
      billNo: billNumber != null ? String(billNumber) : "—",
      billDate: billDate || "—",
      agentName: agentName || "—",
      invoiceGuid: String(row.invoiceId),
      tableLabel: row.tableLabel || null,
      customerReceipt: true,
      sessionId: row.sessionId,
      requestedAt: (row.requestedAt || "").replace("T", " ").slice(0, 19) || "—",
      lines,
      ledger: {
        linesSum: ledger.linesSum,
        discount: ledger.discount,
        service: ledger.service,
        tax: ledger.tax,
        mode: ledger.mode,
        vatPct: ledger.vatPct,
        serviceLabel: ledger.serviceLabel,
      },
      totalDue: round2(totalDue),
      lockedFromSource,
      tableTipAdditive,
      extraTip,
      billingMode,
      cash: pbCash,
      visa: pbVisa,
      wallet: pbWallet,
      instapay: pbInsta,
      notes: notes || "",
      splitEqualPersons: billingMode === "split_equal" && splitPersonsN >= 1 ? splitPersonsN : undefined,
      perPersonShare: perPersonShare,
      lineSplitSectionHtml: lineSplitSectionHtml || undefined,
      seatSectionHtml: seatSectionHtml || undefined,
    });
  }, [
    row,
    billNumber,
    billDate,
    agentName,
    lines,
    ledger,
    totalDue,
    lockedFromSource,
    tableTipAdditive,
    extraTip,
    billingMode,
    pbCash,
    pbVisa,
    pbWallet,
    pbInsta,
    notes,
    splitPersonsN,
    perPersonShare,
    lineSplitSectionHtml,
    seatSectionHtml,
  ]);

  const runThermalPrint = useCallback(async () => {
    if (!receiptHtml || !row?.invoiceId) return;
    setMsg("");
    setPrinting(true);
    const w = window.open("", "_blank", "noopener,noreferrer,width=420,height=720");
    try {
      const r = await fetch(`${base}/api/restaurant/invoices-local/mark-printed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: row.invoiceId,
          mat3amActor: buildMat3amActor(user),
        }),
      });
      const txt = await r.text();
      const j = tryParseJson<{ detail?: unknown; invoice?: CashierInvoiceRow }>(txt) ?? {};
      if (!r.ok) {
        const d = j.detail;
        throw new Error(typeof d === "string" ? d : txt.slice(0, 200) || "فشل تسجيل الطباعة");
      }
      if (j.invoice) setRow(j.invoice);
      onChanged?.();
      if (w) {
        w.document.open();
        w.document.write(receiptHtml);
        w.document.close();
        w.focus();
        window.setTimeout(() => {
          try {
            w.print();
          } catch {
            /* ignore */
          }
        }, 350);
        return;
      }
      printHtmlInIframe(receiptHtml);
    } catch (e) {
      try {
        w?.close();
      } catch {
        /* ignore */
      }
      setMsg(String(e));
    } finally {
      setPrinting(false);
    }
  }, [base, onChanged, receiptHtml, row?.invoiceId, user]);

  useEffect(() => {
    if (!open || !autoPrintOnOpen) return;
    if (autoPrintedRef.current) return;
    if (!row?.invoiceId || !receiptHtml || loading || detailLoading || printing || waiterPrintLocked) return;
    autoPrintedRef.current = true;
    void runThermalPrint();
  }, [autoPrintOnOpen, detailLoading, loading, open, printing, receiptHtml, row?.invoiceId, runThermalPrint, waiterPrintLocked]);

  async function submit() {
    const id = String(row?.invoiceId || "").trim();
    if (!id || !canSubmit) return;
    setPaying(true);
    setMsg("");
    try {
      if (!sumOk) {
        throw new Error(`مجموع حقول الدفع يجب أن يساوي إجمالي الفاتورة (${totalDue2.toFixed(2)} ج.م) بعد التقريب لمنزلتين عشريتين.`);
      }
      const body = {
        invoiceId: id,
        closeSession,
        paymentBreakdown: {
          cash: pbCash,
          visa: pbVisa,
          wallet: pbWallet,
          instapay: pbInsta,
        },
        totals: {
          subtotal: round2(ledger.linesSum),
          discount: round2(ledger.discount),
          serviceCharge: round2(ledger.service),
          tax: round2(ledger.tax),
          tableTip: tableTipAdditive,
          extraTip: round2(extraTip),
          grandTotal: sum2,
          applyServiceCharge,
          applyVatCharge,
          billingMode,
          pricingMode: ledger.mode,
          splitEqualPersons: billingMode === "split_equal" && splitPersonsN >= 1 ? splitPersonsN : undefined,
          perPersonShare: perPersonShare ?? undefined,
        },
      };
      const r = await fetch(`${base}/api/restaurant/invoices-local/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      const j = tryParseJson<{ detail?: unknown }>(txt) ?? {};
      if (!r.ok) {
        const d = j.detail;
        throw new Error(typeof d === "string" ? d : txt.slice(0, 200) || "فشل التسديد");
      }
      onPaid();
      onChanged?.();
      onClose();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setPaying(false);
    }
  }

  async function submitOnAccount() {
    const id = String(row?.invoiceId || "").trim();
    if (!id) return;
    setOnAccountBusy(true);
    setMsg("");
    try {
      const body = {
        invoiceId: id,
        closeSession: closeSession ?? true,
      };
      const r = await fetch(`${base}/api/restaurant/invoices-local/mark-on-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      if (!r.ok) {
        const j = tryParseJson<{ detail?: unknown }>(txt) ?? {};
        throw new Error(typeof j.detail === "string" ? j.detail : txt.slice(0, 200) || "فشل الترحيل على الحساب");
      }
      onPaid();
      onChanged?.();
      onClose();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setOnAccountBusy(false);
    }
  }

  if (!open || !invoiceId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cashier-pay-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 720,
          width: "100%",
          maxHeight: "92vh",
          overflow: "auto",
          border: "1px solid var(--border)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="cashier-pay-title" style={{ marginTop: 0, fontSize: "1.12rem" }}>
          {dialogTitle || "تسديد الفاتورة"}
        </h2>
        {loading && !row ? <p style={{ color: "var(--muted)" }}>جاري التحميل…</p> : null}
        {row ? (
          <>
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.85rem 0.75rem",
                borderRadius: 10,
                border: "1px dashed rgba(148,163,184,0.55)",
                background: "rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ textAlign: "center", fontWeight: 800, fontSize: "1.05rem", marginBottom: "0.35rem" }}>
                فاتورة — نسخة عميل
              </div>
              <div style={{ textAlign: "center", fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.45rem" }}>
                {billNumber != null ? <>رقم الفاتورة المحاسبي: {billNumber}</> : <>فاتورة انتظار</>}
                {billDate ? <> · {billDate}</> : null}
                {agentName ? <> · {agentName}</> : null}
              </div>
              {row.tableLabel ? (
                <div style={{ textAlign: "center", fontWeight: 800, fontSize: "0.95rem", marginBottom: "0.35rem" }}>
                  الطاولة: {row.tableName || row.tableLabel}
                  {typeof row.tableNumber === "number" ? <span style={{ fontWeight: 600, color: "var(--muted)" }}> ({row.tableNumber})</span> : null}
                </div>
              ) : (
                <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--muted)", margin: "0 0 0.35rem" }}>
                  الطاولة: غير مربوطة في المخطط لهذه الجلسة
                </p>
              )}
              <details style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.35rem", textAlign: "center" }}>
                <summary style={{ cursor: "pointer", listStyle: "none" }}>مرجع تقني (للدعم فقط)</summary>
                <div style={{ wordBreak: "break-all", fontFamily: "monospace", marginTop: "0.35rem", lineHeight: 1.35 }}>
                  فاتورة: {String(row.invoiceId || "")}
                  {row.sessionId ? (
                    <>
                      <br />
                      جلسة: {row.sessionId}
                    </>
                  ) : null}
                  {row.splitName ? <span> · {row.splitName}</span> : null}
                </div>
              </details>
              <div style={{ textAlign: "center", fontSize: "0.76rem", color: "var(--muted)" }}>
                مرات الطباعة: {Number(row.printCount || 0)}
                {row.firstPrintedAt ? <> · أول طباعة: {String(row.firstPrintedAt).replace("T", " ").slice(0, 19)}</> : null}
                {row.firstPrintedByRole ? <> · بواسطة: {String(row.firstPrintedByRole)}</> : null}
              </div>
              {printerHint ? (
                <div style={{ textAlign: "center", fontSize: "0.76rem", color: "var(--muted)", marginTop: 4 }}>
                  الطابعة المعتمدة: {printerHint}
                </div>
              ) : null}
              {detailLoading ? (
                <p style={{ margin: "0.35rem 0", fontSize: "0.82rem", color: "var(--muted)" }}>جاري تحميل البنود…</p>
              ) : null}
              {lines.length > 0 ? (
                <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.35rem" }}>
                  {seatSections.map((section) => (
                    <div
                      key={`${section.label}-${section.seatNo ?? "none"}`}
                      style={{
                        border: "1px solid rgba(148,163,184,0.25)",
                        borderRadius: 10,
                        overflow: "hidden",
                        background: "rgba(255,255,255,0.02)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "0.45rem 0.55rem",
                          background: "rgba(255,255,255,0.04)",
                          borderBottom: "1px solid rgba(148,163,184,0.2)",
                        }}
                      >
                        <strong>{section.label}</strong>
                        <span style={{ fontWeight: 700 }}>{section.total.toFixed(2)} ج.م</span>
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            <th style={{ textAlign: "right", padding: "0.35rem 0.25rem" }}>الصنف</th>
                            <th style={{ textAlign: "center", padding: "0.35rem 0.25rem", width: "4.2rem" }}>كمية</th>
                            <th style={{ textAlign: "left", padding: "0.35rem 0.25rem", width: "4.5rem" }}>سعر</th>
                            <th style={{ textAlign: "left", padding: "0.35rem 0.25rem", width: "4.5rem" }}>إجمالي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.lines.map((ln, i) => (
                            <tr key={`${section.label}-${ln.name}-${i}`} style={{ borderBottom: "1px solid rgba(148,163,184,0.25)" }}>
                              <td style={{ padding: "0.35rem 0.25rem" }}>{ln.name}</td>
                              <td style={{ textAlign: "center" }}>{ln.quantity % 1 === 0 ? String(ln.quantity) : ln.quantity.toFixed(2)}</td>
                              <td style={{ textAlign: "left" }}>{ln.unitPrice.toFixed(2)}</td>
                              <td style={{ textAlign: "left", fontWeight: 600 }}>{ln.lineTotal.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ) : !detailLoading ? (
                <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: "0.25rem 0" }}>لا توجد بنود للعرض حالياً.</p>
              ) : null}
              <div style={{ marginTop: "0.65rem", fontSize: "0.84rem", lineHeight: 1.55 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>مجموع الأصناف</span>
                  <span>{ledger.linesSum.toFixed(2)} ج.م</span>
                </div>
                {ledger.discount > 0.001 ? (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>الخصم</span>
                    <span>{ledger.discount.toFixed(2)} ج.م</span>
                  </div>
                ) : null}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                    {!lockedFromSource ? (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", whiteSpace: "nowrap" }}>
                        <input
                          type="checkbox"
                          checked={applyServiceCharge}
                          disabled={foldLocked}
                          onChange={(e) => setApplyServiceCharge(e.target.checked)}
                        />
                        <span style={{ fontSize: "0.72rem" }}>يطبق</span>
                      </label>
                    ) : null}
                    <span style={{ color: "var(--muted)" }}>{ledger.serviceLabel}</span>
                  </span>
                  <span>{ledger.service.toFixed(2)} ج.م</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                    {!lockedFromSource ? (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", whiteSpace: "nowrap" }}>
                        <input
                          type="checkbox"
                          checked={applyVatCharge}
                          disabled={foldLocked}
                          onChange={(e) => setApplyVatCharge(e.target.checked)}
                        />
                        <span style={{ fontSize: "0.72rem" }}>يطبق</span>
                      </label>
                    ) : null}
                    <span style={{ color: "var(--muted)" }}>
                      الضريبة{ledger.mode === "recalc" ? ` (${ledger.vatPct}%)` : ""}
                    </span>
                  </span>
                  <span>{ledger.tax.toFixed(2)} ج.م</span>
                </div>
                {!lockedFromSource && tableTipAdditive > 0.001 ? (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>تيبس (من الطاولة)</span>
                    <span>{tableTipAdditive.toFixed(2)} ج.م</span>
                  </div>
                ) : null}
                {!lockedFromSource ? (
                  <label style={{ display: "grid", gap: 4, marginTop: "0.35rem" }}>
                    <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>تيبس إضافي</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={tipInput}
                      onChange={(e) => setTipInput(e.target.value)}
                      disabled={foldLocked}
                      placeholder="0"
                      style={{
                        padding: "0.35rem 0.5rem",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "inherit",
                        maxWidth: "12rem",
                      }}
                    />
                  </label>
                ) : null}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: "0.45rem",
                    paddingTop: "0.45rem",
                    borderTop: "1px solid var(--border)",
                    fontWeight: 800,
                    fontSize: "0.95rem",
                  }}
                >
                  <span>الإجمالي المطلوب</span>
                  <span>{totalDue.toFixed(2)} ج.م</span>
                </div>
                {billingMode === "split_equal" && splitPersonsN >= 1 && lines.length > 0 ? (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.74rem", lineHeight: 1.45 }}>
                    <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>نصيب تقديري لكل بند (÷ {splitPersonsN})</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        {lines.map((ln, i) => (
                          <tr key={`split-${i}`} style={{ borderBottom: "1px solid rgba(148,163,184,0.2)" }}>
                            <td style={{ padding: "0.2rem 0", color: "var(--muted)" }}>{ln.name}</td>
                            <td style={{ padding: "0.2rem 0", textAlign: "left", fontWeight: 600 }}>
                              {(ln.lineTotal / splitPersonsN).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
              {notes ? (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>{notes}</p>
              ) : null}
              {detailHint ? (
                <p style={{ margin: "0.45rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>{detailHint}</p>
              ) : null}
            </div>

            {!lockedFromSource ? (
              <div className="card" style={{ marginTop: "0.75rem", padding: "0.65rem 0.75rem", fontSize: "0.86rem" }}>
                <div style={{ fontWeight: 700, marginBottom: "0.45rem" }}>تعديلات الكاشير (إعادة حساب الخدمة والضريبة)</div>
                <label style={{ display: "grid", gap: 4, marginBottom: "0.5rem" }}>
                  <span style={{ color: "var(--muted)" }}>خصم إضافي (ج.م)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    disabled={foldLocked}
                    placeholder="0"
                    style={{
                      padding: "0.45rem 0.55rem",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "inherit",
                    }}
                  />
                </label>
                {pricingSnapshot?.tbl007Service?.matched && pricingSnapshot.tbl007Service.productName ? (
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
                    مطابقة TBL007: {pricingSnapshot.tbl007Service.productName}
                  </p>
                ) : null}
              </div>
            ) : (
              <p style={{ marginTop: "0.65rem", fontSize: "0.78rem", color: "var(--muted)" }}>
                الضريبة ورسوم الخدمة مُثبتة في الفاتورة المحفوظة — لا يُعاد حسابها هنا.
              </p>
            )}

            {allowPayment ? (
              <>
            <div style={{ marginTop: "0.65rem", padding: "0.55rem 0.65rem", borderRadius: 10, border: "1px dashed rgba(148,163,184,0.55)", background: onAccount ? "rgba(234,179,8,0.08)" : "rgba(0,0,0,0.02)" }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={onAccount} onChange={(e) => setOnAccount(e.target.checked)} />
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>ترحيل على حساب العميل (بدون سداد فوري)</span>
              </label>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                يُسجّل الفاتورة كمديونية على حساب العميل المربوط بالجلسة (مالك / VIP / عميل آجل).
              </p>
              {onAccount && row?.agentName ? (
                <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", fontWeight: 700 }}>العميل: {row.agentName}</p>
              ) : null}
            </div>

            {!onAccount ? (
              <>
            <h3 style={{ fontSize: "0.95rem", margin: "1rem 0 0.35rem" }}>توزيع السداد وسياسة السبليت</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.65rem", fontSize: "0.8rem" }}>
              <span style={{ color: "var(--muted)" }}>سياسة السبليت</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-start" }}>
                {(
                  [
                    ["full_table", BILLING_MODE_LABEL.full_table],
                    ["split_equal", BILLING_MODE_LABEL.split_equal],
                    ["split_by_order", BILLING_MODE_LABEL.split_by_order],
                  ] as const
                ).map(([val, lab]) => (
                  <label
                    key={val}
                    style={{ display: "inline-flex", alignItems: "flex-start", gap: 6, cursor: "pointer", maxWidth: "100%" }}
                  >
                    <input
                      type="radio"
                      name="mat3am-billing"
                      checked={billingMode === val}
                      onChange={() => setBillingMode(val)}
                      disabled={foldLocked}
                      style={{ marginTop: 3 }}
                    />
                    <span>{lab}</span>
                  </label>
                ))}
              </div>
            </div>
            {billingMode === "split_equal" ? (
              <div
                style={{
                  marginBottom: "0.65rem",
                  padding: "0.55rem 0.65rem",
                  borderRadius: 10,
                  border: "1px dashed rgba(148,163,184,0.55)",
                  fontSize: "0.82rem",
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--muted)" }}>عدد الأشخاص (لحساب نصيب الفرد بالتساوي)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={splitGuestsInput}
                    onChange={(e) => setSplitGuestsInput(e.target.value)}
                    disabled={foldLocked}
                    placeholder="مثال: 4"
                    style={{
                      padding: "0.4rem 0.5rem",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "inherit",
                      maxWidth: "8rem",
                    }}
                  />
                </label>
                {perPersonShare != null && splitPersonsN >= 1 ? (
                  <div
                    style={{
                      marginTop: "0.55rem",
                      padding: "0.65rem 0.5rem",
                      borderRadius: 10,
                      border: "2px solid rgba(34,197,94,0.45)",
                      background: "rgba(34,197,94,0.08)",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.25rem" }}>نصيب كل عميل (بالتساوي)</div>
                    <div style={{ fontSize: "1.45rem", fontWeight: 900, letterSpacing: "0.02em" }}>{perPersonShare.toFixed(2)} ج.م</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      الإجمالي ÷ {splitPersonsN} أشخاص
                    </div>
                  </div>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.55rem" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={splitPersonsN < 1 || foldLocked}
                    onClick={() => setSplitShareLocked(true)}
                    style={{ fontSize: "0.82rem" }}
                  >
                    تثبيت النصيب
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!foldLocked}
                    onClick={() => setSplitShareLocked(false)}
                    style={{ fontSize: "0.82rem" }}
                  >
                    إلغاء التثبيت
                  </button>
                </div>
              </div>
            ) : null}
            <div style={{ display: "grid", gap: "0.65rem" }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: "0.85rem" }}>نقدي</span>
                <input
                  type="text"
                  inputMode="decimal"
                  style={{
                    padding: "0.45rem 0.55rem",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "inherit",
                  }}
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  onFocus={() => {
                    if (!String(cash || "").trim()) setCash(String(suggestRemainder("cash")));
                  }}
                  placeholder="0"
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: "0.85rem" }}>فيزا</span>
                <input
                  type="text"
                  inputMode="decimal"
                  style={{
                    padding: "0.45rem 0.55rem",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "inherit",
                  }}
                  value={visa}
                  onChange={(e) => setVisa(e.target.value)}
                  onFocus={() => {
                    if (!String(visa || "").trim()) setVisa(String(suggestRemainder("visa")));
                  }}
                  placeholder="0"
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: "0.85rem" }}>محفظة</span>
                <input
                  type="text"
                  inputMode="decimal"
                  style={{
                    padding: "0.45rem 0.55rem",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "inherit",
                  }}
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  onFocus={() => {
                    if (!String(wallet || "").trim()) setWallet(String(suggestRemainder("wallet")));
                  }}
                  placeholder="0"
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: "0.85rem" }}>انستاباي</span>
                <input
                  type="text"
                  inputMode="decimal"
                  style={{
                    padding: "0.45rem 0.55rem",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "inherit",
                  }}
                  value={instapay}
                  onChange={(e) => setInstapay(e.target.value)}
                  onFocus={() => {
                    if (!String(instapay || "").trim()) setInstapay(String(suggestRemainder("instapay")));
                  }}
                  placeholder="0"
                />
              </label>
            </div>
            <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.5 }}>
              ملخص الدفع: نقدي {pbCash.toFixed(2)} + فيزا {pbVisa.toFixed(2)} + محفظة {pbWallet.toFixed(2)} + انستاباي {pbInsta.toFixed(2)} ={" "}
              <strong style={{ color: "inherit" }}>{sum.toFixed(2)}</strong> ج.م
            </div>
            {billingMode === "split_equal" ? (
              <div
                style={{
                  marginTop: "0.65rem",
                  padding: "0.65rem 0.75rem",
                  borderRadius: 10,
                  border: "2px solid rgba(5,150,105,0.45)",
                  background: "linear-gradient(180deg, rgba(236,253,245,0.95), rgba(209,250,229,0.5))",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.25rem" }}>نصيب الفرد — يظهر أيضاً داخل المعاينة أدناه</div>
                {perPersonShare != null && splitPersonsN >= 1 ? (
                  <>
                    <div style={{ fontSize: "1.65rem", fontWeight: 900, letterSpacing: "0.02em" }}>{perPersonShare.toFixed(2)} ج.م</div>
                    <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: "0.2rem" }}>تقسيم بالتساوي على {splitPersonsN} أشخاص</div>
                  </>
                ) : (
                  <div style={{ fontSize: "0.88rem", color: "var(--muted)" }}>أدخل عدد الأشخاص في خانة السبليت أعلاه ليُحسب النصيب ويظهر في المعاينة.</div>
                )}
              </div>
            ) : null}
            <details
              open
              style={{
                marginTop: "0.65rem",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0.5rem 0.6rem",
                background: "rgba(0,0,0,0.02)",
              }}
            >
              <summary
                id="receipt-preview"
                style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.88rem", listStyle: "none" }}
              >
                معاينة الإيصال (عرض شاشة فقط — عرض 80مم)
              </summary>
              <iframe
                title="معاينة إيصال حراري"
                srcDoc={receiptHtml || "<!DOCTYPE html><html><body dir='rtl'></body></html>"}
                style={{
                  width: "100%",
                  maxWidth: "84mm",
                  height: billingMode === "split_equal" ? "min(70vh, 520px)" : "360px",
                  border: "1px solid rgba(148,163,184,0.45)",
                  borderRadius: 8,
                  marginTop: "0.5rem",
                  background: "#fff",
                }}
              />
            </details>
            <p
              style={{
                marginTop: "0.75rem",
                fontWeight: 700,
                color: sumOk ? "#22c55e" : "var(--danger)",
                fontSize: "0.95rem",
              }}
            >
              مجموع المدخلات: {sum2.toFixed(2)} ج.م
              {!sumOk ? ` — يجب أن يساوي ${totalDue2.toFixed(2)} ج.م` : null}
            </p>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: "0.35rem", fontSize: "0.82rem" }}
              onClick={() => {
                setCash("");
                setVisa("");
                setWallet("");
                setInstapay("");
                setMsg("");
              }}
            >
              تفريغ حقول الدفع
            </button>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: "0.5rem", fontSize: "0.9rem" }}>
              <input type="checkbox" checked={closeSession} onChange={(e) => setCloseSession(e.target.checked)} />
              إغلاق الجلسة بعد التسديد (إن لم تبقَ فواتير معلّقة)
            </label>
              </>
            ) : null}

            {onAccount ? (
              <div style={{ marginTop: "0.65rem", padding: "0.55rem 0.65rem", borderRadius: 10, border: "2px solid rgba(234,179,8,0.45)", background: "rgba(234,179,8,0.06)", textAlign: "center" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>سيتم ترحيل الفاتورة على حساب العميل بدون سداد فوري.</div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: "0.25rem" }}>الفاتورة تُسجّل كمديونية ويُمكن متابعتها لاحقاً من شاشة كشف الحساب.</div>
              </div>
            ) : null}
              </>
            ) : null}
          </>
        ) : null}
        {msg ? (
          <p style={{ color: "var(--danger)", fontSize: "0.88rem", marginTop: "0.75rem" }}>{msg}</p>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={paying || printing || !row || !receiptHtml || waiterPrintLocked}
            onClick={() => void runThermalPrint()}
            title={waiterPrintLocked ? "تمت طباعة الشيك مرة من الكابتن؛ أي إعادة طباعة تكون من الكاشير أو المدير." : "فتح حوار الطباعة"}
          >
            {printing ? "..." : waiterPrintLocked ? "طبع الكابتن" : "طباعة إيصال"}
          </button>
          <button type="button" className="btn btn-ghost" disabled={paying || printing} onClick={onClose}>
            إلغاء
          </button>
          {allowPayment ? (
            onAccount ? (
              <button type="button" className="btn btn-primary" disabled={!canSubmit || onAccountBusy || printing} onClick={() => void submitOnAccount()} style={{ background: "#ca8a04", borderColor: "#ca8a04" }}>
                {onAccountBusy ? "…" : "ترحيل على الحساب"}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!canSubmit || paying || printing} onClick={() => void submit()}>
                {paying ? "…" : "تأكيد التسديد"}
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
