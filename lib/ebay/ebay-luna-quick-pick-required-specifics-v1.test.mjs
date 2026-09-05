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

const { durableQuickPickBatchAiCallConsumedV1,
  durableQuickPickRequiredSpecificsCandidateV1,
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

test("a durable sibling receipt exhausts the AI budget for the whole Quick Pick batch", () => {
  const batchId = "9798cb33-1b7c-4eee-88b8-c04abccf2f8b"
  const sibling = { assessment: {
    lunaQuickPickOperationV1: { batchId },
    quickPickRequiredSpecificsContinuationV1: {
      contractVersion: "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1",
      aiCallCount: 1,
      aiBatchEvidenceDigest: `sha256:${"b".repeat(64)}`,
    },
  } }
  const pending = { assessment: {
    lunaQuickPickOperationV1: { batchId },
    quickPickRequiredSpecificsContinuationV1: {
      contractVersion: "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1",
      aiCallCount: 0,
    },
  } }
  assert.equal(durableQuickPickBatchAiCallConsumedV1(
    [sibling, pending], batchId), true)
  assert.equal(durableQuickPickBatchAiCallConsumedV1(
    [pending], batchId), false)
  assert.equal(durableQuickPickBatchAiCallConsumedV1(
    [sibling], "other-batch"), false)
})

test("Quick Pick continuation is one-shot, server-side and reuses the shared resolver", async () => {
  const source = await readFile(new URL(
    "./ebay-luna-quick-pick-required-specifics-v1.ts", import.meta.url), "utf8")
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-quick-pick/route.ts", import.meta.url), "utf8")
  const coordinator = await readFile(new URL(
    "./ebay-quick-pick-post-shipping-continuation-v1.ts", import.meta.url),
  "utf8")
  const getBody = route.slice(route.indexOf("export async function GET"),
    route.indexOf("export async function POST"))
  const postBody = route.slice(route.indexOf("export async function POST"))
  assert.match(source, /materializeSellerOsDeterministicFactoryCandidateV1/)
  assert.match(source, /createOpenAiRequiredSpecificsBatchResolverV1/)
  assert.match(source, /product\.exactImageUrls\.length > 0\) \? "VISION" : "TEXT"/)
  assert.match(source, /maximumAiCallsPerQuickPick: 1/)
  assert.match(source, /maximumAiCallsPerBatch: 1/)
  assert.match(source, /readLunaNewMerchandisePolicyV1/)
  assert.match(source, /ownerSupplierMerchandisePolicyApplicationV1/)
  assert.match(source, /brandEvidencePending/)
  assert.match(source, /waitingBatchIds/)
  assert.match(source, /consumedAiBatchIds/)
  assert.match(source, /durableQuickPickBatchAiCallConsumedV1/)
  assert.match(source, /MATERIALIZATION_CONCURRENCY = 3/)
  assert.equal((source.match(/mapWithBoundedConcurrency\(/g) ?? []).length, 2)
  assert.match(source, /ALL_OFFICIAL_REQUIRED_ASPECTS/)
  assert.match(source, /Number\(current\.aiCallCount \?\? 0\) >= 1/)
  assert.match(source, /typeof existingResolution\.digestVersion ===/)
  assert.match(source, /durableDigestUpgrade/)
  assert.match(source, /safeContractUpgrade/)
  assert.match(source, /priorResidualScope\.length > 0/)
  assert.match(source,
    /!brandEvidencePending\s*&&\s*!incompleteClaimStale/)
  assert.match(source, /products: aiExhausted, aiResolver: null, aiStages: \[\]/)
  assert.match(source, /MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1/)
  assert.match(source, /factInvented: false/)
  assert.match(coordinator, /continueLunaQuickPickRequiredSpecificsV1/)
  assert.match(postBody, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.doesNotMatch(getBody, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(source, /unresolvedRequiredAspects\.length > 0/)
  assert.match(source, /brandEvidencePending/)
  assert.doesNotMatch(source,
    /!card\.automaticResolutionContractCurrent\s*&&\s*card\.automaticResolutionExhausted\s*&&\s*card\.automaticResolutionUpgradeHasPriorResidual/)
  assert.match(source, /MARKETPLACE_CONDITION_NOT_READY/)
  assert.doesNotMatch(route, /continueLunaQuickPickExactSoldEnrichmentV1/)
  assert.doesNotMatch(route,
    /continueLunaQuickPickVisualTopSellerEnrichmentV1/)
  assert.ok(coordinator.indexOf("continueLunaQuickPickRequiredSpecificsV1") <
    coordinator.lastIndexOf("continueLunaQuickPickMinimumReadinessV1"))
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
