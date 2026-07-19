const fs = require("fs");
const path = require("path");

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function between(text, startNeedle, endNeedle, label) {
  const start = text.indexOf(startNeedle);
  const end = text.indexOf(endNeedle);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Cannot isolate ${label}`);
  }
  return text.slice(start, end);
}

function assertIncludes(text, values, label) {
  for (const value of values) {
    if (!text.includes(value)) {
      throw new Error(`Missing in ${label}: ${value}`);
    }
  }
}

function assertExcludes(text, values, label) {
  for (const value of values) {
    if (text.includes(value)) {
      throw new Error(`Forbidden in ${label}: ${value}`);
    }
  }
}

function run() {
  const appTsx = read("src/App.tsx");
  const shellTsx = read("src/components/AppShell.tsx");
  const settingsTsx = read("src/pages/settings/SettingsLayout.tsx");

  const appBlock = between(
    appTsx,
    'path="/app/operation_manager/*"',
    'path="/app/host/*"',
    "operation manager route tree"
  );

  const requiredRoutes = [
    'Route path="dashboard"',
    'Route path="captain-tables"',
    'Route path="order-taker"',
    'Route path="manager-approvals"',
    'Route path="guest-returns"',
    'Route path="call-center"',
    'Route path="delivery-management"',
    'Route path="pos"',
    'Route path="purchases"',
    'Route path="cash-expense"',
    'Route path="cashflow"',
    'Route path="reports"',
    'Route path="flash-report"',
    'Route path="table-sessions-report"',
    'Route path="menus"',
    'Route path="minimum-charge"',
    'Route path="kitchen-item-stop"',
    'Route path="kitchen-ops"'
  ];

  const forbiddenTechRoutes = [
    'Route path="connection"',
    'Route path="init-db"',
    'Route path="users"'
  ];

  assertIncludes(appBlock, requiredRoutes, "App.tsx operation_manager routes");
  assertExcludes(appBlock, forbiddenTechRoutes, "App.tsx operation_manager routes");

  const navBlock = between(
    shellTsx,
    "operation_manager: [",
    "  host: [",
    "operation manager nav"
  );

  const requiredNav = [
    'to: "dashboard"',
    'to: "captain-tables"',
    'to: "order-taker"',
    'to: "manager-approvals"',
    'to: "guest-returns"',
    'to: "settings"',
    'to: "pos"',
    'to: "purchases"',
    'to: "cash-expense"',
    'to: "cashflow"',
    'to: "reports"',
    'to: "flash-report"',
    'to: "table-sessions-report"'
  ];

  const requiredOpsSection = ['title: "4. التشغيل المالي"'];

  const forbiddenNav = ['to: "connection"', 'to: "init-db"', 'to: "users"'];

  assertIncludes(navBlock, requiredNav, "AppShell operation_manager nav");
  assertIncludes(shellTsx, requiredOpsSection, "AppShell operation_manager sections");
  assertExcludes(navBlock, forbiddenNav, "AppShell operation_manager nav");

  const settingsBlock = between(
    settingsTsx,
    'if (role === "operation_manager") {',
    'if (roleHasSystemSettingsAccess(role)) {',
    "operation manager settings"
  );

  const requiredSettings = [
    'to: "menus"',
    'to: "minimum-charge"',
    'to: "kitchen-item-stop"',
    'to: "kitchen-ops"',
    'to: `${roleBase}/reports`',
    'to: `${roleBase}/flash-report`',
    'to: `${roleBase}/table-sessions-report`',
    'to: `${roleBase}/pos`',
    'to: `${roleBase}/purchases`',
    'to: `${roleBase}/cash-expense`',
    'to: `${roleBase}/cashflow`'
  ];

  const requiredDailyCostsSection = ['title: "5. التكاليف اليومية"'];
  const forbiddenSettings = ['to: "connection"', 'to: "init-db"', 'to: "users"'];

  assertIncludes(settingsBlock, requiredSettings, "SettingsLayout operation_manager block");
  assertIncludes(settingsBlock, requiredDailyCostsSection, "SettingsLayout operation_manager sections");
  assertExcludes(settingsBlock, forbiddenSettings, "SettingsLayout operation_manager block");

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        checked: {
          requiredRoutes: requiredRoutes.length,
          forbiddenRoutes: forbiddenTechRoutes.length,
          requiredNav: requiredNav.length,
          forbiddenNav: forbiddenNav.length,
          requiredSettings: requiredSettings.length,
          forbiddenSettings: forbiddenSettings.length
        }
      },
      null,
      2
    )
  );
}

try {
  run();
} catch (error) {
  console.error("POLICY_CHECK_FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
