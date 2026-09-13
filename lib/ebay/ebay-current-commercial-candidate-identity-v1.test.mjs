import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value === "server-only") return {
    url: "data:text/javascript,export default {}", shortCircuit: true,
  }
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_VERSION,
  deriveCurrentCommercialCandidateIdentityV1 } = await import(
  "./ebay-current-commercial-candidate-identity-v1.ts")
const { reconcileCurrentRadarShippingCandidateIdentityV1 } = await import(
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts")
const { collapseCurrentCommercialFrontierCandidatesV1 } = await import(
  "./ebay-luna-chrome-shipping-capture-server-v1.ts")

const exact = {
  accountKey: `seller:${"a".repeat(64)}`,
  productId: "product-100",
  variantId: "variant-200",
  supplierSku: "SKU-300",
}

test("CURRENT commercial candidate identity ignores evidence and lane freshness", () => {
  const first = deriveCurrentCommercialCandidateIdentityV1({ ...exact,
    familyId: "family-old", evidenceDigest: "old", batchPosition: 1,
    observedAt: "2026-09-01T00:00:00Z", shippingReceipt: "receipt-old" })
  const refreshed = deriveCurrentCommercialCandidateIdentityV1({ ...exact,
    familyId: "family-new", evidenceDigest: "new", batchPosition: 99,
    observedAt: "2026-09-13T00:00:00Z", shippingReceipt: "receipt-new" })
  assert.equal(first.canonicalCandidateId, refreshed.canonicalCandidateId)
  assert.equal(first.contractVersion,
    CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_VERSION)
})

test("CURRENT commercial candidate identity remains account and exact variant scoped", () => {
  const canonical = deriveCurrentCommercialCandidateIdentityV1(exact)
  for (const changed of [
    { ...exact, accountKey: `seller:${"b".repeat(64)}` },
    { ...exact, productId: "product-other" },
    { ...exact, variantId: "variant-other" },
    { ...exact, supplierSku: "SKU-OTHER" },
  ]) {
    assert.notEqual(
      deriveCurrentCommercialCandidateIdentityV1(changed).canonicalCandidateId,
      canonical.canonicalCandidateId)
  }
})

test("Radar and Shipping aliases reconcile only for one exact commercial identity", () => {
  const canonical = deriveCurrentCommercialCandidateIdentityV1(exact)
    .canonicalCandidateId
  const queueAlias = `sha256:${"1".repeat(64)}`
  const shippingAlias = `sha256:${"2".repeat(64)}`
  const candidate = { candidateId: canonical, accountKey: exact.accountKey,
    lunaProductId: exact.productId, lunaVariantId: exact.variantId,
    supplierSku: exact.supplierSku }
  const queueRow = { candidate_key: queueAlias,
    supplier_product_id: exact.productId,
    supplier_variant_id: exact.variantId,
    supplier_sku: exact.supplierSku,
    assessment: {
      radarFactoryCandidateV1: { candidateId: shippingAlias },
      radarAutomaticLunaShippingContinuationV1: {
        candidateId: shippingAlias },
      productTruth: { candidateKey: queueAlias },
      candidate: { candidateKey: queueAlias },
    } }
  const result = reconcileCurrentRadarShippingCandidateIdentityV1({
    candidate, queueRow,
    nextAssessment: {
      radarFactoryCandidateV1: {},
      radarAutomaticLunaShippingContinuationV1: {},
      productTruth: {}, candidate: {},
    },
  })
  assert.equal(result.canonicalCommercialIdentityMatch, true)
  assert.equal(result.radarShippingIdentityDerivationAligned, true)
  assert.equal(result.manualIdentityRebind, false)
  assert.equal(result.codexRuntimeDependency, false)
  assert.deepEqual(result.reconciledAliasCandidateIds,
    [queueAlias, shippingAlias])
  assert.equal(result.assessment.radarFactoryCandidateV1.candidateId, canonical)
  assert.equal(result.assessment
    .radarAutomaticLunaShippingContinuationV1.candidateId, canonical)
})

test("commercial identity contradiction fails closed", () => {
  const canonical = deriveCurrentCommercialCandidateIdentityV1(exact)
    .canonicalCandidateId
  assert.throws(() => reconcileCurrentRadarShippingCandidateIdentityV1({
    candidate: { candidateId: canonical, accountKey: exact.accountKey,
      lunaProductId: exact.productId, lunaVariantId: exact.variantId,
      supplierSku: exact.supplierSku },
    queueRow: { candidate_key: `sha256:${"3".repeat(64)}`,
      supplier_product_id: exact.productId,
      supplier_variant_id: "contradictory-variant",
      supplier_sku: exact.supplierSku, assessment: {} },
    nextAssessment: {},
  }), /CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_CONTRADICTION/)
})

test("Shipping collapses historical Radar families without duplicating the candidate", () => {
  const base = { candidateId: `sha256:${"4".repeat(64)}`,
    lunaProductId: exact.productId, lunaVariantId: exact.variantId,
    supplierSku: exact.supplierSku }
  const selected = collapseCurrentCommercialFrontierCandidatesV1([
    { ...base, familyId: "old-family",
      calculatedAt: "2026-09-01T00:00:00Z",
      snapshotDigest: `sha256:${"5".repeat(64)}` },
    { ...base, familyId: "current-family",
      calculatedAt: "2026-09-13T00:00:00Z",
      snapshotDigest: `sha256:${"6".repeat(64)}` },
  ])
  assert.equal(selected.length, 1)
  assert.equal(selected[0].familyId, "current-family")
  assert.throws(() => collapseCurrentCommercialFrontierCandidatesV1([
    { ...base, calculatedAt: "2026-09-13T00:00:00Z",
      snapshotDigest: `sha256:${"7".repeat(64)}` },
    { ...base, calculatedAt: "2026-09-13T00:00:00Z",
      snapshotDigest: `sha256:${"8".repeat(64)}` },
  ]), /CURRENT_COMMERCIAL_CANDIDATE_FRONTIER_AMBIGUOUS/)
})

test("Radar and Shipping both call the shared CURRENT commercial derivation", () => {
  const radar = readFileSync(new URL(
    "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts", import.meta.url),
  "utf8")
  const shipping = readFileSync(new URL(
    "./ebay-luna-chrome-shipping-capture-server-v1.ts", import.meta.url),
  "utf8")
  assert.match(radar, /deriveCurrentCommercialCandidateIdentityV1\(\{/)
  assert.match(shipping, /deriveCurrentCommercialCandidateIdentityV1\(\{/)
  assert.doesNotMatch(shipping,
    /JSON\.stringify\(\{\s*familyId, productId, variantId, sku/)
})

test("durable reconciliation is general and cannot mutate Shipping receipts", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260913081741_current_radar_shipping_candidate_identity_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration,
    /reconcile_seller_os_current_candidate_identity_v1/)
  assert.match(migration, /CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_AMBIGUOUS/)
  assert.match(migration, /CURRENT_COMMERCIAL_CANDIDATE_ALIAS_CONTRADICTION/)
  assert.doesNotMatch(migration,
    /update\s+(?:public\.)?seller_os_profitability_frontier_snapshots/i)
  assert.doesNotMatch(migration,
    /insert\s+into\s+(?:public\.)?seller_os_luna_shipping_job_claims/i)
  assert.doesNotMatch(migration,
    /9220845895904|53002124984544|FL-DIAMOND-4LINE-ANKLET|f072df3f/)
})
