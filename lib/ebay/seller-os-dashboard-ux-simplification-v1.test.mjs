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

test("dashboard hosts existing worker and accepts only a same-origin safe projection", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const worker = read("app/admin/ebay/luna-shipping-capture/page.tsx")
  assert.match(dashboard, /luna-shipping-capture\?dashboardWorker=1/)
  assert.match(dashboard, /event\.origin !== window\.location\.origin/)
  assert.match(dashboard,
    /event\.source !== workerFrame\.current\?\.contentWindow/)
  assert.match(worker, /SELLER_OS_LUNA_WORKER_STATUS_V1/)
  assert.match(worker, /autoClaimEnabled: true/)
  assert.match(worker, /startInitialProductionClaim/)
  assert.match(worker, /loadJobs\(undefined, "AUTO"\)/)
  const projectionStart = worker.indexOf("window.parent.postMessage")
  const projectionEnd = worker.indexOf("}, window.location.origin)",
    projectionStart) + "}, window.location.origin)".length
  const projection = worker.slice(projectionStart, projectionEnd)
  assert.doesNotMatch(projection, /trace|hash|cookie|token|address/i)
})

test("compact health vocabulary is bounded and server automations stay independent", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  for (const label of ["LUNA_SHIPPING_WORKER", "STOCK_GUARD", "NIGHT_RADAR",
    "ANALYTICS", "ORDERS"]) assert.match(dashboard, new RegExp(label))
  for (const status of ["READY", "WORKING", "WAITING", "DEGRADED", "OFFLINE"])
    assert.match(dashboard, new RegExp(`"${status}"`))
  assert.doesNotMatch(dashboard, /api\/admin\/ebay\/.*(?:cron|schedule)/)
})
