import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildOpenAiFactsInputPackage,
  calculateReadiness,
  createShippingEstimate,
  deriveOfferPackFacts,
  factObservationKey,
  mapTaxonomyRequirements,
  normalizeUnit,
  productFactsHash,
  regulatoryReadiness,
  resolveProductFacts,
  targetedFactException,
} from "./ebay-product-facts-readiness.ts"

const now = new Date("2026-07-17T12:00:00.000Z")
function observation(overrides = {}) {
  const value = overrides.value ?? "Example"
  const entry = {
    id: overrides.id,
    candidateId: "candidate-1",
    lunaVariantId: "luna-variant-1",
    factScope: "PRODUCT_UNIT",
    factKey: "brand",
    rawValue: value,
    normalizedValue: value,
    normalizedUnit: null,
    sourceType: "LUNA_EXACT_VARIANT",
    sourceReference: "LUNA_EXACT_VARIANT:sha256:0123456789abcdef01234567",
    sourceAuthority: "SUPPLIER",
    sourceObservedAt: now.toISOString(),
    fetchedAt: now.toISOString(),
    expiresAt: null,
    confidence: .9,
    verificationStatus: "VERIFIED",
    adapterVersion: "TEST_V1",
    ...overrides,
  }
  entry.evidenceHash = factObservationKey(entry)
  return entry
}

function readyFacts() {
  return [
    observation({ factKey: "exactProductName", value: "Example Product" }),
    observation({ factKey: "brand", value: "Example Brand" }),
    observation({ factKey: "condition", value: "New" }),
    observation({ factScope: "OFFER_PACK", factKey: "offerPackCount", value: 3, normalizedUnit: "count" }),
    observation({ factScope: "OFFER_PACK", factKey: "unitsPerPack", value: 1, normalizedUnit: "count" }),
    observation({ factScope: "OFFER_PACK", factKey: "totalUnitCount", value: 45, normalizedUnit: "count", verificationStatus: "DERIVED_VERIFIED" }),
  ]
}

test("A/B: a unit GTIN is never assigned to a seller multipack and 3 × 15 derives 45", () => {
  const facts = resolveProductFacts([
    observation({ factKey: "gtin", value: "012345678905" }),
    observation({ factKey: "unitCount", value: 15, normalizedUnit: "count" }),
    observation({ factScope: "OFFER_PACK", factKey: "offerPackCount", value: 3, normalizedUnit: "count" }),
  ], now)
  const derived = deriveOfferPackFacts({ candidateId: "candidate-1", lunaVariantId: "luna-variant-1", facts: facts.facts, now })
  assert.equal(derived.length, 1)
  assert.equal(derived[0].normalizedValue, 45)
  assert.equal(derived[0].verificationStatus, "DERIVED_VERIFIED")
  assert.notEqual(derived[0].factKey, "multipackGtin")
  assert.equal(facts.facts.find((fact) => fact.factKey === "gtin")?.factScope, "PRODUCT_UNIT")
})

test("C/D: a shipping estimate does not derive dimensions and is not a verified listing fact", () => {
  const estimate = createShippingEstimate({ candidateId: "candidate-1", lunaVariantId: "luna-variant-1", unitGrossWeight: 1.25, offerPackCount: 3, now })
  assert.equal(estimate?.observation.factKey, "shippingWeight")
  assert.equal(estimate?.observation.verificationStatus, "ESTIMATED_INTERNAL")
  assert.equal(estimate?.observation.normalizedUnit, "lb")
  assert.equal("shippingLength" in (estimate?.observation ?? {}), false)
  const resolved = resolveProductFacts([...readyFacts(), estimate.observation], now)
  const readiness = calculateReadiness({ identityExact: true, facts: resolved.facts, requirements: [], regulated: false })
  assert.equal(readiness.gates.SHIPPING_ESTIMATE_READY, true)
  assert.equal(readiness.gates.SHIPPING_CONFIRMED, false)
  assert.equal(readiness.gates.PUBLICATION_FACTS_READY, false)
})

