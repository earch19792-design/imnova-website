import {
  MarketplaceOsDashboard,
} from "@/components/marketplace/marketplace-os-dashboard"
import {
  buildMarketplaceOsDashboardViewModel,
} from "@/lib/marketplace/marketplace-os-dashboard-view-model"

export default function MarketplaceOsPage() {
  const viewModel =
    buildMarketplaceOsDashboardViewModel()

  return (
    <MarketplaceOsDashboard viewModel={viewModel} />
  )
}
