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

const {
  buildEbayCategoryResolverProductTruthV1,
  canonicalCategoryBindingNeedsDurableSaveV1,
  ebayCategoryTaxonomySnapshotDigestV1,
  mergeCanonicalCategoryBindingV1,
  normalizeEbayCategoryResolverIdentityV1,
  rankEbayCategoryCandidatesV1,
  resolveAndBindEbayListingCategoryV1,
  resolveEbayCategoryV1,
} = await import("./ebay-category-resolver-v1.ts")

const windowFilmContext = {
  marketplaceId: "EBAY_US",
  listingPackageId: "11111111-1111-4111-8111-111111111111",
  opportunityId: "22222222-2222-4222-8222-222222222222",
  candidateKey: "smart-stocking:EBAY_US:second-window-film",
}

const aspect = (name, required = false) => ({
  name,
  mode: "FREE_TEXT",
  cardinality: "SINGLE",
  maxLength: null,
  dataType: "STRING",
  format: null,
  advancedDataType: null,
  expectedRequiredByDate: null,
  required,
  enabledForVariations: false,
  usage: required ? "REQUIRED" : "OPTIONAL",
  suggestedValues: [],
  values: [],
  valuesComplete: true,
  constraintsComplete: true,
})

const taxonomy = (categoryId = "175757", overrides = {}) => {
  const aspects = [aspect("Type", true), aspect("Size")]
  return {
    status: "AVAILABLE",
    categoryTreeId: "0",
    categoryTreeVersion: "142",
    categoryId,
    categoryName: categoryId === "175757" ? "Window Film" : "Other",
    taxonomyMarketplaceId: "EBAY_US",
    observedAt: "2026-08-27T20:00:00.000Z",
    aspects,
    requiredAspects: aspects.filter((entry) => entry.required),
    recommendedAspects: [],
    categoryResolution: "KNOWN_CATEGORY",
    failureCode: null,
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    ...overrides,
  }
}

const windowFilmOpportunity = (candidateKey = windowFilmContext.candidateKey) => ({
  id: windowFilmContext.opportunityId,
  candidate_key: candidateKey,
  product_title: "Window Privacy Film 23.6 in x 9.84 ft",
  gtin: "740145348659",
  best_selling_matches: [],
  assessment: {
    productTruth: {
      title: "Window Privacy Film 23.6 in x 9.84 ft",
      brand: {
        noManufacturerBrandClaim: "UNPROVEN",
        ebayBrandSemantics: "UNKNOWN",
      },
    },
    candidate: { gtin: "740145348659" },
    listingIntelligencePackage: {
      titleStrategy: { primarySearchPhrase: "window privacy film" },
      categoryRecommendation: {
        categoryId: "175757",
        categoryName: "Window Film",
      },
      itemSpecifics: {
        supplierConfirmed: {
          Type: "Window Film",
          Size: "23.6 in x 9.84 ft",
        },
      },
    },
  },
})

const cakeContext = {
  marketplaceId: "EBAY_US",
  listingPackageId: "42b4e4b5-1a12-4021-9182-89b782a5c6ac",
  opportunityId: "7dd33673-92d1-4be9-a2e2-4fc5675ad644",
  candidateKey: "smart-stocking:EBAY_US:9220835475680:48809646653664",
}

const cakeOpportunity = () => ({
  ...windowFilmOpportunity(cakeContext.candidateKey),
  id: cakeContext.opportunityId,
  product_title: "11 in Revolving Plastic Cake Turntable",
  gtin: "740119084743",
  assessment: {
    ...windowFilmOpportunity().assessment,
    productTruth: {
      title: "11 in Revolving Plastic Cake Turntable",
      productType: "Cake Turntable",
      normalizedProductFamily: "Cake Turntable",
      categoryId: "183335",
      categoryName: "Icing Turntables",
      brand: {
        noManufacturerBrandClaim: "PROVEN",
        ebayBrandSemantics: "UNBRANDED_SUPPORTED",
        taxonomyBrandValue: "Unbranded",
      },
    },
    listingIntelligencePackage: {
      titleStrategy: { primarySearchPhrase: "cake turntable" },
      categoryRecommendation: {
        categoryId: "183335",
        categoryName: "Icing Turntables",
        source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
        taxonomyStatus: "AVAILABLE",
      },
      itemSpecifics: {
        supplierConfirmed: {
          Type: "Cake Turntable",
          Material: "Plastic",
        },
      },
    },
  },
})

