import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("home exposes attention-first sections and demotes legacy", () => {
  const home = read("app/admin/page.tsx")
  const dashboard = read("app/admin/seller-os-home-dashboard-v1.tsx")
  for (const label of ["Próxima acción", "Publicación", "Negocio LIVE",
    "Mayel", "Estado operativo"]) assert.match(dashboard, new RegExp(label))
  assert.match(dashboard, /data-home-read-only="true"/)
  assert.match(dashboard, /data-get-business-mutations="0"/)
  assert.match(dashboard, /FAILED_PHYSICAL_ACCEPTANCE/)
  assert.doesNotMatch(dashboard, /method:\s*"POST"/)
  assert.doesNotMatch(home, /TodayLaunchPanel|Ciclo de revisión|piloto 3\/3/i)
  assert.doesNotMatch(home, /SHA|digest|TRACE_ID|versión de extensión/i)
})

test("navigation is touch-first with seven primary and three System areas", () => {
  const navigation = read("lib/seller-os/navigation.ts")
  const mobile = read("app/admin/ebay/components/seller-os-mobile-nav.tsx")
  const desktop = read("app/admin/ebay/components/seller-os-desktop-navigation.tsx")
  for (const id of ["home", "publish", "opportunities", "live", "sales",
    "post-sale", "mayel", "stockguard", "administration", "experiments"])
    assert.match(navigation, new RegExp(`id: "${id}"`))
  assert.doesNotMatch(navigation, /label: "Quick Pick"/)
  assert.match(navigation, /label: "Preparar productos"/)
  assert.match(mobile, /min-h-16/)
  assert.match(desktop, /min-h-11/)
  assert.match(desktop,
    /NavigationGroup label="Operación" items=\{SELLER_OS_PRIMARY_NAVIGATION\}/)
})

test("shared admin shell is read-only and the dedicated route owns Luna", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const layout = read("app/admin/layout.tsx")
  const provider = read("app/admin/admin-owner-runtime-provider.tsx")
  const worker = read(
    "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx",
  )
  assert.match(layout, /AdminOwnerRuntimeProvider/)
  assert.doesNotMatch(provider, /<LunaShippingCaptureControlPlane/)
  assert.match(provider, /global owner shell must remain presentation-only/)
  assert.doesNotMatch(dashboard, /<iframe|dashboardWorker=1/)
  assert.match(worker, /onWorkerSnapshot\?\./)
  assert.match(worker, /const productionRuntimeAuthorized = runtimeOnly \|\|/)
  assert.match(worker, /params\.get\("bridgeOnly"\) === "1"/)
  assert.match(worker, /setAutoClaimEnabled\(productionRuntimeAuthorized\)/)
  assert.match(worker, /attemptProductionAcquisition/)
  assert.match(worker, /scheduleProductionAcquisition/)
  assert.match(worker, /loadJobs\(undefined, "AUTO"\)/)
  assert.match(provider, /quickPickReconciliationActive/)
  assert.doesNotMatch(provider, /setInterval/)
  assert.match(provider, /quickPickCards/)
  assert.match(provider, /quickPickReceipt/)
})

test("Dashboard renders durable Quick Pick receipt and operations inline", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const provider = read("app/admin/admin-owner-runtime-provider.tsx")
  const quickPick = read("lib/ebay/ebay-luna-quick-pick-v1.ts")
  for (const label of ["Recibidos", "Materializados", "No comprobados",
    "Trabajando", "Bloqueados", "Listos"])
    assert.match(dashboard, new RegExp(label))
  assert.match(dashboard, /LOTE RECIBIDO/)
  assert.match(dashboard, /grid-cols-2[^\n]*sm:grid-cols-3/)
  assert.doesNotMatch(dashboard, /lg:grid-cols-7/)
  const stages = read("lib/ebay/seller-os-quick-pick-owner-read-model-v1.ts")
  for (const stage of ["Producto identificado",
    "Comprobando si ya está publicado", "Stock disponible",
    "Buscando demanda", "Calculando envío", "Comprobando margen",
    "Verificando producto exacto", "Preparando eBay",
    "Comprobando datos requeridos", "Comprobando requisitos eBay",
    "Listo para decisión owner"])
    assert.match(stages, new RegExp(stage))
  assert.match(dashboard, /data-quick-pick-inline-operation-view/)
  assert.match(dashboard, /data-quick-pick-inline-card/)
  assert.match(dashboard, /Detalles técnicos opcionales/)
  assert.doesNotMatch(dashboard, />Ver detalle</)
  assert.match(provider, /parseOwnerRuntimeQuickPickCard/)
  assert.match(provider, /parseOwnerRuntimeQuickPickReceipt/)
  assert.match(provider, /mergeOwnerRuntimeQuickPickCards/)
  assert.match(provider, /opportunityId/)
  assert.match(provider, /lunaProductId/)
  assert.match(provider, /lunaVariantId/)
  assert.match(quickPick, /unprovenInputCount/)
})

