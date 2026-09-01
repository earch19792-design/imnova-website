import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("home exposes exactly four compact operational blocks and demotes legacy", () => {
  const home = read("app/admin/page.tsx")
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  assert.equal((dashboard.match(/data-dashboard-block=/g) ?? []).length, 4)
  assert.match(dashboard, /data-primary-dashboard-block-count="4"/)
  assert.match(dashboard, /md:grid-cols-2/)
  assert.match(dashboard, /Pega uno o varios links Luna/)
  assert.match(dashboard, /"Procesar"/)
  assert.match(dashboard, /Listings LIVE que requieren atención/)
  assert.doesNotMatch(home, /TodayLaunchPanel|Ciclo de revisión|piloto 3\/3/i)
  assert.match(home, /Owner \/ Sistema \/ Herramientas técnicas/)
})

test("primary navigation is touch-first and has five commercial destinations", () => {
  const navigation = read("lib/seller-os/navigation.ts")
  const mobile = read("app/admin/ebay/components/seller-os-mobile-nav.tsx")
  const desktop = read("app/admin/ebay/components/seller-os-desktop-navigation.tsx")
  for (const id of ["monitor", "quick-pick", "opportunities", "listings",
    "experiments"]) assert.match(navigation, new RegExp(`id: "${id}"`))
  assert.match(mobile, /min-h-16/)
  assert.match(desktop, /min-h-11/)
  assert.match(desktop, /SELLER_OS_PRIMARY_NAVIGATION\.map/)
})

test("shared admin shell hosts one existing owner worker without an iframe", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const layout = read("app/admin/layout.tsx")
  const provider = read("app/admin/admin-owner-runtime-provider.tsx")
  const worker = read(
    "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
  )
  assert.match(layout, /AdminOwnerRuntimeProvider/)
  assert.match(provider, /LunaShippingCaptureControlPlane runtimeOnly/)
  assert.match(provider, /luna-shipping-capture/)
  assert.doesNotMatch(dashboard, /<iframe|dashboardWorker=1/)
  assert.match(worker, /onWorkerSnapshot\?\./)
  assert.match(worker, /autoClaimEnabled: true/)
  assert.match(worker, /startInitialProductionClaim/)
  assert.match(worker, /loadJobs\(undefined, "AUTO"\)/)
  assert.match(provider, /quickPickReconciliationActive/)
  assert.match(provider, /2_500/)
  assert.match(provider, /quickPickCards/)
  assert.match(provider, /quickPickReceipt/)
})

test("Dashboard renders durable Quick Pick receipt and operations inline", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const provider = read("app/admin/admin-owner-runtime-provider.tsx")
  const quickPick = read("lib/ebay/ebay-luna-quick-pick-v1.ts")
  for (const label of ["Recibidos", "Materializados", "No comprobados",
    "Trabajando", "Bloqueados", "Listos", "Receipt"])
    assert.match(dashboard, new RegExp(label))
  for (const stage of ["Identidad", "Duplicado", "Stock", "Demanda",
    "Shipping", "Economics", "Product Truth", "Marketplace prep",
    "Required specifics", "Marketplace readiness", "Ready"])
    assert.match(dashboard, new RegExp(stage))
  assert.match(dashboard, /data-quick-pick-inline-operation-view/)
  assert.match(dashboard, /data-quick-pick-inline-card/)
  assert.match(dashboard, /Detalles técnicos opcionales/)
  assert.doesNotMatch(dashboard, />Ver detalle</)
  assert.match(provider, /parseOwnerRuntimeQuickPickCard/)
  assert.match(provider, /parseOwnerRuntimeQuickPickReceipt/)
  assert.match(quickPick, /unprovenInputCount/)
})

test("compact health vocabulary is bounded and server automations stay independent", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  for (const label of ["LUNA_SHIPPING_WORKER", "STOCK_GUARD", "NIGHT_RADAR",
    "ANALYTICS", "ORDERS"]) assert.match(dashboard, new RegExp(label))
  for (const status of ["CONNECTING", "READY", "WORKING", "WAITING",
    "DEGRADED", "OFFLINE"])
    assert.match(dashboard, new RegExp(`"${status}"`))
  assert.doesNotMatch(dashboard, /api\/admin\/ebay\/.*(?:cron|schedule)/)
})

test("home exposes commercial metrics and canonical stock freshness without false zero", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const health = read("lib/ebay/seller-os-dashboard-commercial-health-v1.ts")
  for (const label of ["Activos", "Impresiones", "Vistas", "CTR", "Vendidos",
    "Órdenes"]) assert.match(dashboard, new RegExp(label))
  assert.match(dashboard, /Última lectura válida/)
  assert.match(dashboard, /data-stock-freshness-summary/)
  assert.match(dashboard, /FRESH/)
  assert.match(dashboard, /STALE/)
  assert.match(dashboard, /UNKNOWN/)
  assert.match(dashboard, /RISKS/)
  assert.match(health,
    /OFFICIAL_EBAY_CURRENT_LIVE_INTERSECT_CERTIFIED_LINKAGES/)
  assert.match(health, /analyticsReconciliationAffectsHealth: false/)
  assert.match(health, /falseZero: false/)
})

test("dedicated preprod can read dashboard health while commercial writes stay blocked", () => {
  const route = read("app/api/admin/ebay/commercial-monitor/route.ts")
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const health = read("lib/ebay/seller-os-dashboard-commercial-health-v1.ts")
  assert.match(route, /function dashboardHealthReadBlocked\(\)/)
  assert.match(route, /getEbayProRuntimeBoundary\(\{/)
  assert.match(route, /method: "GET"/)
  assert.match(route, /\}\)\.isProductionRuntime/)
  assert.match(route, /if \(dashboardHealthReadBlocked\(\)\)/)
  assert.match(route, /export async function POST/)
  assert.match(route, /if \(productionBlocked\(\)\)/)
  assert.match(route, /dashboardHealthOnly/)
  assert.match(dashboard, /commercial-monitor\?dashboardHealthOnly=1/)
  assert.match(health, /readCommercialSnapshots\(input\.supabase, input\.accountKey,/)
  assert.match(health, /receipt\.itemIds/)
})