async function resolveExactCakeCategory(packageData) {
  const calls = []
  const brand = {
    ...aspect("Brand", true),
    mode: "SELECTION_ONLY",
    values: [{ value: "Unbranded", valueConstraints: [] }],
  }
  const result = await resolveAndBindEbayListingCategoryV1({
    supabase: {
      from() { throw new Error("EXACT_AUTHORITY_MUST_NOT_READ_LEARNING") },
      rpc() { throw new Error("EXACT_AUTHORITY_MUST_NOT_WRITE_LEARNING") },
    },
    accountKey: "seller-os-preview",
    context: cakeContext,
    opportunity: cakeOpportunity(),
    packageData,
    exactCanonicalCategory: {
      categoryId: "183335",
      categoryName: "Icing Turntables",
      authorityClass: "SELLER_OS_ITEM3525_FINAL_WORKSPACE_EVIDENCE_V1",
      exactProductIdentityVerified: true,
    },
    taxonomyReader: async (_query, categoryId) => {
      calls.push(categoryId)
      return taxonomy(categoryId, {
        categoryName: "Icing Turntables",
        categoryTreeVersion: "134",
        aspects: [aspect("Type", true), brand, aspect("Material")],
        requiredAspects: [aspect("Type", true), brand],
      })
    },
    now: "2026-08-29T01:00:00Z",
  })
  return { calls, result }
}

const identity = normalizeEbayCategoryResolverIdentityV1({
  productFamily: "Window Privacy Film",
  productType: "Window Film",
})

const learning = (overrides = {}) => ({
  id: "33333333-3333-4333-8333-333333333333",
  accountKey: "seller-os-preview",
  marketplaceId: "EBAY_US",
  normalizedProductFamily: identity.normalizedProductFamily,
  normalizedProductType: identity.normalizedProductType,
  familyTypeFingerprint: identity.familyTypeFingerprint,
  categoryId: "175757",
  categoryName: "Window Film",
  taxonomyTreeId: "0",
  taxonomyTreeVersion: "142",
  taxonomySnapshotDigest: ebayCategoryTaxonomySnapshotDigestV1(taxonomy()),
  taxonomyPass: true,
  requiredAspects: [],
  listingAcceptance: "UNKNOWN",
  confidenceTier: "HIGH_CONFIDENCE",
  confidenceScore: 96,
  lastValidatedAt: "2026-08-27T20:00:00.000Z",
  revalidateAfter: "2026-09-26T20:00:00.000Z",
  ...overrides,
})

