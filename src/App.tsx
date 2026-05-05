import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { ROLE_ROUTES, type RoleId } from "./auth/roles";
import { AppShell } from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CashflowFrame from "./pages/CashflowFrame";
import CashExpensePage from "./pages/CashExpensePage";
import PurchasesPage from "./pages/PurchasesPage";
import ReportsPage from "./pages/ReportsPage";
import PosPlaceholder from "./pages/PosPlaceholder";
import TablesLayoutPage from "./pages/TablesLayoutPage";
import DeveloperConnection from "./pages/DeveloperConnection";
import DeveloperInitDb from "./pages/DeveloperInitDb";
import DeveloperUsers from "./pages/DeveloperUsers";
import CostingPage from "./pages/CostingPage";
import MasterDataPage from "./pages/MasterDataPage";
import ReceptionPage from "./pages/ReceptionPage";
import KitchenPage from "./pages/KitchenPage";
import SpeedOrderPage from "./pages/SpeedOrderPage";
import RunnerPage from "./pages/RunnerPage";
import WaiterOrderPage from "./pages/WaiterOrderPage";
import WaiterTablesPage from "./pages/WaiterTablesPage";
import ServerTablesPage from "./pages/ServerTablesPage";
import SettingsLayout from "./pages/settings/SettingsLayout";
import VenueFloorSettingsPage from "./pages/settings/VenueFloorSettingsPage";
import MenusDailySettingsPage from "./pages/settings/MenusDailySettingsPage";
import FloorPlanEditorPage from "./pages/settings/FloorPlanEditorPage";
import ProductImagesSettingsPage from "./pages/settings/ProductImagesSettingsPage";
import PriceListSettingsPage from "./pages/settings/PriceListSettingsPage";
import DailyCostEnginePage from "./pages/settings/DailyCostEnginePage";
import CostingModeSettingsPage from "./pages/settings/CostingModeSettingsPage";
import DailyOpeningCustodyPage from "./pages/settings/DailyOpeningCustodyPage";
import DailyReturnPage from "./pages/settings/DailyReturnPage";
import DailyOverheadPage from "./pages/settings/DailyOverheadPage";
import DailyResultPage from "./pages/settings/DailyResultPage";
import KitchenItemStopPage from "./pages/settings/KitchenItemStopPage";
import CashierTableSessionsPage from "./pages/CashierTableSessionsPage";
import CashierInvoicesLocalPage from "./pages/CashierInvoicesLocalPage";
import WorkflowRolesSettingsPage from "./pages/settings/WorkflowRolesSettingsPage";
import RoleScheduleSettingsPage from "./pages/settings/RoleScheduleSettingsPage";
import RestaurantOpsSettingsPage from "./pages/settings/RestaurantOpsSettingsPage";
import PosVenueSettingsPage from "./pages/settings/PosVenueSettingsPage";
import PosKdsSettingsPage from "./pages/settings/PosKdsSettingsPage";
import KdsPrepTimesSettingsPage from "./pages/settings/KdsPrepTimesSettingsPage";
import PosTaxPolicySettingsPage from "./pages/settings/PosTaxPolicySettingsPage";
import PaymentRoutingSettingsPage from "./pages/settings/PaymentRoutingSettingsPage";
import PosPromotionsSettingsPage from "./pages/settings/PosPromotionsSettingsPage";
import KidsAreaPage from "./pages/KidsAreaPage";
import PosAdminPage from "./pages/PosAdminPage";
import CallCenterPage from "./pages/CallCenterPage";

