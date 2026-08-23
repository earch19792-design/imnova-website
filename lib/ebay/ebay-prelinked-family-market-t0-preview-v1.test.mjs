import assert from "node:assert/strict"
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

const {
  buildSellerOsFamilyMarketObservationV1,
  buildSellerOsFamilyT0PreviewV1,
} = await import("./ebay-prelinked-family-market-observation-v1.ts")

const DAY = 24 * 60 * 60
const COMMON_LIMITATIONS = Object.freeze([
  "ACTIVE_COMPARABLE_SERIES_UNAVAILABLE",
  "COMPETITION_UNPROVEN",
  "SELLER_DIVERSITY_UNAVAILABLE",
  "SOLD_PRICE_EXCLUDES_UNAVAILABLE_SHIPPING",
])

const fixtures = Object.freeze([
  {
    familyName: "Tesla Gen II NEMA adapters",
    identity: {
      productFunction: "adapt an electric vehicle mobile connector to a NEMA outlet",
      buyerUseCase: "charge a Tesla vehicle using a Gen 2 mobile connector from a compatible NEMA receptacle",
      category: "electric vehicle charging adapters",
      structuredDefinition: { compatibility: "Tesla Gen 2 Mobile Connector",
        connectorClass: "NEMA outlet", productType: "outlet adapter" },
    },
    queries: ["tesla nema 14 30 gen ii mobile connector smart adapter"],
    attributes: ["Tesla Gen II", "NEMA"],
    intent: ["Tesla mobile connector outlet adapter"],
    window: ["2026-04-27T20:43:48.278Z", "2026-07-26T20:43:48.278Z"],
    capturedAt: "2026-07-26T20:43:58.003Z",
    status: "FAMILY_DEMAND_PROVEN", comparableCount: 31, soldQuantity: 80,
    prices: [1, 179.95, 35.99],
    references: ["marketplace_product_research_capture_batches:cd46f580-6012-482a-8181-4e65d39cdf2b"],
    familyId: "market-family-v1:sha256:2ed3c1e514027de0240531bd3b10dfe80f987b9b5c78ae28c734b7773d718867",
    caseId: "opportunity-case-v1:sha256:eda23a561eac22520f9f8476edea6fe4f87cbe16454c7a8072970bbc0a96b11d",
    observationId: "family-market-observation-v1:sha256:97487e06f570dfb5d857affc28a22dd0278555042dfa4564afa0041fdd678a3d",
    evidenceDigest: "sha256:2ea30cf37e9c1052fefb4f21c0005592a951400584e4cc1a383649ff66e32b3c",
    limitations: [...COMMON_LIMITATIONS,
      "BROAD_PARENT_FAMILY_EVIDENCE_ONLY",
      "EXACT_NEMA_14_30_SUBTYPE_DEMAND_UNPROVEN",
      "PRICE_BAND_INCLUDES_OUTLIERS"],
  },
  {
    familyName: "Microcurrent facial devices",
    identity: {
      productFunction: "apply microcurrent facial stimulation",
      buyerUseCase: "perform at-home facial toning, lifting, and skin-tightening treatment",
      category: "microcurrent facial devices",
      structuredDefinition: { applicationArea: "face", technology: "microcurrent",
        productType: "facial device" },
    },
    queries: ["5 in 1 microcurrent facial device for skin tightening lifting"],
    attributes: ["microcurrent", "facial"],
    intent: ["at-home facial toning"],
    window: ["2026-04-27T20:40:35.693Z", "2026-07-26T20:40:35.693Z"],
    capturedAt: "2026-07-26T20:40:51.688Z",
    status: "FAMILY_DEMAND_PROVEN", comparableCount: 10, soldQuantity: 15,
    prices: [17, 113.56, 27.17],
    references: ["marketplace_product_research_capture_batches:f70ddcf8-307f-4e9a-9b69-93c40a14a8e4"],
    familyId: "market-family-v1:sha256:d3869ea0436e730ca3529b1864acf57a7c2dfb2b953bed6d0204b34545705c29",
    caseId: "opportunity-case-v1:sha256:9d7969342033ce87d646001b520a8ac6c3a9d0d457e14a9e6e933530fddf0669",
    observationId: "family-market-observation-v1:sha256:935adf2d5f0618c9ae76109f571737a2a912eea55052ec147844b79d3b395dc2",
    evidenceDigest: "sha256:3f18f15cdc9cb629b4dde543a1ee2d19003b0952c08d6b3b498f999b32f55de3",
    limitations: [...COMMON_LIMITATIONS, "EXACT_PRODUCT_DEMAND_UNPROVEN"],
  },
  {
    familyName: "Fragrances for women",
    identity: {
      productFunction: "apply personal fragrance",
      buyerUseCase: "wear personal fragrance intended for women",
      category: "fragrances for women",
      structuredDefinition: { audience: "women", productType: "fragrance" },
    },
    queries: ["grace boom for women", "miss delicate for women"],
    attributes: ["fragrance", "women"],
    intent: ["women personal fragrance"],
    window: ["2026-04-27T20:50:02.209Z", "2026-07-27T02:29:35.757Z"],
    capturedAt: "2026-07-27T02:29:49.548Z",
    status: "FAMILY_DEMAND_SUPPORTED", comparableCount: 5, soldQuantity: 8,
    prices: [6, 47.17, 14.25],
    references: [
      "marketplace_product_research_capture_observations:853a1bfa-c726-4467-bf71-d7092f13ec40",
      "marketplace_product_research_capture_observations:5fa368dd-d5d0-4592-91a9-9f4a3e55039b",
      "marketplace_product_research_capture_observations:721e9bb1-ee4c-4da4-b682-7962ee54be98",
      "marketplace_product_research_capture_observations:7054a0d7-5fbe-4e76-aedb-2c4008c8491b",
      "marketplace_product_research_capture_observations:7b0b8d32-ea3b-48cd-814e-95340a98cbef",
    ],
    familyId: "market-family-v1:sha256:34ac4e168124d7c60b578aec8a0fcb97f31599e387080774e63e94a40c45e116",
    caseId: "opportunity-case-v1:sha256:8c9b70f6188b7571375b5ab0f6e4180e31f7a388cdf74888e34084e4d2eacdc5",
    observationId: "family-market-observation-v1:sha256:cf0df1bbd2a4e2589ad5e0b50fd64b59f1cd9f9c7454a48397ca1b1690d161c1",
    evidenceDigest: "sha256:106a4250fca7e80f2808d9dbe175d3a52476e7ea3803eb14b19a1ca9ae942861",
    limitations: [...COMMON_LIMITATIONS, "EXACT_PRODUCT_DEMAND_UNPROVEN",
      "MULTI_QUERY_CAPTURE_WINDOWS_NOT_IDENTICAL",
      "UNRELATED_BATCH_ROWS_EXCLUDED_22"],
  },
  {
    familyName: "Rug grippers",
    identity: {
      productFunction: "secure a rug against slipping and shifting",
      buyerUseCase: "keep area rugs stable on floors",
      category: "rug grippers and anti-slip accessories",
      structuredDefinition: { productType: "rug gripper", targetObject: "area rug" },
    },
    queries: ["16 pack non slip rug grippers washable"],
    attributes: ["anti-slip", "rug"],
    intent: ["keep area rug from slipping"],
    window: ["2026-04-27T21:29:09.848Z", "2026-07-26T21:29:09.848Z"],
    capturedAt: "2026-07-26T21:29:20.588Z",
    status: "FAMILY_DEMAND_SUPPORTED", comparableCount: 1, soldQuantity: 1,
    prices: [26.1, 26.1, 26.1],
    references: ["marketplace_product_research_capture_observations:bf69e067-b24f-4a1e-9fee-f0e5e3ccd518"],
    familyId: "market-family-v1:sha256:da6af6c920c039c76a614388b0a3d2de6abb4f7dc2553ee21e12ded35877623c",
    caseId: "opportunity-case-v1:sha256:f4efe6093c2bdc7a543f35fa4c7a34456fad1973603cbe6f48fa26cda49e2976",
    observationId: "family-market-observation-v1:sha256:fbefd9ec688c5d47457fd025120dcc9e6465bcb430b06ff5febcca336deef1ed",
    evidenceDigest: "sha256:fb3b75170c43e1795592a632a4ce4fb00fff0746b9e988d5a865390507f52e00",
    limitations: [...COMMON_LIMITATIONS, "SINGLE_COMPARABLE",
      "EXACT_PRODUCT_DEMAND_UNPROVEN"],
  },
  {
    familyName: "V60 gooseneck kettles",
    identity: {
      productFunction: "control water flow for pour-over coffee brewing",
      buyerUseCase: "prepare V60 pour-over coffee",
      category: "gooseneck coffee kettles",
      structuredDefinition: { brewMethod: "V60 pour-over",
        productType: "gooseneck kettle" },
    },
    queries: ["v60 buono gooseneck drip kettle 1200ml matte black"],
    attributes: ["gooseneck", "V60"],
    intent: ["V60 pour-over kettle"],
    window: ["2026-04-28T11:17:29.379Z", "2026-07-27T11:17:29.379Z"],
    capturedAt: "2026-07-27T11:17:40.467Z",
    status: "FAMILY_DEMAND_SUPPORTED", comparableCount: 1, soldQuantity: 1,
    prices: [27.99, 27.99, 27.99],
    references: ["marketplace_product_research_capture_observations:bf14afb8-8a64-4a40-adcb-5609148b91cf"],
    familyId: "market-family-v1:sha256:55df33b374d17359fadbf223468baf56d49c806387cabf26216ee04e503cdbde",
    caseId: "opportunity-case-v1:sha256:13b2483a39657f3063dedf0765015294d374bd258fc6d6bc4d252801f4819cba",
    observationId: "family-market-observation-v1:sha256:49cd62be907425a32b8dd26e46e35fb57fed05beee164086bc894a9986e263d7",
    evidenceDigest: "sha256:07faefee2726c31c6017e982d2dad5484da6c74c0323b8088156ca106a0be62d",
    limitations: [...COMMON_LIMITATIONS, "SINGLE_COMPARABLE",
      "EXACT_PRODUCT_DEMAND_UNPROVEN"],
  },
])