test("family/type identity is normalized and marketplace scoped", () => {
  const left = normalizeEbayCategoryResolverIdentityV1({
    productFamily: " Window  Privacy—Film ", productType: "WINDOW FILM",
  })
  assert.equal(left.normalizedProductFamily, "window privacy film")
  assert.equal(left.normalizedProductType, "window film")
  assert.match(left.familyTypeFingerprint, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(left, identity)
})

test("missing official taxonomy capability is waiting, not a category verdict", async () => {
  const result = await resolveEbayCategoryV1({
    productTruth: buildEbayCategoryResolverProductTruthV1({
      opportunity: {
        product_title: "Exact new Luna product",
        best_selling_matches: [],
        assessment: { productTruth: { title: "Exact new Luna product" } },
      },
    }),
    learningRows: [],
    taxonomyReader: async () => ({
      status: "REQUEST_FAILED", categoryTreeId: null,
      categoryTreeVersion: null, categoryId: null, categoryName: null,
      taxonomyMarketplaceId: "EBAY_US", observedAt: null, aspects: [],
      requiredAspects: [], recommendedAspects: [],
      categoryResolution: "UNRESOLVED",
      failureCode: "EBAY_TAXONOMY_REQUEST_FAILED",
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }),
  })
  assert.equal(result.status, "CATEGORY_EXCEPTION")
  assert.equal(result.capabilityUnavailable, true)
  assert.equal(result.categoryBlockerReason, "WAITING_FOR_EBAY_CAPABILITY")
  assert.equal(result.categoryCandidateCount, 0)
  assert.equal(result.marketplaceWrites, 0)
})

test("exact Product Truth aspect values are authoritative without family inference", () => {
  const base = windowFilmOpportunity()
  const normalized = buildEbayCategoryResolverProductTruthV1({
    opportunity: {
      ...base,
      assessment: {
        ...base.assessment,
        productTruth: {
          ...base.assessment.productTruth,
          provenProductValues: { Style: "Layered", Type: "Necklace" },
        },
        listingIntelligencePackage: {
          ...base.assessment.listingIntelligencePackage,
          itemSpecifics: { supplierConfirmed: {} },
        },
      },
    },
  })
  assert.deepEqual(normalized.provenProductValues, {
    Style: "Layered", Type: "Necklace", UPC: "740145348659",
  })
  assert.equal(normalized.knownUnknownAspectNames.includes("Brand"), true)
})

test("conflicting exact aspect authorities fail closed", () => {
  const base = windowFilmOpportunity()
  assert.throws(() => buildEbayCategoryResolverProductTruthV1({
    opportunity: {
      ...base,
      assessment: {
        ...base.assessment,
        productTruth: {
          ...base.assessment.productTruth,
          provenProductValues: { Type: "Necklace" },
        },
        listingIntelligencePackage: {
          ...base.assessment.listingIntelligencePackage,
          itemSpecifics: { supplierConfirmed: { Type: "Pendant" } },
        },
      },
    },
  }), /EXACT_PRODUCT_TRUTH_ASPECT_CONFLICT/)
})

test("candidate ranking is deterministic and proven mappings outrank context", () => {
  const signals = [
    { categoryId: "999", source: "REFERENCE_CONTEXT" },
    { categoryId: "175757", source: "MARKET_CONTEXT" },
  ]
  const first = rankEbayCategoryCandidatesV1({
    signals, learningRows: [learning()], now: "2026-08-28T00:00:00Z",
  })
  const second = rankEbayCategoryCandidatesV1({
    signals: [...signals].reverse(), learningRows: [learning()],
    now: "2026-08-28T00:00:00Z",
  })
  assert.deepEqual(first.map((entry) => entry.categoryId),
    second.map((entry) => entry.categoryId))
  assert.equal(first[0].categoryId, "175757")
  assert.equal(first[0].freshMapping, true)
})

test("high-confidence Product Truth category is automatically Taxonomy validated", async () => {
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: {
      ...windowFilmOpportunity(),
      assessment: {
        ...windowFilmOpportunity().assessment,
        productTruth: {
          ...windowFilmOpportunity().assessment.productTruth,
          categoryId: "175757",
          categoryName: "Window Film",
        },
      },
    },
  })
  const calls = []
  const result = await resolveEbayCategoryV1({
    productTruth,
    taxonomyReader: async (_query, categoryId) => {
      calls.push(categoryId)
      return taxonomy(categoryId)
    },
  })
  assert.equal(result.status, "AUTO_SELECTED")
  assert.equal(result.selectedCategory.categoryId, "175757")
  assert.deepEqual(calls, ["175757"])
  assert.equal(result.manualCategorySelectionRequired, false)
  assert.equal(result.codexRequired, false)
})

test("second synthetic Window Film reuses learned category without Codex", async () => {
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: windowFilmOpportunity(),
  })
  const calls = []
  const result = await resolveEbayCategoryV1({
    productTruth,
    learningRows: [learning({ listingAcceptance: "ACCEPTED" })],
    taxonomyReader: async (_query, categoryId) => {
      calls.push(categoryId)
      return taxonomy(categoryId)
    },
    now: "2026-08-28T00:00:00Z",
  })
  assert.equal(result.status, "AUTO_SELECTED")
  assert.equal(result.selectedCategory.categoryId, "175757")
  assert.deepEqual(calls, ["175757"])
  assert.equal(result.factoryContinuationAllowed, true)
  assert.equal(result.manualCategorySelectionRequired, false)
  assert.equal(result.codexRequired, false)
})

test("unproven required Color remains an explicit product-truth gate", () => {
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: windowFilmOpportunity(),
  })
  assert.ok(productTruth.knownUnknownAspectNames.includes("Color"))
  assert.equal(
    productTruth.unprovenAspectEvidenceRequirements.Color,
    "AUTHORITATIVE_PRODUCT_COLOR_EVIDENCE_REQUIRED",
  )
  assert.equal(productTruth.provenProductValues.Color, undefined)
})

test("proven no-manufacturer Brand binds Unbranded through the canonical Product Truth normalizer", () => {
  const opportunity = windowFilmOpportunity()
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: {
      ...opportunity,
      assessment: {
        ...opportunity.assessment,
        productTruth: {
          ...opportunity.assessment.productTruth,
          brand: {
            noManufacturerBrandClaim: "PROVEN",
            ebayBrandSemantics: "UNBRANDED_SUPPORTED",
            taxonomyBrandValue: "Unbranded",
          },
        },
      },
    },
  })
  assert.equal(productTruth.provenProductValues.Brand, "Unbranded")
  assert.equal(productTruth.knownUnknownAspectNames.includes("Brand"), false)
  assert.equal(productTruth.unprovenAspectEvidenceRequirements.Brand,
    undefined)
})

