import type { SessionUser } from "./AuthContext";
import { ROLE_LABELS, type RoleId } from "./roles";

function decodeUnicodeMarkers(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/U\+([0-9a-fA-F]{4,6})/g, (_m, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _m;
      }
    });
}

function tryDecodeUtf8Bytes(value: string): string {
  const chars = Array.from(value);
  if (!chars.length) return value;
  const bytes = new Uint8Array(chars.map((ch) => ch.charCodeAt(0) & 0xff));
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return value;
  }
}

function textArabicRepairScore(value: string): number {
  const arabic = (value.match(/[\u0600-\u06FF]/g) || []).length;
  const mojibake = (value.match(/[ØÙÃÂÐÑÆ]/g) || []).length;
  const qMarks = (value.match(/\?/g) || []).length;
  return arabic * 5 - mojibake * 3 - qMarks * 4;
}

export function repairArabicDisplayText(value: string | null | undefined): string {
  const original = String(value || "").trim();
  if (!original) return "";

  let best = decodeUnicodeMarkers(original);
  let bestScore = textArabicRepairScore(best);
  const suspicious =
    /[ØÙÃÂÐÑÆ]/.test(best) ||
    /\\u[0-9a-fA-F]{4}/.test(original) ||
    /%u[0-9a-fA-F]{4}/.test(original) ||
    /U\+[0-9a-fA-F]{4,6}/.test(original);

  if (!suspicious) return best;

  let candidate = best;
  for (let i = 0; i < 2; i += 1) {
    candidate = tryDecodeUtf8Bytes(candidate).trim();
    const score = textArabicRepairScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** اسم للعرض: يتفادى النصوص التالفة (؟؟؟) ويعتمد login أو الدور عند الحاجة */
export function sessionDisplayName(user: SessionUser | null | undefined): string {
  if (!user) return "";
  const login = (user.login || "").trim();
  const name = repairArabicDisplayText(user.name || "");
  const qCount = (name.match(/\?/g) || []).length;
  const nonSpace = name.replace(/\s/g, "").length;
  const mostlyBroken = nonSpace > 0 && qCount >= 3 && qCount >= nonSpace * 0.45;
  if (!name || mostlyBroken) {
    if (login) return login;
    return ROLE_LABELS[user.role as RoleId] ?? user.role;
  }
  return name;
}
