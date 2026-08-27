import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildEbayListingTaxonomyPreflightV1,
  EBAY_LISTING_TAXONOMY_PREFLIGHT_V1,
} from "./ebay-listing-taxonomy-preflight-v1.ts"

const aspect = (name, options = {}) => ({
  name,
  mode: options.mode ?? "FREE_TEXT",
  cardinality: "SINGLE",
  maxLength: null,
  dataType: "STRING",
  format: null,
  advancedDataType: null,
  expectedRequiredByDate: null,
  required: options.required === true,
  enabledForVariations: false,
  usage: options.usage ?? "OPTIONAL",
  suggestedValues: options.values ?? [],
  values: (options.values ?? []).map((value) => ({
    value,
    valueConstraints: [],
  })),
  valuesComplete: true,
  constraintsComplete: true,
})

const taxonomy = (overrides = {}) => {
  const aspects = [
    aspect("Type", { required: true, mode: "SELECTION_ONLY",
      values: ["Turntable", "Stand"] }),
    aspect("Brand", { required: true, usage: "RECOMMENDED" }),
    aspect("Material", { usage: "RECOMMENDED" }),
    aspect("Features", { values: ["Non-Slip Base"] }),
    aspect("Size"),
    aspect("UPC"),
    aspect("Color"),
  ]
  return {
    status: "AVAILABLE",
    categoryTreeId: "0",
    categoryTreeVersion: "142",
    categoryId: "183335",
    categoryName: "Icing Turntables",
    taxonomyMarketplaceId: "EBAY_US",
    observedAt: "2026-08-27T19:00:00.000Z",
    aspects,
    requiredAspects: aspects.filter((entry) => entry.required),
    recommendedAspects: aspects.filter((entry) =>
      !entry.required && entry.usage === "RECOMMENDED"),
    categoryResolution: "KNOWN_CATEGORY",
    failureCode: null,
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    ...overrides,
  }
}

const input = (overrides = {}) => ({
  taxonomy: taxonomy(),
  expectedCategoryId: "183335",
  existingAspects: { Type: "Cake Turntable", Color: "White" },
  provenProductValues: {
    Type: "Turntable",
    Material: "Plastic",
    Features: "Non-Slip Base",
    Size: "11 in",
    UPC: "740119084743",
  },
  knownUnknownAspectNames: ["Brand", "MPN", "Model", "Color"],
  ...overrides,
})

test("exact official category binds only proven ITEM3525 values", () => {
  const result = buildEbayListingTaxonomyPreflightV1(input())
  assert.equal(result.schemaVersion, EBAY_LISTING_TAXONOMY_PREFLIGHT_V1)
  assert.equal(result.status, "CONSULTADO")
  assert.equal(result.categoryId, "183335")
  assert.deepEqual(result.provenValuesAutoBound, {
    Type: "Turntable",
    Material: "Plastic",
    Features: "Non-Slip Base",
    Size: "11 in",
    UPC: "740119084743",
  })
  assert.equal("Color" in result.resolvedAspects, false)
  assert.deepEqual(result.unprovenRequiredAspectNames, ["Brand"])
  assert.match(result.evidenceDigest, /^sha256:[0-9a-f]{64}$/)
})

test("required, recommended and optional aspects remain distinct with values", () => {
  const result = buildEbayListingTaxonomyPreflightV1(input())
  assert.deepEqual(result.requiredAspects.map((entry) => entry.name),
    ["Type", "Brand"])
  assert.deepEqual(result.recommendedAspects.map((entry) => entry.name),
    ["Material"])
  assert.deepEqual(result.optionalAspects.map((entry) => entry.name),
    ["Features", "Size", "UPC", "Color"])
  assert.deepEqual(result.requiredAspects[0].values.map((entry) => entry.value),
    ["Turntable", "Stand"])
})

test("selection-only mismatch never fabricates a value", () => {
  const result = buildEbayListingTaxonomyPreflightV1(input({
    provenProductValues: { Type: "Cake Decorating Wheel" },
    existingAspects: {},
  }))
  assert.deepEqual(result.provenValuesAutoBound, {})
  assert.deepEqual(result.unprovenRequiredAspectNames, ["Type", "Brand"])
})

test("unproven pre-existing selection-only values are discarded", () => {
  const result = buildEbayListingTaxonomyPreflightV1(input({
    provenProductValues: {},
    existingAspects: { Type: "Cake Turntable" },
  }))
  assert.equal("Type" in result.resolvedAspects, false)
  assert.deepEqual(result.unprovenRequiredAspectNames, ["Type", "Brand"])
})

test("mismatched, fallback or failed category remains fail closed", () => {
  for (const value of [
    taxonomy({ categoryId: "183336" }),
    taxonomy({ categoryResolution: "TITLE_SUGGESTION_FALLBACK" }),
    taxonomy({ status: "REQUEST_FAILED", observedAt: null, aspects: [] }),
  ]) {
    assert.throws(() => buildEbayListingTaxonomyPreflightV1(input({
      taxonomy: value,
    })), /EBAY_LISTING_TAXONOMY_EXACT_CATEGORY_UNAVAILABLE/)
  }
})

test("replay is deterministic apart from observation timestamp", () => {
  const first = buildEbayListingTaxonomyPreflightV1(input())
  const replay = buildEbayListingTaxonomyPreflightV1(input({
    taxonomy: taxonomy({ observedAt: "2026-08-27T19:05:00.000Z" }),
  }))
  assert.equal(first.evidenceDigest, replay.evidenceDigest)
  assert.deepEqual(first.resolvedAspects, replay.resolvedAspects)
})

test("existing draft-only route separates taxonomy preflight from visual gate", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/draft-only/route.ts", import.meta.url), "utf8")
  const page = await readFile(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url), "utf8")
  const commandCenter = await readFile(new URL(
    "../../app/api/admin/ebay/command-center/route.ts", import.meta.url), "utf8")
  assert.match(route, /action === "taxonomy_preflight"/)
  const preflightBody = route.match(
    /async function taxonomyPreflight[\s\S]*?\n}\n\nasync function preflightDraft/,
  )?.[0] ?? ""
  assert.ok(preflightBody)
  assert.doesNotMatch(preflightBody, /loadFinalListingReviewPublicationGate/)
  assert.match(preflightBody, /ebay_save_listing_package_guarded/)
  assert.match(preflightBody, /durableReadbackMatch/)
  assert.match(page, /action: "taxonomy_preflight"/)
  assert.match(page, /CONSULTADO/)
  assert.match(page, /Recomendado por eBay/)
  assert.match(page, /Opcional por eBay/)
  assert.match(commandCenter,
    /taxonomyPreflight: currentPackageData\.taxonomyPreflight \?\? null/)
  assert.match(commandCenter, /taxonomyPreflight\.status === "CONSULTADO"/)
})