test("canonical category binding is durably saved only when the resolver changes it", () => {
  const currentPackageData = {
    categoryId: "183335",
    categoryName: "Icing & Decorating Turntables",
    aspects: { Type: "Turntable" },
    taxonomyPreflight: { evidenceDigest: "before", resolvedAspects: {
      Type: "Turntable",
    } },
    categoryResolverV1: null,
    sourceRefresh: { refreshedAt: "2026-08-28T23:13:53.855Z" },
  }
  const resolvedPackageData = {
    ...currentPackageData,
    aspects: { Type: "Turntable", Brand: "Unbranded" },
    taxonomyPreflight: {
      evidenceDigest: "after",
      resolvedAspects: { Type: "Turntable", Brand: "Unbranded" },
      provenValuesAutoBound: { Brand: "Unbranded" },
      unprovenRequiredAspectNames: [],
    },
    categoryResolverV1: {
      status: "AUTO_SELECTED",
      taxonomyPreflightEvidenceDigest: "after",
    },
  }
  assert.equal(canonicalCategoryBindingNeedsDurableSaveV1({
    currentPackageData,
    resolvedPackageData,
  }), true)
  const merged = mergeCanonicalCategoryBindingV1({
    durablePackageData: {
      ...currentPackageData,
      pricing: { targetPrice: 25.99 },
    },
    resolvedPackageData,
  })
  assert.equal(merged.aspects.Brand, "Unbranded")
  assert.deepEqual(merged.taxonomyPreflight.provenValuesAutoBound, {
    Brand: "Unbranded",
  })
  assert.deepEqual(merged.pricing, { targetPrice: 25.99 })
  assert.equal(canonicalCategoryBindingNeedsDurableSaveV1({
    currentPackageData: merged,
    resolvedPackageData: merged,
  }), false)
})

test("EXACT_CANONICAL_CATEGORY + ASPECT_REFRESH -> CATEGORY_UNCHANGED", async () => {
  const { calls, result } = await resolveExactCakeCategory({
    categoryId: "183335",
    categoryName: "Icing Turntables",
    aspects: { Type: "Cake Turntable", Material: "Plastic" },
  })
  assert.deepEqual(calls, ["183335"])
  assert.equal(result.packageData.categoryId, "183335")
  assert.equal(result.packageData.categoryResolverV1
    .exactCanonicalCategoryPreserved, true)
  assert.equal(result.packageData.categoryResolverV1
    .explicitReclassificationRequired, true)
  assert.equal(result.learning, null)
})

test("PROVEN_UNBRANDED -> BRAND_BINDS_WITHOUT_CATEGORY_RESELECTION", async () => {
  const { calls, result } = await resolveExactCakeCategory({
    categoryId: "183335",
    categoryName: "Icing Turntables",
    aspects: { Type: "Cake Turntable", Material: "Plastic" },
  })
  assert.deepEqual(calls, ["183335"])
  assert.equal(result.packageData.categoryId, "183335")
  assert.equal(result.packageData.aspects.Brand, "Unbranded")
  assert.equal(result.packageData.taxonomyPreflight
    .provenValuesAutoBound.Brand, "Unbranded")
})

test("PACKAGE_CATEGORY_DIVERGED_BY_REFRESH_BUG + EXACT_CANONICAL_EVIDENCE -> GUARDED_RECONCILIATION_TO_CANONICAL_CATEGORY", async () => {
  const durable = {
    categoryId: "183356",
    categoryName: "Cake Stands",
    aspects: {
      Type: "Cake Turntable",
      Brand: "Unbranded",
      Material: "Plastic",
      Color: "Pink",
    },
    taxonomyPreflight: { categoryId: "183356" },
    categoryResolverV1: { selectedCategoryId: "183356" },
    pricing: { targetPrice: 25.99 },
  }
  const { result } = await resolveExactCakeCategory(durable)
  assert.equal(canonicalCategoryBindingNeedsDurableSaveV1({
    currentPackageData: durable,
    resolvedPackageData: result.packageData,
  }), true)
  const reconciled = mergeCanonicalCategoryBindingV1({
    durablePackageData: durable,
    resolvedPackageData: result.packageData,
  })
  assert.equal(reconciled.categoryId, "183335")
  assert.equal(reconciled.aspects.Brand, "Unbranded")
  assert.deepEqual(reconciled.pricing, { targetPrice: 25.99 })
})