test("E/F: conflicting UPC blocks and distinct scent/size values do not merge", () => {
  const result = resolveProductFacts([
    observation({ factKey: "upc", value: "012345678905" }),
    observation({ factKey: "upc", value: "036000291452", sourceType: "EBAY_CATALOG_OFFICIAL_READONLY", sourceAuthority: "MANUFACTURER_OR_LABEL" }),
    observation({ factKey: "scent", value: "Lemon" }),
    observation({ factKey: "scent", value: "Lavender", sourceType: "EBAY_CATALOG_OFFICIAL_READONLY", sourceAuthority: "MANUFACTURER_OR_LABEL" }),
  ], now)
  assert.equal(result.facts.find((fact) => fact.factKey === "upc")?.verificationStatus, "CONFLICTED")
  assert.equal(result.facts.find((fact) => fact.factKey === "upc")?.selectedValue, null)
  assert.equal(result.facts.find((fact) => fact.factKey === "scent")?.verificationStatus, "CONFLICTED")
  assert.equal(result.conflicts.length, 2)
})

test("resolver normalizes compatible measurement units before comparison", () => {
  assert.deepEqual(normalizeUnit(1, "lb"), { value: 453.59237, unit: "g" })
  const result = resolveProductFacts([
    observation({ factKey: "unitGrossWeight", value: 1, normalizedUnit: "lb" }),
    observation({ factKey: "unitGrossWeight", value: 453.59237, normalizedUnit: "g", sourceType: "EBAY_CATALOG_OFFICIAL_READONLY", sourceAuthority: "CORROBORATION" }),
  ], now)
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.facts[0].verificationStatus, "VERIFIED")
})

test("G/H: a missing mandatory Taxonomy aspect blocks while an optional gap does not", () => {
  const facts = resolveProductFacts(readyFacts(), now).facts
  const requirements = mapTaxonomyRequirements([
    { name: "Brand", required: true }, { name: "Material", required: false },
  ], facts)
  assert.equal(requirements[0].status, "SATISFIED_VERIFIED")
  assert.equal(requirements[1].status, "MISSING_OPTIONAL")
  const blocking = mapTaxonomyRequirements([{ name: "MPN", required: true }], facts)
  assert.equal(blocking[0].status, "MISSING_BLOCKING")
  assert.equal(calculateReadiness({ identityExact: true, facts, requirements: blocking, regulated: false }).gates.EBAY_ASPECTS_READY, false)
})

test("Taxonomy unavailable never passes readiness through an empty requirement list", () => {
  const facts = resolveProductFacts(readyFacts(), now).facts
  const readiness = calculateReadiness({
    identityExact: true, facts, requirements: [], regulated: false, taxonomySourceReady: false,
  })
  assert.equal(readiness.gates.EBAY_ASPECTS_READY, false)
  assert.equal(readiness.gates.OPENAI_INPUT_READY, false)
})

test("I: regulated facts are never invented", () => {
  const missing = regulatoryReadiness(resolveProductFacts(readyFacts(), now).facts, true)
  assert.equal(missing.status, "REGULATORY_NOT_READY")
  assert.deepEqual(missing.missing.sort(), ["hazardousMaterialStatus", "regulatoryIdentifiers", "warnings"].sort())
  assert.equal(regulatoryReadiness([], false).status, "NOT_APPLICABLE")
})

test("J/K/L: the OpenAI firewall filters missing/conflicted data and calls remain zero", () => {
  const facts = resolveProductFacts([...readyFacts(),
    observation({ factKey: "mpn", value: null, normalizedValue: null, verificationStatus: "MISSING" }),
    observation({ factKey: "upc", value: "012345678905" }),
    observation({ factKey: "upc", value: "036000291452", sourceType: "EBAY_CATALOG_OFFICIAL_READONLY", sourceAuthority: "MANUFACTURER_OR_LABEL" }),
  ], now).facts
  const requirements = mapTaxonomyRequirements([{ name: "Brand", required: true }], facts)
  const readiness = calculateReadiness({ identityExact: true, facts, requirements, regulated: false })
  const output = buildOpenAiFactsInputPackage({ facts, readiness })
  assert.equal(output.ready, false)
  assert.equal(output.openAiCalls, 0)
  assert.deepEqual(output.facts, [])
})

