export type Promotion = {
  id: string;
  name: string;
  type: string;
  priority: number;
  isActive: boolean;
  isStackable: boolean;
  payload?: Record<string, unknown> | null;
};

export type PromoApplyResult = {
  lineDiscounts: Record<string, number>;
  invoiceDiscount: number;
  promoNotes: string[];
};

function toNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function nowHHmm() {
  const d = new Date();
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
}

function inWindow(now: string, from: string, to: string) {
  return now >= from && now <= to;
}

type CartLine = { id: string; productGuide: string; name: string; qty: number; unitPrice: number };

export function applyPromotions(cart: CartLine[], promos: Promotion[], couponCode: string): PromoApplyResult {
  const lineDiscounts: Record<string, number> = {};
  let invoiceDiscount = 0;
  const notes: string[] = [];

  const sorted = [...promos].sort((a, b) => a.priority - b.priority);
  const subtotal = cart.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  let canApplyMore = true;

  for (const p of sorted) {
    if (!canApplyMore) break;
    const payload = p.payload || {};
    let applied = false;

    if (p.type === "percent_invoice") {
      const minSubtotal = toNum(payload.minSubtotal, 0);
      const percent = toNum(payload.percent, 0);
      if (percent > 0 && subtotal >= minSubtotal) {
        const d = (subtotal * percent) / 100;
        invoiceDiscount += d;
        notes.push(`${p.name}: خصم ${percent}% على الفاتورة`);
        applied = true;
      }
    }

    if (p.type === "buy_x_get_y") {
      const productGuide = String(payload.productGuide || "").trim();
      const buyQty = Math.max(1, Math.floor(toNum(payload.buyQty, 2)));
      const freeQty = Math.max(1, Math.floor(toNum(payload.freeQty, 1)));
      const line = cart.find((l) => l.productGuide === productGuide);
      if (line && line.qty >= buyQty) {
        const cycles = Math.floor(line.qty / (buyQty + freeQty));
        const freebies = cycles * freeQty;
        if (freebies > 0) {
          const d = freebies * line.unitPrice;
          lineDiscounts[line.id] = (lineDiscounts[line.id] || 0) + d;
          notes.push(`${p.name}: مجاني ${freebies} من ${line.name}`);
          applied = true;
        }
      }
    }

    if (p.type === "tiered_qty") {
      const productGuide = String(payload.productGuide || "").trim();
      const tiers = Array.isArray(payload.tiers) ? (payload.tiers as Array<Record<string, unknown>>) : [];
      const line = cart.find((l) => l.productGuide === productGuide);
      if (line && tiers.length) {
        const eligible = tiers
          .map((t) => ({ minQty: toNum(t.minQty, 0), percent: toNum(t.percent, 0) }))
          .filter((t) => t.percent > 0 && line.qty >= t.minQty)
          .sort((a, b) => b.minQty - a.minQty)[0];
        if (eligible) {
          const d = (line.qty * line.unitPrice * eligible.percent) / 100;
          lineDiscounts[line.id] = (lineDiscounts[line.id] || 0) + d;
          notes.push(`${p.name}: خصم ${eligible.percent}% على ${line.name}`);
          applied = true;
        }
      }
    }

    if (p.type === "happy_hour") {
      const percent = toNum(payload.percent, 0);
      const from = String(payload.from || "16:00");
      const to = String(payload.to || "18:00");
      if (percent > 0 && inWindow(nowHHmm(), from, to)) {
        const d = (subtotal * percent) / 100;
        invoiceDiscount += d;
        notes.push(`${p.name}: Happy Hour ${percent}%`);
        applied = true;
      }
    }

    if (p.type === "coupon") {
      const code = String(payload.code || "").trim().toLowerCase();
      const percent = toNum(payload.percent, 0);
      if (code && percent > 0 && couponCode.trim().toLowerCase() === code) {
        const d = (subtotal * percent) / 100;
        invoiceDiscount += d;
        notes.push(`${p.name}: كوبون ${percent}%`);
        applied = true;
      }
    }

    if (applied && !p.isStackable) {
      canApplyMore = false;
    }
  }

  return { lineDiscounts, invoiceDiscount, promoNotes: notes };
}