test("WRONG_CATEGORY_COLOR_REQUIREMENT -> NOT_CARRIED_AFTER_CANONICAL_CATEGORY_RESTORE", async () => {
  const { result } = await resolveExactCakeCategory({
    categoryId: "183356",
    categoryName: "Cake Stands",
    aspects: { Type: "Cake Turntable", Brand: "Unbranded", Color: "Pink" },
    taxonomyPreflight: {
      categoryId: "183356",
      unprovenRequiredAspectNames: ["Color"],
    },
    categoryResolverV1: { selectedCategoryId: "183356" },
  })
  assert.equal("Color" in result.packageData.aspects, false)
  assert.deepEqual(
    result.packageData.taxonomyPreflight.unprovenRequiredAspectNames,
    [],
  )
})

test("proven Unbranded is auto-bound when official Taxonomy allows it", async () => {
  const context = {
    marketplaceId: "EBAY_US",
    listingPackageId: "42b4e4b5-1a12-4021-9182-89b782a5c6ac",
    opportunityId: "7dd33673-92d1-4be9-a2e2-4fc5675ad644",
    candidateKey:
      "smart-stocking:EBAY_US:9220835475680:48809646653664",
  }
  const base = windowFilmOpportunity(context.candidateKey)
  const opportunity = {
    ...base,
    id: context.opportunityId,
    product_title: "11 in Revolving Plastic Cake Turntable",
    assessment: {
      ...base.assessment,
      productTruth: {
        ...base.assessment.productTruth,
        categoryId: "183335",
        categoryName: "Icing & Decorating Turntables",
        brand: {
          noManufacturerBrandClaim: "PROVEN",
          ebayBrandSemantics: "UNBRANDED_SUPPORTED",
          taxonomyBrandValue: "Unbranded",
        },
      },
      listingIntelligencePackage: {
        ...base.assessment.listingIntelligencePackage,
        categoryRecommendation: {
          categoryId: "183335",
          categoryName: "Icing & Decorating Turntables",
        },
        itemSpecifics: { supplierConfirmed: { Type: "Turntable" } },
      },
    },
  }
  const normalized = buildEbayCategoryResolverProductTruthV1({ opportunity })
  const supabase = {
    from() {
      const chain = {
        select() { return chain },
        eq() { return chain },
        order() { return chain },
        limit() { return Promise.resolve({ data: [], error: null }) },
      }
      return chain
    },
    async rpc(_name, args) {
      return { data: [{
        id: "44444444-4444-4444-8444-444444444444",
        account_key: "seller-os-preview",
        marketplace_id: "EBAY_US",
        normalized_product_family: normalized.normalizedProductFamily,
        normalized_product_type: normalized.normalizedProductType,
        family_type_fingerprint: normalized.familyTypeFingerprint,
        category_id: "183335",
        category_name: "Icing & Decorating Turntables",
        taxonomy_tree_id: "0",
        taxonomy_tree_version: "134",
        taxonomy_snapshot_digest: args.p_taxonomy_snapshot_digest,
        taxonomy_pass: true,
        required_aspects: args.p_required_aspects,
        listing_acceptance: "UNKNOWN",
        confidence_tier: "HIGH_CONFIDENCE",
        confidence_score: args.p_confidence_score,
        last_validated_at: args.p_validated_at,
        revalidate_after: args.p_revalidate_after,
      }], error: null }
    },
  }
  const brandAspect = {
    ...aspect("Brand", true),
    mode: "SELECTION_ONLY",
    values: [{ value: "Unbranded", valueConstraints: [] }],
  }
  const result = await resolveAndBindEbayListingCategoryV1({
    supabase,
    accountKey: "seller-os-preview",
    context,
    opportunity,
    packageData: {
      categoryId: "183335",
      aspects: { Type: "Turntable" },
    },
    taxonomyReader: async () => taxonomy("183335", {
      categoryName: "Icing & Decorating Turntables",
      categoryTreeVersion: "134",
      aspects: [aspect("Type", true), brandAspect],
      requiredAspects: [aspect("Type", true), brandAspect],
    }),
    now: "2026-08-28T23:20:00Z",
  })
  assert.equal(result.packageData.aspects.Brand, "Unbranded")
  assert.equal(
    result.packageData.taxonomyPreflight.provenValuesAutoBound.Brand,
    "Unbranded",
  )
  assert.deepEqual(
    result.packageData.taxonomyPreflight.unprovenRequiredAspectNames,
    [],
  )
})

