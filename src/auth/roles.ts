export type RoleId =
  | "cashier"
  | "accountant"
  | "manager"
  | "operation_manager"
  | "developer"
  | "host"
  | "waiter"
  | "kitchen"
  | "kitchen_specialist"
  | "speed_order"
  | "server"
  | "kids_guard";

export const ROLE_LABELS: Record<RoleId, string> = {
  cashier: "كاشير",
  accountant: "محاسب",
  manager: "مدير",
  operation_manager: "مدير تشغيل",
  developer: "مطوّر",
  host: "جارسون الاستقبال",
  waiter: "جارسون الطلبات",
  kitchen: "مطبخ",
  kitchen_specialist: "شيف مختص",
  speed_order: "الطلبات السريعة",
  server: "جارسون المناولة",
  kids_guard: "كيدز إيريا",
};

export const ROLE_ROUTES: Record<RoleId, string> = {
  cashier: "/app/cashier",
  accountant: "/app/accountant",
  manager: "/app/manager",
  operation_manager: "/app/operation_manager",
  developer: "/app/developer",
  host: "/app/host",
  waiter: "/app/waiter/tables",
  kitchen: "/app/kitchen",
  kitchen_specialist: "/app/kitchen_specialist",
  speed_order: "/app/speed_order",
  server: "/app/server",
  kids_guard: "/app/kids-guard",
};

export function roleHasManagerOpsAccess(role: RoleId | string | null | undefined): boolean {
  const value = String(role || "").trim().toLowerCase();
  return value === "manager" || value === "developer" || value === "operation_manager";
}

export function roleHasSystemSettingsAccess(role: RoleId | string | null | undefined): boolean {
  const value = String(role || "").trim().toLowerCase();
  return value === "manager" || value === "developer";
}
