import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const {
  projectSellerOsCompactCapabilityStatesV1,
  sellerOsCompactCapabilityLabelV1,
  sellerOsCompactCapabilityStateV1,
} = await import("./operational-status-v1.ts")

test("projects the current degraded revenue path without false operating", () => {
  const states = projectSellerOsCompactCapabilityStatesV1({
    lunaAuthorityAvailable: true,
    lunaEligiblePendingJobCount: 2,
    lunaCapabilityProven: false,
    productResearchAuthorityAvailable: true,
    productResearchPlanStatus: "ACTIVE",
    productResearchCapabilityFresh: false,
    radarAuthorityAvailable: true,
    radarOutputFresh: false,
    radarOperationalState: "SIN_TRABAJO",
    commercialAuthorityAvailable: true,
    orderAuthorityAvailable: false,
    currentLiveAuthorityAvailable: false,
    publisherPhysicalAcceptance: false,
    mayelAuthorityAvailable: true,
    mayelPendingCount: 23,
  })
  assert.deepEqual(states, {
    lunaShipping: "WAITING_FOR_WORKER",
    productResearch: "WAITING_FOR_WORKER",
    radar: "STALE_NO_RECENT_OUTPUT",
    publisher: "BLOCKED",
    ebay: "DEGRADED",
    mayelVisual: "OPERATING",
    mayelCommercial: "DEGRADED",
  })
})

test("unknown authority never becomes healthy or failed", () => {
  const states = projectSellerOsCompactCapabilityStatesV1({
    lunaAuthorityAvailable: false,
    lunaEligiblePendingJobCount: null,
    lunaCapabilityProven: false,
    productResearchAuthorityAvailable: false,
    productResearchPlanStatus: "",
    productResearchCapabilityFresh: false,
    radarAuthorityAvailable: false,
    radarOutputFresh: false,
    radarOperationalState: null,
    commercialAuthorityAvailable: false,
    orderAuthorityAvailable: false,
    currentLiveAuthorityAvailable: false,
    publisherPhysicalAcceptance: false,
    mayelAuthorityAvailable: false,
    mayelPendingCount: null,
  })
  assert.equal(states.lunaShipping, "UNKNOWN")
  assert.equal(states.productResearch, "UNKNOWN")
  assert.equal(states.radar, "UNKNOWN")
  assert.equal(states.ebay, "UNKNOWN")
  assert.equal(states.mayelVisual, "UNKNOWN")
  assert.equal(states.mayelCommercial, "UNKNOWN")
})

test("missing plan and Mayel counts remain unknown instead of idle", () => {
  const states = projectSellerOsCompactCapabilityStatesV1({
    lunaAuthorityAvailable: true,
    lunaEligiblePendingJobCount: null,
    lunaCapabilityProven: false,
    productResearchAuthorityAvailable: true,
    productResearchPlanStatus: "",
    productResearchCapabilityFresh: false,
    radarAuthorityAvailable: false,
    radarOutputFresh: false,
    radarOperationalState: null,
    commercialAuthorityAvailable: true,
    orderAuthorityAvailable: true,
    currentLiveAuthorityAvailable: true,
    publisherPhysicalAcceptance: true,
    mayelAuthorityAvailable: true,
    mayelPendingCount: null,
  })
  assert.equal(states.lunaShipping, "UNKNOWN")
  assert.equal(states.productResearch, "UNKNOWN")
  assert.equal(states.mayelVisual, "UNKNOWN")
  assert.equal(states.mayelCommercial, "UNKNOWN")
})

test("human labels preserve worker wait, staleness and degradation", () => {
  assert.equal(sellerOsCompactCapabilityLabelV1("WAITING_FOR_WORKER"),
    "ESPERANDO WORKER")
  assert.equal(sellerOsCompactCapabilityLabelV1("STALE_NO_RECENT_OUTPUT"),
    "ATRASADO")
  assert.equal(sellerOsCompactCapabilityLabelV1("DEGRADED"), "DEGRADADO")
  assert.equal(sellerOsCompactCapabilityStateV1("NOT_A_STATE"), "UNKNOWN")
})

test("Home consumes the compact contract and keeps Mayel dimensions split", () => {
  const home = readFileSync("app/admin/seller-os-home-dashboard-v1.tsx", "utf8")
  const snapshot = readFileSync("lib/seller-os/operational-snapshot-v1.ts", "utf8")
  assert.match(home, /Mayel · Visual/)
  assert.match(home, /Mayel · Comercial/)
  assert.match(home, /data-compact-state/)
  assert.match(snapshot, /RADAR_DURABLE_OUTPUT_STALE_OR_ABSENT/)
  assert.match(snapshot, /SELLER_OS_COMMERCIAL_REVENUE_PATH/)
  assert.match(snapshot, /PRODUCT_RESEARCH_CAPTURE_RECEIPT_PLUS_QUERY_PLAN/)
  assert.match(snapshot, /LUNA_SHIPPING_RUNTIME_TRACE_PLUS_ELIGIBLE_JOB_QUEUE/)
})