test("command-center persists a changed canonical binding through the existing guard", () => {
  const commandCenter = readFileSync(
    new URL("../../app/api/admin/ebay/command-center/route.ts", import.meta.url),
    "utf8",
  )
  const prepareStart = commandCenter.indexOf('if (action === "prepare_package")')
  const saveStart = commandCenter.indexOf(
    'if (action === "save_package")', prepareStart,
  )
  const prepare = commandCenter.slice(prepareStart, saveStart)
  const refreshIndex = prepare.indexOf("p_operation: \"refresh\"")
  const changeGateIndex = prepare.indexOf(
    "canonicalCategoryBindingNeedsDurableSaveV1",
  )
  const durableSaveIndex = prepare.indexOf("p_operation: \"save\"", changeGateIndex)
  assert.ok(refreshIndex > 0)
  assert.ok(changeGateIndex > refreshIndex)
  assert.ok(durableSaveIndex > changeGateIndex)
  assert.match(prepare, /canonicalCategoryBindingPersisted:/)
  assert.match(prepare,
    /exactCanonicalCategory: smartStockingEvidence \? \{/)
  assert.match(prepare,
    /categoryId: smartStockingEvidence\.category\.categoryId/)
  assert.match(prepare,
    /p_operation: "save"/)
  assert.doesNotMatch(prepare,
    /publishEbayOfferOnce|createEbayUnpublishedOffer|createOrReplaceEbayDraftInventoryItem|withdrawEbayOffer/)
})

test("stale learned mappings are revalidated before reuse", async () => {
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: windowFilmOpportunity(),
  })
  let exactReads = 0
  const result = await resolveEbayCategoryV1({
    productTruth,
    learningRows: [learning({ revalidateAfter: "2026-08-01T00:00:00Z" })],
    taxonomyReader: async (_query, categoryId) => {
      if (categoryId === "175757") exactReads += 1
      return taxonomy(categoryId)
    },
    now: "2026-08-28T00:00:00Z",
  })
  assert.equal(result.status, "AUTO_SELECTED")
  assert.equal(result.selectedCategory.staleMapping, true)
  assert.equal(exactReads, 1)
})

test("ambiguous categories test only bounded candidates and emit CATEGORY_EXCEPTION", async () => {
  const productTruth = {
    ...buildEbayCategoryResolverProductTruthV1({
      opportunity: windowFilmOpportunity(),
    }),
    categorySignals: [
      { categoryId: "100", source: "PRODUCT_TRUTH" },
      { categoryId: "200", source: "PRODUCT_TRUTH" },
    ],
  }
  const result = await resolveEbayCategoryV1({
    productTruth,
    taxonomyReader: async (_query, categoryId) => categoryId
      ? taxonomy(categoryId)
      : taxonomy(null, {
        status: "CATEGORY_NOT_RESOLVED", categoryId: null,
        categoryResolution: "UNRESOLVED", observedAt: null,
      }),
  })
  assert.equal(result.status, "CATEGORY_EXCEPTION")
  assert.equal(result.resolutionClass, "AMBIGUOUS")
  assert.deepEqual(result.testedCategoryIds, ["100", "200"])
  assert.ok(result.testedCategoryIds.length <= 3)
  assert.equal(result.factoryContinuationAllowed, true)
  assert.equal(result.codexRequired, false)
})

test("unresolved products continue the factory as a non-human exception", async () => {
  const sparseOpportunity = {
    product_title: "Exact supplier product title with no classified type",
    best_selling_matches: [],
    assessment: { productTruth: {
      title: "Exact supplier product title with no classified type",
    } },
  }
  const sparseTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: sparseOpportunity,
  })
  assert.equal(sparseTruth.normalizedProductFamily,
    "exact supplier product title with no classified type")
  const productTruth = {
    ...sparseTruth,
    categorySignals: [],
  }
  const result = await resolveEbayCategoryV1({
    productTruth,
    taxonomyReader: async () => taxonomy(null, {
      status: "CATEGORY_NOT_RESOLVED", categoryId: null,
      categoryResolution: "UNRESOLVED", observedAt: null,
    }),
  })
  assert.equal(result.status, "CATEGORY_EXCEPTION")
  assert.equal(result.resolutionClass, "UNRESOLVED")
  assert.equal(result.factoryContinuationAllowed, true)
  assert.equal(result.manualCategorySelectionRequired, false)
  assert.equal(result.codexRequired, false)
})

test("Taxonomy snapshot version or structure changes the durable digest", () => {
  const original = ebayCategoryTaxonomySnapshotDigestV1(taxonomy())
  const versionChanged = ebayCategoryTaxonomySnapshotDigestV1(taxonomy(
    "175757", { categoryTreeVersion: "143" }))
  const aspectChanged = ebayCategoryTaxonomySnapshotDigestV1(taxonomy(
    "175757", { aspects: [aspect("Type", true), aspect("Brand", true)] }))
  assert.notEqual(original, versionChanged)
  assert.notEqual(original, aspectChanged)
})