function preview(fixture) {
  const observation = buildSellerOsFamilyMarketObservationV1({
    familyDefinition: { identity: fixture.identity, familyName: fixture.familyName,
      familyQuerySet: fixture.queries, keyProductAttributes: fixture.attributes,
      keyBuyerIntentTerms: fixture.intent, adapterContract: "MarketEvidenceAdapter",
      adapterVersion: "I02R_T0_V1" },
    observationWindowStart: fixture.window[0], observationWindowEnd: fixture.window[1],
    familyDemandStatus: fixture.status, demandEvidenceClass: "OFFICIAL_SOLD_EVIDENCE",
    sourceStatus: "AVAILABLE", aggregationSemantics: "CUMULATIVE_SNAPSHOT",
    demandEvidenceReferences: fixture.references,
    demandEvidenceDigest: fixture.evidenceDigest,
    soldComparableCount: fixture.comparableCount,
    soldQuantityEvidence: { quantity: fixture.soldQuantity,
      authorityClass: "OFFICIAL_EXTERNAL_FACT", evidenceReferences: fixture.references },
    activeComparableCount: null, sellerDiversity: null,
    priceBand: { currency: "USD", minimum: fixture.prices[0],
      maximum: fixture.prices[1] },
    priceMedian: fixture.prices[2], priceDistributionEvidence: fixture.references,
    competitionState: "UNPROVEN", buyerIntentTerms: fixture.intent,
    keywordState: "AVAILABLE", attributeProfile: fixture.identity.structuredDefinition,
    opportunityTypes: ["DEMAND_FIRST_TEST_LAUNCH"],
    evidenceObservedAt: fixture.capturedAt, sourceUpdatedAt: fixture.capturedAt,
    maximumAgeSeconds: 30 * DAY, sourceAdapter: "MarketEvidenceAdapter",
    sourceContractVersion: "SELLER_OS_DURABLE_SOLD_EVIDENCE_ADAPTER_V1",
    limitations: fixture.limitations,
  })
  return buildSellerOsFamilyT0PreviewV1({ observation,
    familyName: fixture.familyName, nextReviewCondition: "TIME_WINDOW_ELAPSED",
    momentumPolicyVersion: "SELLER_OS_FAMILY_MARKET_MOMENTUM_POLICY_V1" })
}

