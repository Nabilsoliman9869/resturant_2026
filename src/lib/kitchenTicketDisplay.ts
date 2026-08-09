/** تفكيك عرض بند المطبخ: طبق رئيسي + أطباق جانبية + مواصفات على أسطر منفصلة */

export type KitchenTicketLine = {
  kind: "main" | "side" | "cook" | "spec" | "note" | "other";
  label: string;
  value: string;
};

export type KitchenTicketParsed = {
  title: string;
  seatHint: string | null;
  lines: KitchenTicketLine[];
};

type ModifierLike = {
  groupName?: string;
  itemName?: string;
  source?: string;
};

function classifyPart(raw: string): KitchenTicketLine {
  const t = String(raw || "").trim();
  if (!t) return { kind: "other", label: "", value: "" };

  const paired = t.match(/^([^:：]+)[:：]\s*(.+)$/);
  if (paired) {
    const label = paired[1]!.trim();
    const value = paired[2]!.trim();
    const low = `${label} ${value}`.toLowerCase();
    if (/جانب|side|mash|fries|بطاطس|أرز|rice|salad|سلطة/.test(low) || /جانب/.test(label)) {
      return { kind: "side", label: label || "طبق جانبي", value };
    }
    if (/سواء|cook|well|medium|rare|مطهو|درجة|شواء|doneness/.test(low) || /طهي|سواء/.test(label)) {
      return { kind: "cook", label: label || "طريقة الطهي", value };
    }
    if (/ملاحظة|note|notes/.test(label.toLowerCase())) {
      return { kind: "note", label: "ملاحظة", value };
    }
    return { kind: "spec", label, value };
  }

  if (/^بدون\s+/i.test(t) || /^بدون\s+/.test(t)) {
    return { kind: "spec", label: "استبعاد", value: t };
  }
  if (/well\s*done|medium|rare|مطهو|سواء/i.test(t)) {
    return { kind: "cook", label: "طريقة الطهي", value: t };
  }
  if (/mash|بطاطس|جانب|fries|أرز|سلطة|salad/i.test(t)) {
    return { kind: "side", label: "طبق جانبي", value: t };
  }
  return { kind: "note", label: "ملاحظة", value: t };
}

function splitNotesBlob(blob: string): string[] {
  return String(blob || "")
    .split(/\s*[;؛|]\s*|\s*[—–-]\s+(?=[^\s])/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * يبني أسطر العرض من اسم الصنف + ملاحظات/إضافات محفوظة.
 * يدعم الشكل القديم: «برجر (مقعد) — ملاحظة؛ …» أو حقول منفصلة.
 */
export function parseKitchenTicketItem(opts: {
  name?: string | null;
  notes?: string | null;
  kitchenNotes?: string | null;
  modifiers?: ModifierLike[] | null;
}): KitchenTicketParsed {
  let rawName = String(opts.name || "").trim() || "صنف";
  let seatHint: string | null = null;

  const seatParen = rawName.match(/^(.*?)\s*\(([^)]*)\)\s*(?:[—–-].*)?$/);
  if (seatParen) {
    const inside = seatParen[2]!.trim();
    if (/^\d+$/.test(inside) || /مقعد|كرسي|ضيف/i.test(inside)) {
      seatHint = inside;
      // أبقِ الجزء قبل القوس كعنوان مبدئي، ثم انزع الذيل بعد الشرطة إن وُجد
      rawName = seatParen[1]!.trim();
      const tail = String(opts.name || "").replace(/^[^(]*\([^)]*\)\s*/, "").trim();
      if (tail.startsWith("—") || tail.startsWith("–") || tail.startsWith("-")) {
        // notes baked after seat tag
        const baked = tail.replace(/^[—–-]\s*/, "").trim();
        if (baked && !opts.kitchenNotes && !opts.notes) {
          opts = { ...opts, kitchenNotes: baked };
        }
      }
    }
  }

  // اسم + ذيل مدمج بشرطة طويلة دون قوس مقعد
  const dashSplit = rawName.match(/^(.*?)\s+[—–]\s+(.+)$/);
  let title = rawName;
  let bakedNotes = "";
  if (dashSplit && !seatHint) {
    title = dashSplit[1]!.trim();
    bakedNotes = dashSplit[2]!.trim();
  } else if (dashSplit && seatHint) {
    title = dashSplit[1]!.trim() || title;
    bakedNotes = dashSplit[2]!.trim();
  }

  // أزل ذيل مدمج من العنوان إن بقي
  const dash2 = title.match(/^(.*?)\s+[—–-]\s+(.+)$/);
  if (dash2) {
    title = dash2[1]!.trim();
    bakedNotes = [bakedNotes, dash2[2]!.trim()].filter(Boolean).join("؛ ");
  }

  const lines: KitchenTicketLine[] = [];
  lines.push({ kind: "main", label: "الطبق الرئيسي", value: title || "صنف" });

  const mods = Array.isArray(opts.modifiers) ? opts.modifiers : [];
  for (const m of mods) {
    const g = String(m.groupName || "").trim();
    const n = String(m.itemName || "").trim();
    if (!n) continue;
    if (m.source === "free_text" || /ملاحظة|note/i.test(g)) {
      lines.push({ kind: "note", label: g || "ملاحظة", value: n });
      continue;
    }
    const low = `${g} ${n}`.toLowerCase();
    if (/جانب|side/.test(low)) lines.push({ kind: "side", label: g || "طبق جانبي", value: n });
    else if (/سواء|cook|طهي|doneness|شواء/.test(low)) lines.push({ kind: "cook", label: g || "طريقة الطهي", value: n });
    else lines.push({ kind: "spec", label: g || "مواصفة", value: n });
  }

  const noteBlob = [opts.kitchenNotes, opts.notes, bakedNotes].map((x) => String(x || "").trim()).filter(Boolean).join("؛ ");
  for (const part of splitNotesBlob(noteBlob)) {
    // تجنّب تكرار نفس القيمة الموجودة من modifiers
    if (lines.some((ln) => ln.value === part || `${ln.label}: ${ln.value}` === part)) continue;
    const classified = classifyPart(part);
    if (!classified.value) continue;
    if (lines.some((ln) => ln.kind === classified.kind && ln.value === classified.value)) continue;
    lines.push(classified);
  }

  return { title: title || "صنف", seatHint, lines };
}

export function kitchenLineKindLabel(kind: KitchenTicketLine["kind"]): string {
  switch (kind) {
    case "main":
      return "رئيسي";
    case "side":
      return "جانبي";
    case "cook":
      return "طهي";
    case "spec":
      return "مواصفة";
    case "note":
      return "ملاحظة";
    default:
      return "";
  }
}
