import type { SessionUser } from "./AuthContext";
import { ROLE_LABELS, type RoleId } from "./roles";

/** اسم للعرض: يتفادى النصوص التالفة (؟؟؟) ويعتمد login أو الدور عند الحاجة */
export function sessionDisplayName(user: SessionUser | null | undefined): string {
  if (!user) return "";
  const login = (user.login || "").trim();
  const name = (user.name || "").trim();
  const qCount = (name.match(/\?/g) || []).length;
  const nonSpace = name.replace(/\s/g, "").length;
  const mostlyBroken = nonSpace > 0 && qCount >= 3 && qCount >= nonSpace * 0.45;
  if (!name || mostlyBroken) {
    if (login) return login;
    return ROLE_LABELS[user.role as RoleId] ?? user.role;
  }
  return name;
}
