/**
 * حسابات نقطة البيع — خدمة (افتراضي 12.5%) على الطلب الداخلي بعد «اكتمل»،
 * خصم يدوي لكل سطر، استثناء سطر من الخدمة، ثم VAT على (صافي الأسطر + الخدمة) عندما ServiceBeforeVat.
 */

export type PosLineInput = {
  id: string;
  /** إجمالي السطر قبل أي خصم */
  gross: number;
  /** خصم العروض (من الكوبونات) */
  promoDiscount: number;
  /** خصم يدوي قيمة */
  manualDiscountAmount: number;
  /** خصم يدوي نسبة من الصافي بعد خصم العرض */
  manualDiscountPercent: number;
  /** لا تُحتسب ضمن قاعدة الخدمة 12.5% */
  excludeServiceCharge: boolean;
};

export type PosTotalsParams = {
  lines: PosLineInput[];
  /** طاولة = داخلي (تُحتسب الخدمة عند الإتمام)، سفري/دليفري = بدون خدمة في هذا النموذج */
  orderType: "table" | "takeaway" | "delivery";
  /** بعد الضغط على «اكتمل الطلب» يُفعَّل احتساب الخدمة للطلبات على الطاولة */
  orderFinalized: boolean;
  servicePercent: number;
  vatPercent: number;
  serviceBeforeVat: boolean;
};

export type LineTotalsDetail = {
  id: string;
  gross: number;
  promoDiscount: number;
  manualDiscount: number;
  net: number;
  /** حصة هذا السطر من إجمالي الخدمة (للعرض) */
  serviceShare: number;
  /** حصة تقديرية من VAT للسطر (للعرض؛ المجموع قد يختلف بفضل التقريب) */
  vatShare: number;
};

export type PosTotalsResult = {
  sumGross: number;
  sumPromoDiscount: number;
  sumManualDiscount: number;
  sumNet: number;
  /** قاعدة الخدمة = مجموع صافي الأسطر غير المستثناة */
  eligibleNetForService: number;
  serviceCharge: number;
  vatValue: number;
  total: number;
  lineDetails: LineTotalsDetail[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** صافي سطر واحد بعد خصم العرض ثم الخصم اليدوي (نسبة ثم قيمة على المتبقي). */
export function netForLine(line: PosLineInput): number {
  const g = Math.max(0, line.gross);
  const afterPromo = Math.max(0, g - Math.max(0, line.promoDiscount));
  const pctPart = (afterPromo * Math.max(0, line.manualDiscountPercent)) / 100;
  const manual = Math.max(0, line.manualDiscountAmount) + pctPart;
  return round2(Math.max(0, afterPromo - Math.min(manual, afterPromo)));
}

/**
 * - الخدمة: فقط orderType === table و orderFinalized، على مجموع صافي الأسطر غير المستثناة.
 * - VAT: إذا serviceBeforeVat: (sumNet + serviceCharge) * vat% / 100. وإلا: sumNet * vat% / 100 (أقدم سلوكاً احتياطياً).
 */
export function computePosTotals(p: PosTotalsParams): PosTotalsResult {
  const details: LineTotalsDetail[] = [];
  let sumGross = 0;
  let sumPromo = 0;
  let sumManual = 0;
  let sumNet = 0;
  let eligibleNet = 0;

  for (const line of p.lines) {
    const g = Math.max(0, line.gross);
    const afterPromo = Math.max(0, g - Math.max(0, line.promoDiscount));
    const pctPart = (afterPromo * Math.max(0, line.manualDiscountPercent)) / 100;
    const manualRaw = Math.max(0, line.manualDiscountAmount) + pctPart;
    const manual = Math.min(manualRaw, afterPromo);
    const net = round2(Math.max(0, afterPromo - manual));

    sumGross += g;
    sumPromo += Math.max(0, line.promoDiscount);
    sumManual += manual;
    sumNet += net;
    if (!line.excludeServiceCharge) {
      eligibleNet += net;
    }

    details.push({
      id: line.id,
      gross: round2(g),
      promoDiscount: round2(Math.max(0, line.promoDiscount)),
      manualDiscount: round2(manual),
      net,
      serviceShare: 0,
      vatShare: 0,
    });
  }

  sumGross = round2(sumGross);
  sumPromo = round2(sumPromo);
  sumManual = round2(sumManual);
  sumNet = round2(sumNet);
  eligibleNet = round2(eligibleNet);

  const dineIn = p.orderType === "table";
  const applyService = dineIn && p.orderFinalized && eligibleNet > 0 && p.servicePercent > 0;
  const serviceCharge = applyService ? round2((eligibleNet * p.servicePercent) / 100) : 0;

  let vatValue: number;
  if (p.serviceBeforeVat) {
    vatValue = round2(((sumNet + serviceCharge) * p.vatPercent) / 100);
  } else {
    vatValue = round2((sumNet * p.vatPercent) / 100);
  }

  const total = round2(Math.max(0, sumNet + serviceCharge + vatValue));

  const taxableForVat = p.serviceBeforeVat ? sumNet + serviceCharge : sumNet;
  for (let i = 0; i < details.length; i++) {
    const line = p.lines[i];
    const net = details[i].net;
    let svc = 0;
    if (applyService && !line.excludeServiceCharge && eligibleNet > 0) {
      svc = round2(serviceCharge * (net / eligibleNet));
    }
    details[i].serviceShare = svc;
    let vShare = 0;
    if (taxableForVat > 0) {
      const lineTaxable = p.serviceBeforeVat ? net + svc : net;
      vShare = round2((vatValue * lineTaxable) / taxableForVat);
    }
    details[i].vatShare = vShare;
  }

  return {
    sumGross,
    sumPromoDiscount: sumPromo,
    sumManualDiscount: sumManual,
    sumNet,
    eligibleNetForService: eligibleNet,
    serviceCharge,
    vatValue,
    total,
    lineDetails: details,
  };
}
