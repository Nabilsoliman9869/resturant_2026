import type { RoleId } from "../auth/roles";

/** أدوار معفاة من overlay PIN — للتهيئة وإعداد الاتصال دون حظر. */
const PIN_EXEMPT_ROLES: ReadonlySet<RoleId> = new Set(["developer"]);

export function isSharedTerminalPinExempt(role: string | null | undefined): boolean {
  const r = (role || "").toLowerCase() as RoleId;
  return PIN_EXEMPT_ROLES.has(r);
}
