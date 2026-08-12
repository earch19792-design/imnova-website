import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const dashboard = readFileSync(
  new URL("./commercial-monitor-canonical-dashboard.tsx", import.meta.url),
  "utf8",
)
const client = readFileSync(
  new URL("./commercial-monitor-readonly-client.tsx", import.meta.url),
  "utf8",
)

test("canonical dashboard consumes backend DTO states without synthetic KPI fallbacks", () => {
  for (const expression of [
    "backend.kpis.activeListings.value",
    "backend.kpis.impressions.value",
    "backend.kpis.ebayViews.value",
    "backend.kpis.averageCtr.value",
    "backend.kpis.quantitySold.value",
    "backend.kpis.orders.value",
    "UNAVAILABLE_AUTH_PENDING",
    "UNAVAILABLE_NO_CURRENT_REPORT",
    "backend.capabilities.inventory.inventoryItemsResource",
    "DEGRADED",
    "PARTIAL_CERTIFIED",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /value === null \? "—"/)
  assert.match(dashboard, /No current report/)
  assert.match(dashboard, /No se generan puntos sintéticos/)
  assert.match(dashboard, /No se inventan benchmarks Top-10%/)
  assert.match(dashboard, /suffix="%"/)
  assert.match(dashboard, /TRANSACTION · not orders/)
  assert.match(dashboard, /backend\.trafficScopes\.accountTraffic/)
})

test("canonical dashboard surfaces decisions and review-only Registry state without write controls", () => {
  for (const expression of [
    "VISIBILITY",
    "CTR",
    "CONVERSION",
    "DATA_QUALITY",
    "HEALTHY_WAIT",
    "eBay guidance vs Seller OS",
    "Priority action plan",
    "Upcoming reviews",
    "Human Review",
    "DO NOT TOUCH",
    "Experiments",
    "0 marketplace writes · 0 Registry writes",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.doesNotMatch(
    dashboard,
    /fetch\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)["']|ReviseItem|EndItem|publishOffer/,
  )
  assert.equal((dashboard.match(/onClick=/g) ?? []).length, 1)
  assert.match(dashboard, /onClick=\{onRefresh\}/)
  assert.match(dashboard, /renderedCriticalAlerts\.length/)
  assert.match(dashboard, /priorityActionPlan/)
})

test("canonical dashboard preserves the dense desktop cockpit composition", () => {
  for (const expression of [
    "w-\\[200px\\]",
    "eBay Commercial Monitor",
    "Cockpit operativo, diagnóstico y decisiones basadas en datos",
    "EBAY GUIDANCE",
    "Listings Activos",
    "Experimentos RUNNING",
    "grid-cols-\\[minmax\\(0,1fr\\)_288px\\]",
    "Alertas críticas",
    "Plan de acción prioritario",
    "System 100% read-only",
    "Rendimiento general",
    "Distribución por estado",
    "Distribución por tipo",
    "Benchmark categoría",
    "Account traffic",
    "Current live portfolio",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /liveRows\.map/)
  assert.match(dashboard, /table-fixed/)
  assert.match(dashboard, /identity\.primaryImageUrl/)
  assert.doesNotMatch(dashboard, /min-w-\[820px\]|overflow-x-auto/)
  assert.match(dashboard, /No se generan puntos sintéticos/)
})

test("legacy technical diagnostics remain secondary to the canonical dashboard", () => {
  assert.match(client, /CommercialMonitorCanonicalDashboard/)
  assert.match(client, /<details id="advanced-diagnostics"/)
  assert.match(client, /Diagnóstico técnico avanzado/)
  assert.doesNotMatch(client, /Estado comercial verificable, sin ejecutar cambios/)
  assert.match(client, /SellerOsMobileNav active="operations" hideOnDesktop/)
})

test("live Trading rows remain visible when Quality Report is unavailable", () => {
  assert.match(dashboard, /const liveRows = backend\.decisions\.flatMap/)
  assert.match(dashboard, /qualityUnavailable \? <>/)
  assert.match(dashboard, /No current report/)
  assert.match(dashboard, /ImageOff/)
  assert.match(dashboard, /key=\{listing\.identity\.itemId\}/)
  assert.match(dashboard, /decision\.experimentRunning/)
  assert.match(dashboard, /decision\.frozenVariables/)
})