test("M/N/O: source policy has no private browsing, enrichment is bounded, and exceptions are targeted", () => {
  const source = readFileSync(new URL("./ebay-product-facts-enrichment.ts", import.meta.url), "utf8")
  assert.match(source, /const MAX_CANDIDATES = 20/)
  assert.doesNotMatch(source, /document\.cookie|private endpoint|puppeteer|playwright/i)
  assert.match(source, /taxonomySourceReady/)
  assert.match(source, /requiredAspectNames/)
  assert.doesNotMatch(source, /EBAY_CATALOG_OFFICIAL_READONLY", authority: "MANUFACTURER_OR_LABEL"/)
  const facts = resolveProductFacts([...readyFacts(), createShippingEstimate({ candidateId: "candidate-1", lunaVariantId: "luna-variant-1", unitGrossWeight: 1, offerPackCount: 3, now }).observation], now).facts
  const readiness = calculateReadiness({ identityExact: true, facts, requirements: [], regulated: false })
  const exception = targetedFactException({ readiness, requirements: [] })
  assert.match(exception.exactEvidenceNeeded, /peso y las dimensiones/i)
  assert.doesNotMatch(exception.exactEvidenceNeeded, /completa la ficha/i)
})

test("P/Q/R: persistence is append-only, duplicate facts have stable hashes, and Production is blocked", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260718010000_create_product_facts_readiness_engine.sql", import.meta.url), "utf8")
  assert.match(migration, /create table if not exists public\.marketplace_product_fact_observations/)
  assert.match(migration, /before update or delete on public\.marketplace_product_fact_observations/)
  assert.match(migration, /openai_calls = 0 and ebay_writes = 0 and production_changed = false/)
  const first = observation({ factKey: "brand", value: "Same Brand" })
  const repeat = observation({ factKey: "brand", value: "Same Brand", sourceObservedAt: "2026-07-18T12:00:00.000Z" })
  assert.equal(factObservationKey(first), factObservationKey(repeat))
  assert.equal(productFactsHash({ productionChanged: false }), productFactsHash({ productionChanged: false }))
})

test("a rerun links deduplicated observations and resolutions to the current fact run", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260718045000_link_product_fact_runs_to_deduplicated_evidence.sql", import.meta.url), "utf8")
  const enrichment = readFileSync(new URL("./ebay-product-facts-enrichment.ts", import.meta.url), "utf8")
  assert.match(migration, /marketplace_product_fact_run_evidence_links/)
  assert.match(migration, /artifact_type = 'OBSERVATION'/)
  assert.match(migration, /artifact_type = 'RESOLUTION'/)
  assert.match(migration, /artifact_type = 'SOURCE_SNAPSHOT'/)
  assert.match(migration, /artifact_type = 'REQUIREMENT'/)
  assert.match(migration, /artifact_type = 'READINESS_EVENT'/)
  assert.match(migration, /canonical_fact_run_id/)
  assert.match(migration, /v_current_queue_run_id is distinct from v_item_queue_run_id/)
  assert.match(migration, /v_current_account_key is distinct from new\.marketplace_account_key/)
  assert.match(migration, /before update or delete[\s\S]*reject_product_fact_mutation/)
  assert.match(migration, /finalize_product_fact_run_v1/)
  assert.match(migration, /PRODUCT_FACT_RUN_EVIDENCE_NOT_COMPLETE/)
  assert.match(migration, /current_setting\('seller_os\.product_fact_finalize'/)
  assert.match(migration, /force row level security/)
  assert.match(enrichment, /PRODUCT_FACT_CURRENT_RUN_EVIDENCE_INCOMPLETE/)
  assert.match(enrichment, /status: "RUNNING"/)
  assert.match(enrichment, /finalize_product_fact_run_v1/)
  assert.match(enrichment, /p_status: "FAILED"/)
  assert.match(enrichment, /evidenceBinding = \{ factRunId: run\.id, currentRunBound/)
  assert.match(enrichment, /ignoreDuplicates: true/)
  assert.match(enrichment, /queueRunForCandidateIds/)
  assert.match(enrichment, /PRODUCT_FACT_CANDIDATES_CROSS_QUEUE_RUN_BLOCKED/)
  assert.match(enrichment, /owning run from those IDs instead of silently jumping to a newer queue run/)
})