test("durable-evidence T0 canary contains exactly two proven and three supported families", () => {
  const previews = fixtures.map(preview)
  assert.equal(previews.length, 5)
  assert.equal(previews.filter((item) => item.demandStatus ===
    "FAMILY_DEMAND_PROVEN").length, 2)
  assert.equal(previews.filter((item) => item.demandStatus ===
    "FAMILY_DEMAND_SUPPORTED").length, 3)
  assert.ok(previews.every((item) => item.momentumStatus ===
    "INSUFFICIENT_HISTORY" && item.nextReviewCondition ===
    "TIME_WINDOW_ELAPSED" && item.realWrite === false))
})

test("T0 identities bind exactly to the evidence-audited family, case and window IDs", () => {
  fixtures.map(preview).forEach((item, index) => {
    assert.equal(item.familyId, fixtures[index].familyId)
    assert.equal(item.opportunityCaseId, fixtures[index].caseId)
    assert.equal(item.t0ObservationPreview.observationId,
      fixtures[index].observationId)
  })
})

test("Tesla exact NEMA 14-30 demand remains unproven inside the broader proven family", () => {
  const tesla = preview(fixtures[0])
  assert.equal(tesla.demandStatus, "FAMILY_DEMAND_PROVEN")
  assert.ok(tesla.t0ObservationPreview.limitations.includes(
    "EXACT_NEMA_14_30_SUBTYPE_DEMAND_UNPROVEN"))
  assert.doesNotMatch(JSON.stringify(tesla.t0ObservationPreview
    .attributeProfile), /14-30/)
})