test("Quick Pick preserves last stable authority and exposes complete durable blockers", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const provider = read("app/admin/admin-owner-runtime-provider.tsx")
  const route = read("app/api/admin/ebay/luna-quick-pick/route.ts")
  const quickPick = read("lib/ebay/ebay-luna-quick-pick-v1.ts")
  assert.match(provider, /quickPickReadState/)
  assert.match(provider, /"READ_FAILED"/)
  assert.match(provider, /if \(quickPickRequest\.current\)/)
  assert.match(provider, /if \(receipt\) setQuickPickReceipt\(receipt\)/)
  assert.doesNotMatch(provider,
    /catch\(\(\) => \{\s*if \(active\) setQuickPickAvailable\(false\)/)
  assert.match(dashboard, /última lectura confirmada/)
  assert.match(dashboard, /data-quick-pick-commercial-blockers/)
  assert.match(dashboard, /data-quick-pick-durable-readiness-summary/)
  assert.match(quickPick, /exactBlockers/)
  assert.match(quickPick, /unresolvedRequiredAspects/)
  assert.match(quickPick, /conditionReady/)
  assert.match(quickPick, /projectedLastStage/)
  assert.match(route, /mergeSellerOsQuickPickPresentationV1/)
})

test("compact health vocabulary is bounded and server automations stay independent", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  for (const label of ["LUNA_SHIPPING_WORKER", "STOCK_GUARD", "NIGHT_RADAR",
    "ANALYTICS", "ORDERS"]) assert.match(dashboard, new RegExp(label))
  for (const status of ["CONNECTING", "READY", "WORKING", "WAITING",
    "DEGRADED", "OFFLINE", "WORKER_AVAILABLE", "WORK_PENDING",
    "IDLE_NO_PENDING_WORK", "BLOCKED"])
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
  assert.match(dashboard, /REFRESH DUE/)
  assert.match(dashboard, /UNKNOWN/)
  assert.match(dashboard, /PROVEN RISKS/)
  assert.match(dashboard, /if \(stale! > 0\) return "WAITING"/)
  assert.match(dashboard, /risks! > 0 \|\| unknown! > 0/)
  assert.match(health,
    /OFFICIAL_EBAY_CURRENT_LIVE_INTERSECT_CERTIFIED_LINKAGES/)
  assert.match(health, /analyticsReconciliationAffectsHealth: false/)
  assert.match(health, /falseZero: false/)
})

test("home exposes canonical post-sale readiness without treating historical skips as failures", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const health = read("lib/ebay/seller-os-dashboard-commercial-health-v1.ts")
  const runtime = read("lib/ebay/ebay-seller-os-assistant-runtime.ts")
  assert.match(dashboard, /data-dashboard-post-sale-automation-observability/)
  assert.match(dashboard, /Detección de ventas/)
  assert.match(dashboard, /WhatsApp al owner/)
  assert.match(dashboard, /Gracias al comprador/)
  assert.match(dashboard, /ARMADO · esperando próxima venta/)
  assert.match(dashboard, /sólo ENVIADO implica un receipt real/)
  assert.match(health, /historicalReplayNotShownAsFailure: true/)
  assert.match(health, /historicalReplayNotSent:/)
  assert.match(health, /officialLineItemQuantity/)
  assert.match(runtime, /collectSellerOsPostSaleDashboardStatusV1/)
  assert.match(runtime, /sharedOfficialOrdersRead: true/)
})

test("Dashboard health preserves stable authority through transient fetch failures", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  assert.match(dashboard, /setSnapshot\(\(previous\) =>/)
  assert.match(dashboard, /commercialAuthoritative/)
  assert.match(dashboard, /radarAuthoritative/)
  assert.match(dashboard, /READ_RETRYING/)
  assert.match(dashboard, /mantengo el último estado válido/)
  assert.match(dashboard, /sourceStatus === "AVAILABLE"\) return "READY"/)
  assert.match(dashboard, /ordersDashboardStatus\(orderHealth, previous\.orders\)/)
  assert.doesNotMatch(dashboard,
    /commercialResult\.status === "rejected" \? "DEGRADED"/)
  assert.doesNotMatch(dashboard,
    /radarResult\.status === "rejected" \? "DEGRADED"/)
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
  assert.match(health, /currentLiveAuthority\.currentItemIds/)
  assert.match(health, /currentLiveAuthority\.lastCertifiedItemIds/)
})