test("second Window Film package is bound to its own context and persisted mapping", async () => {
  const row = learning()
  const rpcCalls = []
  const supabase = {
    from(table) {
      assert.equal(table, "ebay_category_resolution_learning_v1")
      const chain = {
        select() { return chain },
        eq() { return chain },
        order() { return chain },
        limit() { return Promise.resolve({ data: [
          {
            id: row.id,
            account_key: row.accountKey,
            marketplace_id: row.marketplaceId,
            normalized_product_family: row.normalizedProductFamily,
            normalized_product_type: row.normalizedProductType,
            family_type_fingerprint: row.familyTypeFingerprint,
            category_id: row.categoryId,
            category_name: row.categoryName,
            taxonomy_tree_id: row.taxonomyTreeId,
            taxonomy_tree_version: row.taxonomyTreeVersion,
            taxonomy_snapshot_digest: row.taxonomySnapshotDigest,
            taxonomy_pass: true,
            required_aspects: [],
            listing_acceptance: "UNKNOWN",
            confidence_tier: "HIGH_CONFIDENCE",
            confidence_score: 96,
            last_validated_at: row.lastValidatedAt,
            revalidate_after: row.revalidateAfter,
          },
        ], error: null }) },
      }
      return chain
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return { data: [{
        id: "44444444-4444-4444-8444-444444444444",
        account_key: "seller-os-preview",
        marketplace_id: "EBAY_US",
        normalized_product_family: identity.normalizedProductFamily,
        normalized_product_type: identity.normalizedProductType,
        family_type_fingerprint: identity.familyTypeFingerprint,
        category_id: "175757",
        category_name: "Window Film",
        taxonomy_tree_id: "0",
        taxonomy_tree_version: "142",
        taxonomy_snapshot_digest: args.p_taxonomy_snapshot_digest,
        taxonomy_pass: true,
        required_aspects: args.p_required_aspects,
        listing_acceptance: "UNKNOWN",
        confidence_tier: "HIGH_CONFIDENCE",
        confidence_score: args.p_confidence_score,
        last_validated_at: args.p_validated_at,
        revalidate_after: args.p_revalidate_after,
      }], error: null }
    },
  }
  const result = await resolveAndBindEbayListingCategoryV1({
    supabase,
    accountKey: "seller-os-preview",
    context: windowFilmContext,
    opportunity: windowFilmOpportunity(),
    packageData: { title: "Window Privacy Film", aspects: {} },
    taxonomyReader: async (_query, categoryId) => taxonomy(categoryId),
    now: "2026-08-28T00:00:00Z",
  })
  assert.equal(result.resolution.status, "AUTO_SELECTED")
  assert.equal(result.packageData.categoryId, "175757")
  assert.equal(result.packageData.categoryResolverV1.listingPackageId,
    windowFilmContext.listingPackageId)
  assert.equal(result.packageData.taxonomyPreflight.listingPackageId,
    windowFilmContext.listingPackageId)
  assert.equal(result.packageData.categoryResolverV1
    .taxonomyPreflightEvidenceDigest,
  result.packageData.taxonomyPreflight.evidenceDigest)
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].args.p_source_candidate_key,
    windowFilmContext.candidateKey)
})

