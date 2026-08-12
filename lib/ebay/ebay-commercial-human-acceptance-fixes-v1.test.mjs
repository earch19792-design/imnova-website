import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { presentCommercialMonitorRegistryV1 } from
  "./ebay-commercial-monitor-registry-presentation-v1.ts"

const dashboard = readFileSync(new URL("../../app/admin/ebay/monitor/commercial-monitor-canonical-dashboard.tsx", import.meta.url), "utf8")
const stockPage = readFileSync(new URL("../../app/admin/ebay/stock-guard/page.tsx", import.meta.url), "utf8")
const readinessPage = readFileSync(new URL("../../app/admin/ebay/operational-readiness/page.tsx", import.meta.url), "utf8")

test("Stock navigation opens the dedicated read-only workspace", () => {
  assert.match(dashboard, /\["Stock", "\/admin\/ebay\/stock-guard"/)
  assert.match(stockPage, /fetch\("\/api\/admin\/ebay\/monitor"/)
  assert.doesNotMatch(stockPage, /method:\s*["']POST["']/)
  assert.match(stockPage, /READY BUT NOT ACTIVATED/)
  assert.match(stockPage, /No fuzzy or automatic linkage/)
  assert.match(stockPage, /Unknown is not risk/)
})

test("Registry presentation derives current evidence and explains unavailable state", () => {
  const presented = presentCommercialMonitorRegistryV1({ status: "PARTIAL_CERTIFIED",
    currentLiveCount: 27, matchedCount: 24, humanReviewCount: 3,
    coveragePercent: null, limitationCodes: [] })
  assert.equal(presented.coveragePercent, 88.89)
  assert.equal(presented.summary, "24 matched · 3 review · 88.89%")
  const unavailable = presentCommercialMonitorRegistryV1({ status: "UNPROVEN",
    currentLiveCount: null, matchedCount: null, humanReviewCount: null,
    coveragePercent: null, limitationCodes: ["REGISTRY_READ_FAILED"] })
  assert.equal(unavailable.available, false)
  assert.match(unavailable.summary, /REGISTRY READ FAILED/)
  assert.match(dashboard, /registryPresentation\.summary/)
})

test("human WhatsApp preview is primary while technical JSON remains secondary", () => {
  assert.match(readinessPage, /WhatsApp human preview/)
  assert.match(readinessPage, /Technical dry-run JSON/)
  assert.match(readinessPage, /<details/)
  assert.match(readinessPage, /Meta template review · 8 families/)
  assert.match(readinessPage, /dispatchAllowed=false/)
})

test("acceptance surfaces contain no marketplace or Registry mutation control", () => {
  for (const source of [stockPage, readinessPage]) {
    assert.doesNotMatch(source, /apply_ebay_registry_repair_v1|ReviseItem|EndItem|SendMessageToBuyer/)
  }
})
