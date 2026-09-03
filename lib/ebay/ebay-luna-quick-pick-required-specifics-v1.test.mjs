import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { durableQuickPickRequiredSpecificsCandidateV1,
  projectQuickPickAutonomousResolutionV1 } = await import(
  "./ebay-luna-quick-pick-required-specifics-v1.ts")

function durableRow(overrides = {}) {
  return {
    supplier_product_id: "100",
    supplier_variant_id: "200",
    supplier_sku: "SKU-1",
    id: "queue-1", candidate_key: `sha256:${"a".repeat(64)}`,
    assessment: { radarFactoryCandidateV1: {
      contractVersion: "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1",
      authority: "SELLER_OS_DETERMINISTIC_FACTORY",
      candidateId: `sha256:${"a".repeat(64)}`, ...overrides,
    }, radarAutomaticLunaShippingContinuationV1: {
      candidateId: `sha256:${"a".repeat(64)}`,
      lunaProductId: "100", lunaVariantId: "200", supplierSku: "SKU-1",
      shippingJobStatus: "SHIPPING_EVIDENCE_DURABLE",
    }, sellerOsDeterministicFactory: { stageStatuses: {
      ECONOMICS_READY: "READY", PRODUCT_TRUTH_READY: "READY",
    } } },
  }
}

test("durable continuation accepts only the exact already-proven candidate identity", () => {
  assert.ok(durableQuickPickRequiredSpecificsCandidateV1(durableRow()))
  assert.equal(durableQuickPickRequiredSpecificsCandidateV1(
    { ...durableRow(), supplier_sku: "OTHER" }), null)
  assert.equal(durableQuickPickRequiredSpecificsCandidateV1(
    { ...durableRow(), assessment: {
      ...durableRow().assessment,
      sellerOsDeterministicFactory: { stageStatuses: {
        ECONOMICS_READY: "BLOCKED", PRODUCT_TRUTH_READY: "READY",
      } },
    } }), null)
})

test("Quick Pick continuation is one-shot, server-side and reuses the shared resolver", async () => {
  const source = await readFile(new URL(
    "./ebay-luna-quick-pick-required-specifics-v1.ts", import.meta.url), "utf8")
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-quick-pick/route.ts", import.meta.url), "utf8")
  assert.match(source, /materializeSellerOsDeterministicFactoryCandidateV1/)
  assert.match(source, /createOpenAiRequiredSpecificsBatchResolverV1/)
  assert.match(source, /product\.exactImageUrls\.length > 0\) \? "VISION" : "TEXT"/)
  assert.match(source, /maximumAiCallsPerQuickPick: 1/)
  assert.match(source, /ALL_OFFICIAL_REQUIRED_ASPECTS/)
  assert.match(source, /Number\(current\.aiCallCount \?\? 0\) >= 1/)
  assert.match(source, /typeof existingResolution\.digestVersion ===/)
  assert.match(source, /durableDigestUpgrade/)
  assert.match(source, /products: aiExhausted, aiResolver: null, aiStages: \[\]/)
  assert.match(source, /MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1/)
  assert.match(source, /factInvented: false/)
  assert.match(route, /continueLunaQuickPickRequiredSpecificsV1/)
  assert.match(route, /card\.unresolvedRequiredAspects\.length > 0/)
  assert.match(route, /MARKETPLACE_CONDITION_NOT_READY/)
  assert.ok(route.indexOf("continueLunaQuickPickRequiredSpecificsV1({") <
    route.lastIndexOf("readLunaQuickPickProgressV1({"))
  assert.doesNotMatch(route, /publishOffer|createOffer|bulkCreateOffer/)
})

test("metadata residuals become explicit owner last-mile work, never metadata rejection", () => {
  const result = projectQuickPickAutonomousResolutionV1({
    initial: { unsupportedRequiredSpecifics: ["Brand"],
      conditionReady: false },
    refreshed: { unsupportedRequiredSpecifics: [], conditionReady: false,
      marketTestReady: false, listingReady: false,
      requiredSpecificsBatchInput: { exactSpecs: {
        tags: ["New Inventory"],
      } } },
    resolutions: [{ aspectName: "Brand", resolvedValue: "Unbranded",
      resolutionClass: "MARKETPLACE_ALLOWED_FALLBACK",
      sourceEvidence: { sourceField: "MARKETPLACE_POLICY",
        sourceExcerpt: "OFFICIAL_UNBRANDED", imageIndex: null },
      confidence: "HIGH", factInvented: false,
      humanReviewRequired: false }],
    requiredSpecificsBatchInput: { exactSpecs: {
      tags: ["New Inventory"],
    } },
    aiCallCountBefore: 1, aiCallCountAfter: 1,
  })
  assert.equal(result.finalDisposition, "OWNER_CONFIRMATION_REQUIRED")
  assert.equal(result.metadataOnlyDoNotList, false)
  assert.equal(result.automaticResolutionExhausted, true)
  assert.equal(result.aiCallCountIncrement, 0)
  assert.deepEqual(result.exactUnresolvedFields, ["Condition"])
  assert.deepEqual(result.residualOwnerActions.map((entry) => [
    entry.productField, entry.bestProposal, entry.ownerAction,
    entry.factInvented,
  ]), [["Condition", "New", "CONFIRM", false]])
  assert.equal(result.resolvedFieldAudits[0].specificName, "Brand")
  assert.equal(result.resolvedFieldAudits[0].sourceAuthority,
    "OFFICIAL_EBAY_CATEGORY_POLICY")
  assert.equal(result.resolvedFieldAudits[0].ownerConfirmationRequired, false)
  assert.equal(result.requiredSpecificFactTraces[0].specificName, "Brand")
  assert.equal(result.requiredSpecificFactTraces[0].resolvedValue, "Unbranded")
  assert.equal(result.requiredSpecificFactTraces[0].factInvented, false)
})

test("a condition without any defensible proposal requests an exact owner fact", () => {
  const result = projectQuickPickAutonomousResolutionV1({
    initial: { unsupportedRequiredSpecifics: [], conditionReady: false },
    refreshed: { unsupportedRequiredSpecifics: [], conditionReady: false,
      marketTestReady: false, listingReady: false },
    resolutions: [], requiredSpecificsBatchInput: { exactSpecs: {} },
    aiCallCountBefore: 0, aiCallCountAfter: 1,
  })
  assert.equal(result.finalDisposition, "OWNER_FACT_REQUIRED")
  assert.equal(result.residualOwnerActions[0].ownerAction, "ENTER_FACT")
  assert.equal(result.residualOwnerActions[0].bestProposal, null)
  assert.equal(result.residualOwnerActions[0].whyAutomationCouldNotResolve,
    "EXACT_EVIDENCE_INSUFFICIENT_OR_CONFLICTING")
  assert.equal(result.residualOwnerActions[0].exactEvidenceMissing,
    "AUTHORITATIVE_EXACT_PRODUCT_CONDITION")
  assert.equal(result.aiCallCountIncrement, 1)
  assert.equal(result.factInvented, false)
})