test("foreign candidate aspects never survive automatic category resolution", async () => {
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: windowFilmOpportunity(),
  })
  const result = await resolveAndBindEbayListingCategoryV1({
    supabase: {
      from() {
        const chain = {
          select() { return chain },
          eq() { return chain },
          order() { return chain },
          limit() { return Promise.resolve({ data: [], error: null }) },
        }
        return chain
      },
      async rpc(_name, args) {
        return { data: [{
          id: "55555555-5555-4555-8555-555555555555",
          account_key: "seller-os-preview",
          marketplace_id: "EBAY_US",
          normalized_product_family: productTruth.normalizedProductFamily,
          normalized_product_type: productTruth.normalizedProductType,
          family_type_fingerprint: productTruth.familyTypeFingerprint,
          category_id: "175757",
          category_name: "Window Film",
          taxonomy_tree_id: "0",
          taxonomy_tree_version: "142",
          taxonomy_snapshot_digest: args.p_taxonomy_snapshot_digest,
          taxonomy_pass: true,
          required_aspects: args.p_required_aspects,
          listing_acceptance: "UNKNOWN",
          confidence_tier: "HIGH_CONFIDENCE",
          confidence_score: args.p_confidence_score,
          last_validated_at: args.p_validated_at,
          revalidate_after: args.p_revalidate_after,
        }], error: null }
      },
    },
    accountKey: "seller-os-preview",
    context: windowFilmContext,
    opportunity: {
      ...windowFilmOpportunity(),
      assessment: {
        ...windowFilmOpportunity().assessment,
        productTruth: {
          ...windowFilmOpportunity().assessment.productTruth,
          categoryId: "175757",
          categoryName: "Window Film",
        },
      },
    },
    packageData: {
      title: "Window Privacy Film",
      categoryId: "183335",
      aspects: { Type: "Turntable", Pattern: "Cupcakes" },
      taxonomyPreflight: {
        evidenceDigest: `sha256:${"a".repeat(64)}`,
      },
      categoryResolverV1: {
        authorityClass: "SELLER_OS_EBAY_CATEGORY_RESOLVER_V1",
        status: "AUTO_SELECTED",
        resolutionClass: "HIGH_CONFIDENCE",
        contextBindingVersion: "SELLER_OS_EBAY_LISTING_CONTEXT_ISOLATION_V1",
        marketplaceId: "EBAY_US",
        listingPackageId: "99999999-9999-4999-8999-999999999999",
        opportunityId: "88888888-8888-4888-8888-888888888888",
        candidateKey: "smart-stocking:EBAY_US:foreign-cake",
        selectedCategoryId: "183335",
        learningId: "77777777-7777-4777-8777-777777777777",
        taxonomySnapshotDigest: `sha256:${"b".repeat(64)}`,
        taxonomyPreflightEvidenceDigest: `sha256:${"a".repeat(64)}`,
      },
    },
    taxonomyReader: async (_query, categoryId) => taxonomy(categoryId, {
      aspects: [aspect("Type", true), aspect("Size"), aspect("Pattern")],
      requiredAspects: [aspect("Type", true)],
    }),
    now: "2026-08-28T00:00:00Z",
  })
  assert.equal(result.resolution.status, "AUTO_SELECTED")
  assert.deepEqual(result.packageData.aspects, {
    Type: "Window Film",
    Size: "23.6 in x 9.84 ft",
  })
  assert.equal("Pattern" in result.packageData.aspects, false)
})

test("migration and routes enforce durable isolation without marketplace writes", () => {
  const migration = readFileSync(
    "supabase/migrations/20260828033309_seller_os_category_resolver_v1.sql",
    "utf8",
  )
  const aclHardening = readFileSync(
    "supabase/migrations/20260828040202_seller_os_category_resolver_acl_hardening_v1.sql",
    "utf8",
  )
  const commandCenter = readFileSync(
    "app/api/admin/ebay/command-center/route.ts", "utf8")
  const draftRoute = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts", "utf8")
  assert.match(migration,
    /unique \([\s\S]*account_key,[\s\S]*marketplace_id,[\s\S]*normalized_product_family,[\s\S]*normalized_product_type,[\s\S]*category_id,[\s\S]*taxonomy_tree_id,[\s\S]*taxonomy_tree_version,[\s\S]*taxonomy_snapshot_digest/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration,
    /revoke all on table public\.ebay_category_resolution_learning_v1[\s\S]*from anon, authenticated/)
  assert.match(migration, /EBAY_CATEGORY_RESOLVER_SOURCE_CONTEXT_MISMATCH/)
  assert.match(migration,
    /source_listing_package_id = coalesce\([\s\S]*learning\.source_listing_package_id/)
  assert.match(migration,
    /package_row\.package_data #>> '\{categoryResolverV1,learningId\}' =[\s\S]*learning\.id::text/)
  assert.doesNotMatch(migration, /\b(?:drop|truncate)\b/i)
  assert.match(aclHardening,
    /revoke all on table public\.ebay_category_resolution_learning_v1[\s\S]*from service_role/)
  assert.match(aclHardening,
    /grant select, insert, update on table[\s\S]*to service_role/)
  assert.doesNotMatch(aclHardening, /\b(?:drop|truncate|delete)\s+from\b/i)
  assert.match(commandCenter, /resolveAndBindEbayListingCategoryV1/)
  assert.match(commandCenter, /categoryResolverBindingMatchesContextV1/)
  assert.match(draftRoute, /recordEbayCategoryListingAcceptanceV1/)
  assert.doesNotMatch(commandCenter, /createEbay|publishEbay|offerEbay/)
})
