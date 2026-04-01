export type RoleId =
  | "cashier"
  | "accountant"
  | "manager"
  | "developer"
  | "host"
  | "waiter"
  | "kitchen"
  | "server";

export const ROLE_LABELS: Record<RoleId, string> = {
  cashier: "كاشير",
  accountant: "محاسب",
  manager: "مدير",
  developer: "مطوّر",
  host: "جارسون الاستقبال",
  waiter: "جارسون الطلبات",
  kitchen: "مطبخ",
  server: "جارسون المناولة",
};

export const ROLE_ROUTES: Record<RoleId, string> = {
  cashier: "/app/cashier",
  accountant: "/app/accountant",
  manager: "/app/manager",
  developer: "/app/developer",
  host: "/app/host",
  waiter: "/app/waiter",
  kitchen: "/app/kitchen",
  server: "/app/server",
};
