export type RoleId =
  | "cashier"
  | "accountant"
  | "manager"
  | "developer"
  | "host"
  | "waiter"
  | "kitchen"
  | "speed_order"
  | "server"
  | "kids_guard";

export const ROLE_LABELS: Record<RoleId, string> = {
  cashier: "كاشير",
  accountant: "محاسب",
  manager: "مدير",
  developer: "مطوّر",
  host: "جارسون الاستقبال",
  waiter: "جارسون الطلبات",
  kitchen: "مطبخ",
  speed_order: "الطلبات السريعة",
  server: "جارسون المناولة",
  kids_guard: "كيدز إيريا",
};

export const ROLE_ROUTES: Record<RoleId, string> = {
  cashier: "/app/cashier",
  accountant: "/app/accountant",
  manager: "/app/manager",
  developer: "/app/developer",
  host: "/app/host",
  waiter: "/app/waiter/tables",
  kitchen: "/app/kitchen",
  speed_order: "/app/speed_order",
  server: "/app/server",
  kids_guard: "/app/kids-guard",
};
