import { getApiBase } from "./apiBase";
import { safeFetch } from "./safeFetch";

export type HallDayReportSummary = {
  tablesTouched?: number;
  sessions?: number;
  orders?: number;
  orderValue?: number;
  cancelledOrders?: number;
  returns?: number;
  approvedReturns?: number;
  returnValue?: number;
  approvals?: number;
  approvedApprovals?: number;
  guests?: number;
  net?: number;
  service?: number;
  tax?: number;
  total?: number;
  servicePercent?: number;
  vatPercent?: number;
};

export type HallSessionFinancials = {
  net?: number;
  service?: number;
  tax?: number;
  total?: number;
  servicePercent?: number;
  vatPercent?: number;
  serviceBeforeVat?: boolean;
};

export type HallSessionItemLine = {
  name?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  orderStatus?: string;
  at?: string;
  orderId?: string;
  cancelled?: boolean;
};

export type HallSessionBrief = {
  seq?: number;
  sessionId?: string;
  tableId?: string;
  tableName?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  captainName?: string;
  guestCount?: number;
  guestSession?: boolean;
  orderCount?: number;
  cancelledOrders?: number;
  orderValue?: number;
  returnCount?: number;
  returnValue?: number;
  approvalCount?: number;
  itemLines?: HallSessionItemLine[];
  financials?: HallSessionFinancials;
  financialSource?: string;
  invoice?: {
    invoiceId?: string;
    billNumber?: string | number;
    paidAt?: string | null;
    requestedAt?: string | null;
    status?: string;
  } | null;
  orders?: Array<Record<string, any>>;
  returns?: Array<Record<string, any>>;
  approvals?: Array<Record<string, any>>;
};

export type HallDayReport = {
  reportId?: string;
  businessDay: string;
  windowStart: string;
  windowEnd: string;
  nextOpen?: string;
  labelAr?: string;
  generatedAt: string;
  tableId?: string | null;
  tableName?: string | null;
  policy?: { servicePercent?: number; vatPercent?: number; serviceBeforeVat?: boolean };
  summary: HallDayReportSummary;
  sessionBriefs?: HallSessionBrief[];
  tables?: Array<Record<string, unknown>>;
  captains?: Array<Record<string, unknown>>;
  approvals?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  returns?: Array<Record<string, unknown>>;
  values?: Record<string, unknown>;
  storedPath?: string | null;
  message?: string;
};

function qs(params: Record<string, string | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && String(v).trim()) sp.set(k, String(v).trim());
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function fetchHallDayReport(opts?: {
  tableId?: string | null;
  store?: boolean;
  base?: string;
}): Promise<{ ok: boolean; status: number; data?: HallDayReport; error?: string }> {
  const base = opts?.base ?? getApiBase();
  const url = `${base}/api/restaurant/hall-day-report${qs({
    table_id: opts?.tableId || undefined,
    store: opts?.store ? "1" : undefined,
  })}`;
  const res = await safeFetch(url);
  const data = (await res.json().catch(() => ({}))) as HallDayReport & { detail?: string };
  if (!res.ok) {
    return { ok: false, status: res.status, error: String(data?.detail || data?.message || `HTTP ${res.status}`) };
  }
  return { ok: true, status: res.status, data };
}

/** تنزيل Excel (xlsx) لتقرير اليوم التشغيلي — مجمع أو طاولة واحدة. */
export async function downloadHallDayExcel(opts?: {
  tableId?: string | null;
  store?: boolean;
  base?: string;
}): Promise<{ ok: boolean; error?: string; filename?: string }> {
  const base = opts?.base ?? getApiBase();
  const url = `${base}/api/restaurant/hall-day-report/excel${qs({
    table_id: opts?.tableId || undefined,
    store: opts?.store ? "1" : undefined,
  })}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: String((j as { detail?: string }).detail || `HTTP ${res.status}`) };
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
    const filename = m?.[1] ? decodeURIComponent(m[1]) : `hall-day-${Date.now()}.xlsx`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    return { ok: true, filename };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
