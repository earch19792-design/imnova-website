import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

const bridge = await import("./ebay-radar-luna-quick-pick-handoff-v1.ts")
const matcher = await import("./exact-product-visual-matcher-v1.ts")

const hash = (digit) => digit.repeat(64)

function family({ digit, name, demand = "FAMILY_DEMAND_PROVEN",
  commercial = "AVAILABLE", phrases = [] }) {
  return { familyId: `market-family-v1:sha256:${hash(digit)}`,
    opportunityCaseId: `opportunity-case-v1:sha256:${hash(digit)}`,
    familyName: name,
    observationSeries: [{
      observationId: `family-market-observation-v1:sha256:${hash(digit)}`,
      demandEvidenceDigest: `sha256:${hash(digit)}`,
      familyDemandStatus: demand, fresh: true,
      momentumStatus: "STABLE",
      commercialComparableStatus: commercial,
      commercialComparableCount: commercial === "AVAILABLE" ? 5 : 0,
      commercialPriceTypicalLow: commercial === "AVAILABLE" ? 20 : null,
      commercialPriceTypicalHigh: commercial === "AVAILABLE" ? 30 : null,
      attributeProfile: { "product family": name },
      demandKeywordDna: { soldWeightedTerms: phrases.map((term) => ({ term })) },
    }] }
}

function catalog(overrides = {}) {
  return { product_id: "db-1", supplier_product_id: "100",
    supplier_variant_id: "200", sku: "ITEM-A",
    title: "5-in-1 Microcurrent Facial Device for Skin Tightening & Lifting",
    variant_title: "Default", product_type: "Beauty & Skincare",
    tags: ["facial", "microcurrent"],
    product_url: "https://lunaportex.com/products/microcurrent-device",
    available: true, inventory_quantity: 3, price: 8, ...overrides }
}

test("qualification preserves family demand and never promotes exact demand", () => {
  const result = bridge.projectQualifiedRadarSignalsV1({ status: "AVAILABLE",
    families: [
      family({ digit: "1", name: "Microcurrent facial devices" }),
      family({ digit: "2", name: "Fragrances for women",
        demand: "FAMILY_DEMAND_SUPPORTED" }),
      { ...family({ digit: "3", name: "Stale" }),
        observationSeries: [{ ...family({ digit: "3", name: "Stale" })
          .observationSeries[0], fresh: false }] },
    ] })
  assert.equal(result.length, 2)
  assert.deepEqual(result.map((entry) => entry.familyDemandStatus),
    ["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"])
  assert.ok(result.every((entry) => entry.exactDemandStatus === "UNPROVEN"))
})

test("cheap catalog filtering is bounded and only strong candidates reach full evidence shortlist", () => {
  const signals = bridge.projectQualifiedRadarSignalsV1({ status: "AVAILABLE",
    families: [family({ digit: "1", name: "Microcurrent facial devices",
      phrases: ["5 in 1 microcurrent facial device for skin tightening lifting"] })] })
  const result = bridge.buildBoundedRadarLunaShortlistsV1({ signals,
    maximumCheapCandidates: 2, maximumFullEvidenceCandidates: 1,
    catalogRows: [catalog(), catalog({ supplier_variant_id: "201",
      sku: "ITEM-B", title: "Generic face cream" }), catalog({
      supplier_variant_id: "202", sku: "ITEM-C", available: false })] })
  const selected = result.byFamily.get(signals[0].familyId)
  assert.equal(selected.length, 1)
  assert.equal(selected[0].identityClass, "STRONG")
  assert.equal(result.maximumCheapCandidates, 2)
  assert.equal(result.maximumFullEvidenceCandidates, 1)
  assert.equal(result.fullPageScanUsedForAllLunaProducts, false)
})

test("shared identity matcher fails closed on conflicts and does not call family exact", () => {
  const strong = matcher.resolveSharedProductIdentityMatchV1({
    targetPhrases: ["5 in 1 microcurrent facial device for skin tightening lifting"],
    candidateTitle: "5-in-1 Microcurrent Facial Device for Skin Tightening & Lifting",
  })
  assert.equal(strong.classification, "STRONG")
  const family = matcher.resolveSharedProductIdentityMatchV1({
    targetPhrases: ["9001e series battery switch"],
    candidateTitle: "High Current Heavy Duty Battery Disconnect Switch",
  })
  assert.notEqual(family.classification, "EXACT")
  assert.notEqual(family.classification, "STRONG")
  const rejected = matcher.resolveSharedProductIdentityMatchV1({
    targetPhrases: ["wireless microphone"],
    candidateTitle: "wireless microphone", materialConflicts: ["PACK_CONFLICT"],
  })
  assert.equal(rejected.classification, "REJECTED")
})

test("scheduled path uses the certified Quick Pick intake and no pre-intake economics fanout", () => {
  const route = readFileSync(
    "app/api/cron/market-radar-luna-sync/route.ts", "utf8")
  const source = readFileSync(
    "lib/ebay/ebay-radar-luna-quick-pick-handoff-v1.ts", "utf8")
  assert.match(route, /runRadarLunaQuickPickHandoffCycleV1/)
  assert.doesNotMatch(route, /ensureRadarCandidateEconomicsPreflightsV1/)
  assert.doesNotMatch(route, /materializeRadarRevenueFactoryCandidateBatchV1/)
  assert.match(source, /receiveLunaQuickPickBatchV1/)
  assert.match(source, /processLunaQuickPickBatchV1/)
  assert.match(source, /completeLunaQuickPickBatchReceiptV1/)
  assert.match(source, /buildLunaExactProductEvidenceSetV1/)
  assert.match(source, /readAlreadyLiveExactLunaIdentitiesV1/)
  assert.match(source, /exactDemandStatus: "UNPROVEN"/)
  assert.doesNotMatch(source, /publish|createOffer|addFixedPriceItem/i)
  assert.doesNotMatch(source, /ITEM\d+|market-family-v1:sha256:[0-9a-f]{64}/)
})
