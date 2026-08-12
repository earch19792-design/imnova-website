import assert from "node:assert/strict"
import test from "node:test"

import { renderCommercialWhatsAppAlertDryRunV1,
  WHATSAPP_TEMPLATE_DEFINITIONS_V1 } from "./ebay-commercial-whatsapp-alert-engine-v1.ts"

const base = (overrides = {}) => ({ accountKey: "acct", family: "COMPONENT_OUT_OF_STOCK",
  evidenceFingerprint: "evidence-v1", stateVersion: "v1", observedAt: "2026-08-11T12:00:00Z",
  rootCause: "OUT_OF_STOCK_CONFIRMED", listing: { itemId: "123456789012", title: "Safe item" },
  stock: { riskClass: "OUT_OF_STOCK_CONFIRMED", exactIdentity: true },
  deepLinkPath: "/admin/ebay/operational-readiness", now: "2026-08-11T13:00:00Z",
  ...overrides })

test("eight Meta template contracts exist and approval is never assumed", () => {
  assert.equal(WHATSAPP_TEMPLATE_DEFINITIONS_V1.length, 8)
  assert.ok(WHATSAPP_TEMPLATE_DEFINITIONS_V1.every((row) =>
    row.approvalStatus === "NOT_SUBMITTED" && row.piiClassification === "NO_BUYER_PII"))
})

test("critical stock alert requires proven exact evidence and never dispatches", () => {
  const result = renderCommercialWhatsAppAlertDryRunV1(base())
  assert.equal(result.qualifies, true)
  assert.equal(result.severity, "CRITICAL")
  assert.equal(result.dispatchAllowed, false)
  assert.equal(result.realSendAttempted, false)
  assert.equal(renderCommercialWhatsAppAlertDryRunV1(base({ stock: {
    riskClass: "STOCK_UNKNOWN", exactIdentity: true } })).qualifies, false)
})

test("same evidence is suppressed while severity escalation bypasses cooldown", () => {
  const first = renderCommercialWhatsAppAlertDryRunV1(base())
  const repeat = renderCommercialWhatsAppAlertDryRunV1(base({ previousDelivery: {
    dedupeKey: first.dedupeKey, severity: "CRITICAL", sentAt: "2026-08-11T12:30:00Z" } }))
  assert.equal(repeat.cooldownState, "SUPPRESSED_UNCHANGED_EVIDENCE")
  const escalation = renderCommercialWhatsAppAlertDryRunV1(base({ previousDelivery: {
    dedupeKey: first.dedupeKey, severity: "IMPORTANT", sentAt: "2026-08-11T12:30:00Z" } }))
  assert.equal(escalation.cooldownState, "SEVERITY_ESCALATION_BYPASS")
})

test("order alert requires Orders evidence and experiment result requires transition", () => {
  assert.equal(renderCommercialWhatsAppAlertDryRunV1(base({
    family: "ORDER_AFFECTED_BY_STOCK", order: null })).qualifies, false)
  assert.equal(renderCommercialWhatsAppAlertDryRunV1(base({
    family: "EXPERIMENT_READY_TO_EVALUATE", stock: null,
    experiment: { experimentId: "exp-1", transition: "OTHER", evidenceSufficient: true } })).qualifies,
  false)
})

test("daily digest deduplicates meaningful events and buyer PII is rejected", () => {
  const digest = renderCommercialWhatsAppAlertDryRunV1(base({ family: "DAILY_SUMMARY",
    listing: undefined, stock: null, dailySummary: [
      { eventKey: "same", meaningful: true }, { eventKey: "same", meaningful: true },
    ] }))
  assert.equal(digest.qualifies, true)
  assert.throws(() => renderCommercialWhatsAppAlertDryRunV1(base({ listing: {
    itemId: "123456789012", title: "buyer@example.com" } })), /WHATSAPP_BUYER_PII_REJECTED/)
})
