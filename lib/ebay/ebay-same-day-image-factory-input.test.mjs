import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildSafeOpenAiBackgroundPlatePlan,
  EBAY_LISTING_IMAGE_SLOTS,
  validateListingImageFactoryInput,
} from "./ebay-listing-image-factory.ts"
import {
  buildOpenAiFactsInputPackage,
  productFactsHash,
} from "./ebay-product-facts-readiness.ts"
import {
  buildCurrentSameDayImageFactoryInput,
} from "./ebay-same-day-image-factory-input.ts"
import { SAME_DAY_MANUAL_HANDOFF_VERSION } from "./ebay-same-day-manual-handoff.ts"

function authoritativePackage() {
  const rows = [
    ["PRODUCT_UNIT", "exactProductName", "Lysol Disinfecting Wipes Lemon", null, "VERIFIED"],
    ["PRODUCT_UNIT", "brand", "Lysol", null, "VERIFIED"],
    ["PRODUCT_UNIT", "condition", "New", null, "VERIFIED"],
    ["PRODUCT_UNIT", "unitCount", 15, "count", "VERIFIED"],
    ["PRODUCT_UNIT", "netContent", 15, "count", "CORROBORATED"],
    ["PRODUCT_UNIT", "scent", "Lemon", null, "CORROBORATED"],
    ["OFFER_PACK", "offerPackCount", 3, "count", "VERIFIED"],
    ["OFFER_PACK", "unitsPerPack", 15, "count", "VERIFIED"],
    ["OFFER_PACK", "totalUnitCount", 45, "count", "DERIVED_VERIFIED"],
  ]
  const facts = rows.map(([scope, key, value, unit, status], index) => ({
    factScope: scope,
    factKey: key,
    selectedValue: value,
    selectedUnit: unit,
    supportingObservationIds: [`observation-${index}`],
    supportingSourceTypes: status === "DERIVED_VERIFIED"
      ? ["INTERNAL_DERIVATION"]
      : ["LUNA_EXACT_VARIANT"],
    supportingSourceAuthorities: ["SUPPLIER"],
    conflictingObservationIds: [],
    resolutionRule: status === "DERIVED_VERIFIED"
      ? "AUTHORIZED_DERIVATION"
      : "FIELD_AUTHORITY_MATRIX",
    confidence: 0.95,
    verificationStatus: status,
    resolvedAt: "2026-07-18T12:00:00.000Z",
    resolverVersion: "TEST",
  }))
  return buildOpenAiFactsInputPackage({
    facts,
    readiness: {
      gates: { OPENAI_INPUT_READY: true },
      regulatory: { status: "NOT_APPLICABLE", blocking: false, missing: [] },
      conflicted: false,
    },
  })
}

function fixture() {
  const facts = authoritativePackage()
  return {
    facts,
    currentBinding: {
      candidateId: "candidate-current",
      factRunId: "fact-run-current",
      factPackageHash: facts.factPackageHash,
    },
    handoffPackage: {
      version: SAME_DAY_MANUAL_HANDOFF_VERSION,
      candidateId: "candidate-current",
      factRunId: "fact-run-current",
      title: "HOSTILE HANDOFF TITLE MUST NOT BECOME AN IMAGE FACT",
      images: {
        urls: ["https://authorized.example/product.jpg"],
        count: 1,
        source: "LUNA_AUTHORIZED_CATALOG",
        competitorImages: 0,
      },
      safety: {
        factsOnly: true,
        openAiCalls: 0,
        ebayWrites: 0,
        competitorContentUsed: false,
        authoritativeFactPackageHash: facts.factPackageHash,
      },
    },
  }
}

test("builds the exact six-slot image input from the current authoritative facts", () => {
  const input = fixture()
  const result = buildCurrentSameDayImageFactoryInput({
    handoffPackage: input.handoffPackage,
    authoritativeFactsPackage: input.facts,
    currentBinding: input.currentBinding,
  })
  assert.deepEqual(validateListingImageFactoryInput(result), result)
  assert.equal(result.identityFingerprint, input.facts.factPackageHash)
  assert.deepEqual(result.facts, {
    manufacturerBrand: "Lysol",
    normalizedProductName: "Lysol Disinfecting Wipes Lemon",
    packCount: 3,
    unitCount: 15,
    size: "15 count",
    color: null,
    scent: "Lemon",
    variant: null,
    condition: "New",
  })
  assert.deepEqual(result.briefs.map((brief) => brief.slot), EBAY_LISTING_IMAGE_SLOTS)
  assert.ok(result.briefs.every((brief) =>
    brief.preserveOriginalPackage === true &&
    brief.sourcePolicy === "AUTHORIZED_PRODUCT_IMAGE_ONLY" &&
    brief.overlayText === null))
  assert.equal(result.briefs.length, 6)
})

