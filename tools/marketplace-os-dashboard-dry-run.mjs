import {
  buildMarketplaceOsDashboardViewModel,
  summarizeMarketplaceOsDashboard,
} from "../lib/marketplace/marketplace-os-dashboard-view-model.ts";

const viewModel =
  buildMarketplaceOsDashboardViewModel();
const summary =
  summarizeMarketplaceOsDashboard(viewModel);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
