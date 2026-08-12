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
  assert.match(dashboard, /No current Listing Quality Report available\./)
  assert.match(dashboard, /No se generan puntos sintéticos/)
  assert.match(dashboard, /No se inventan benchmarks Top-10%/)
  assert.match(dashboard, /suffix="%"/)
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
    "0 marketplace writes · 0 Registry writes",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.doesNotMatch(
    dashboard,
    /onClick=|fetch\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)["']|ReviseItem|EndItem|publishOffer/,
  )
  assert.match(dashboard, /renderedCriticalAlerts\.length/)
  assert.match(dashboard, /priorityActionPlan/)
})

test("legacy technical diagnostics remain secondary to the canonical dashboard", () => {
  assert.match(client, /CommercialMonitorCanonicalDashboard/)
  assert.match(client, /<details id="advanced-diagnostics"/)
  assert.match(client, /Diagnóstico técnico avanzado/)
})