test("drops handoff image URLs and untrusted handoff copy from the factory input", () => {
  const input = fixture()
  const result = buildCurrentSameDayImageFactoryInput({
    handoffPackage: input.handoffPackage,
    authoritativeFactsPackage: input.facts,
    currentBinding: input.currentBinding,
  })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /authorized\.example|https?:|base64|HOSTILE HANDOFF/i)
  assert.equal("urls" in result, false)
  assert.equal("bytes" in result, false)
})

test("fails closed for stale handoffs, mismatched packages and unauthorized sources", () => {
  const stale = fixture()
  assert.throws(() => buildCurrentSameDayImageFactoryInput({
    handoffPackage: stale.handoffPackage,
    authoritativeFactsPackage: stale.facts,
    currentBinding: { ...stale.currentBinding, factRunId: "newer-fact-run" },
  }), /SAME_DAY_IMAGE_HANDOFF_STALE/)

  const mismatch = fixture()
  assert.throws(() => buildCurrentSameDayImageFactoryInput({
    handoffPackage: mismatch.handoffPackage,
    authoritativeFactsPackage: mismatch.facts,
    currentBinding: {
      ...mismatch.currentBinding,
      factPackageHash: `sha256:${"f".repeat(64)}`,
    },
  }), /SAME_DAY_IMAGE_FACT_PACKAGE_STALE/)

  const unsafe = fixture()
  unsafe.handoffPackage.images.source = "COMPETITOR_IMAGE"
  assert.throws(() => buildCurrentSameDayImageFactoryInput({
    handoffPackage: unsafe.handoffPackage,
    authoritativeFactsPackage: unsafe.facts,
    currentBinding: unsafe.currentBinding,
  }), /SAME_DAY_IMAGE_AUTHORIZED_SOURCE_REQUIRED/)
})

test("rejects a status-only competitor fact even when its forged hash is recomputed", () => {
  const input = fixture()
  const forged = structuredClone(input.facts)
  forged.facts.push({
    scope: "PRODUCT_UNIT",
    key: "variant",
    value: "COMPETITOR-VARIANT",
    unit: null,
    verificationStatus: "CORROBORATED",
    sourceTypes: ["EBAY_BROWSE_OFFICIAL_READONLY"],
    resolutionRule: "FIELD_AUTHORITY_MATRIX",
  })
  forged.factPackageHash = productFactsHash({
    version: forged.version,
    sourcePolicy: forged.sourcePolicy,
    facts: forged.facts,
  })
  input.handoffPackage.safety.authoritativeFactPackageHash = forged.factPackageHash
  input.currentBinding.factPackageHash = forged.factPackageHash
  assert.throws(() => buildCurrentSameDayImageFactoryInput({
    handoffPackage: input.handoffPackage,
    authoritativeFactsPackage: forged,
    currentBinding: input.currentBinding,
  }), /SAME_DAY_IMAGE_FACT_PACKAGE_INVALID/)
})

test("OpenAI receives a verified-facts scene-board plan without source URLs or pixels", () => {
  const input = fixture()
  const factoryInput = buildCurrentSameDayImageFactoryInput({
    handoffPackage: input.handoffPackage,
    authoritativeFactsPackage: input.facts,
    currentBinding: input.currentBinding,
  })
  const plan = buildSafeOpenAiBackgroundPlatePlan(factoryInput, "gpt-image-2")
  const outbound = JSON.stringify(plan).toLowerCase()
  assert.match(outbound, /lysol/)
  assert.match(outbound, /lemon/)
  assert.doesNotMatch(outbound, /authorized\.example|https?:|base64/)
  assert.equal(plan.sendsProductBytes, false)
  assert.equal(plan.sendsProductUrl, false)
  assert.equal(plan.sendsCompetitorData, false)
  assert.equal(plan.sendsVerifiedProductFacts, true)
  assert.equal(plan.sendsAggregatedMarketPatterns, false)
  assert.equal(plan.imageCount, 1)
})

test("the adapter is pure and has no listing-generation or database dependency", async () => {
  const source = await readFile(
    new URL("./ebay-same-day-image-factory-input.ts", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(source, /\.from\(|supabase|marketplace_listing_generations/)
  assert.doesNotMatch(source, /fetch\(|OPENAI_API_KEY|process\.env/)
})