function RequireRole({ role, children }: { role: RoleId; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={ROLE_ROUTES[user.role]} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/app/developer/settings/connection" replace />} />

      <Route
        path="/app/cashier/*"
        element={
          <RequireRole role="cashier">
            <AppShell role="cashier" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="call-center" element={<CallCenterPage />} />
        <Route path="pos" element={<PosPlaceholder />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="cash-expense" element={<CashExpensePage />} />
        <Route path="table-sessions" element={<CashierTableSessionsPage />} />
        <Route path="invoices-local" element={<CashierInvoicesLocalPage />} />
        <Route path="kids-area" element={<KidsAreaPage />} />
      </Route>

      <Route
        path="/app/kids-guard/*"
        element={
          <RequireRole role="kids_guard">
            <AppShell role="kids_guard" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="kids-area" replace />} />
        <Route path="kids-area" element={<KidsAreaPage />} />
      </Route>

      <Route
        path="/app/accountant/*"
        element={
          <RequireRole role="accountant">
            <AppShell role="accountant" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="call-center" element={<CallCenterPage />} />
        <Route path="pos" element={<PosPlaceholder />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="costing" element={<CostingPage />} />
        <Route path="master-data" element={<MasterDataPage />} />
      </Route>

      <Route
        path="/app/manager/*"
        element={
          <RequireRole role="manager">
            <AppShell role="manager" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="captain-tables" element={<WaiterTablesPage />} />
        <Route path="order-taker" element={<WaiterOrderPage />} />
        <Route path="call-center" element={<CallCenterPage />} />
        <Route path="pos" element={<PosPlaceholder />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="cash-expense" element={<CashExpensePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="cashflow" element={<CashflowFrame />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="venue" replace />} />
          <Route path="venue" element={<VenueFloorSettingsPage />} />
          <Route path="floor-editor" element={<FloorPlanEditorPage />} />
          <Route path="tables" element={<TablesLayoutPage />} />
          <Route path="costing" element={<CostingPage />} />
          <Route path="price-lists" element={<PriceListSettingsPage />} />
          <Route path="daily-cost-engine" element={<DailyCostEnginePage />} />
          <Route path="costing-mode" element={<CostingModeSettingsPage />} />
          <Route path="daily-opening-custody" element={<DailyOpeningCustodyPage />} />
          <Route path="daily-return" element={<DailyReturnPage />} />
          <Route path="daily-overhead" element={<DailyOverheadPage />} />
          <Route path="daily-result" element={<DailyResultPage />} />
          <Route path="kitchen-item-stop" element={<KitchenItemStopPage />} />
          <Route path="menus" element={<MenusDailySettingsPage />} />
          <Route path="product-images" element={<ProductImagesSettingsPage />} />
          <Route path="pos" element={<Navigate to="../pos-venue" replace />} />
          <Route path="pos-venue" element={<PosVenueSettingsPage />} />
          <Route path="pos-kds" element={<PosKdsSettingsPage />} />
          <Route path="pos-prep-times" element={<KdsPrepTimesSettingsPage />} />
          <Route path="pos-tax" element={<PosTaxPolicySettingsPage />} />
          <Route path="payment-routing" element={<PaymentRoutingSettingsPage />} />
          <Route path="pos-promos" element={<PosPromotionsSettingsPage />} />
          <Route path="workflow" element={<WorkflowRolesSettingsPage />} />
          <Route path="role-schedule" element={<RoleScheduleSettingsPage />} />
          <Route path="restaurant-ops" element={<RestaurantOpsSettingsPage />} />
          <Route path="master-data" element={<MasterDataPage />} />
          <Route path="connection" element={<Navigate to="venue" replace />} />
          <Route path="init-db" element={<Navigate to="venue" replace />} />
          <Route path="users" element={<Navigate to="venue" replace />} />
        </Route>
        <Route path="tables" element={<Navigate to="settings/tables" replace />} />
        <Route path="costing" element={<Navigate to="settings/costing" replace />} />
        <Route path="master-data" element={<Navigate to="settings/master-data" replace />} />
        <Route path="pos-admin" element={<Navigate to="settings/pos-venue" replace />} />
        <Route path="connection" element={<Navigate to="settings/venue" replace />} />
        <Route path="init-db" element={<Navigate to="settings/venue" replace />} />
        <Route path="users" element={<Navigate to="settings/venue" replace />} />
      </Route>

      <Route
        path="/app/host/*"
        element={
          <RequireRole role="host">
            <AppShell role="host" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="reception" replace />} />
        <Route path="reception" element={<ReceptionPage />} />
        <Route path="tables" element={<Navigate to="/app/host/reception" replace />} />
      </Route>

      <Route
        path="/app/waiter/*"
        element={
          <RequireRole role="waiter">
            <AppShell role="waiter" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="tables" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="tables" element={<WaiterTablesPage />} />
        <Route path="order-taker" element={<WaiterOrderPage />} />
        <Route path="runner" element={<RunnerPage />} />
        <Route path="pos" element={<PosPlaceholder />} />
      </Route>

      <Route
        path="/app/kitchen/*"
        element={
          <RequireRole role="kitchen">
            <AppShell role="kitchen" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="kitchen" replace />} />
        <Route path="kitchen" element={<KitchenPage />} />
        <Route path="kitchen-item-stop" element={<KitchenItemStopPage />} />
      </Route>

      <Route
        path="/app/speed_order/*"
        element={
          <RequireRole role="speed_order">
            <AppShell role="speed_order" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="speed-order" replace />} />
        <Route path="speed-order" element={<SpeedOrderPage />} />
      </Route>

      <Route
        path="/app/server/*"
        element={
          <RequireRole role="server">
            <AppShell role="server" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="runner" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="runner" element={<RunnerPage />} />
        <Route path="tables" element={<ServerTablesPage />} />
      </Route>

      <Route
        path="/app/developer/*"
        element={
          <RequireRole role="developer">
            <AppShell role="developer" />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="captain-tables" element={<WaiterTablesPage />} />
        <Route path="order-taker" element={<WaiterOrderPage />} />
        <Route path="call-center" element={<CallCenterPage />} />
        <Route path="pos" element={<PosPlaceholder />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="cash-expense" element={<CashExpensePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="cashflow" element={<CashflowFrame />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="connection" replace />} />
          <Route path="venue" element={<VenueFloorSettingsPage />} />
          <Route path="floor-editor" element={<FloorPlanEditorPage />} />
          <Route path="tables" element={<TablesLayoutPage />} />
          <Route path="costing" element={<CostingPage />} />
          <Route path="price-lists" element={<PriceListSettingsPage />} />
          <Route path="daily-cost-engine" element={<DailyCostEnginePage />} />
          <Route path="costing-mode" element={<CostingModeSettingsPage />} />
          <Route path="daily-opening-custody" element={<DailyOpeningCustodyPage />} />
          <Route path="daily-return" element={<DailyReturnPage />} />
          <Route path="daily-overhead" element={<DailyOverheadPage />} />
          <Route path="daily-result" element={<DailyResultPage />} />
          <Route path="kitchen-item-stop" element={<KitchenItemStopPage />} />
          <Route path="menus" element={<MenusDailySettingsPage />} />
          <Route path="product-images" element={<ProductImagesSettingsPage />} />
          <Route path="pos" element={<Navigate to="../pos-venue" replace />} />
          <Route path="pos-venue" element={<PosVenueSettingsPage />} />
          <Route path="pos-kds" element={<PosKdsSettingsPage />} />
          <Route path="pos-prep-times" element={<KdsPrepTimesSettingsPage />} />
          <Route path="pos-tax" element={<PosTaxPolicySettingsPage />} />
          <Route path="payment-routing" element={<PaymentRoutingSettingsPage />} />
          <Route path="pos-promos" element={<PosPromotionsSettingsPage />} />
          <Route path="pos-admin-legacy" element={<PosAdminPage />} />
          <Route path="workflow" element={<WorkflowRolesSettingsPage />} />
          <Route path="role-schedule" element={<RoleScheduleSettingsPage />} />
          <Route path="restaurant-ops" element={<RestaurantOpsSettingsPage />} />
          <Route path="master-data" element={<MasterDataPage />} />
          <Route path="connection" element={<DeveloperConnection />} />
          <Route path="init-db" element={<DeveloperInitDb />} />
          <Route path="users" element={<DeveloperUsers />} />
        </Route>
        <Route path="tables" element={<Navigate to="settings/tables" replace />} />
        <Route path="costing" element={<Navigate to="settings/costing" replace />} />
        <Route path="master-data" element={<Navigate to="settings/master-data" replace />} />
        <Route path="pos-admin" element={<Navigate to="settings/pos-venue" replace />} />
        <Route path="connection" element={<Navigate to="settings/connection" replace />} />
        <Route path="init-db" element={<Navigate to="settings/init-db" replace />} />
        <Route path="users" element={<Navigate to="settings/users" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
