import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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

const d = await import("./ebay-prelinked-listing-fast-lane-foundation-v1.ts")
const {
  EconomicsEvidenceAdapter, LearningOutcomeAdapter, ListingReadinessAdapter,
  MarketEvidenceAdapter, PortfolioPolicyAdapter,
  SELLER_OS_LAUNCH_EVIDENCE_AUTHORITY_CLASSES_V1,
  SELLER_OS_PRELINKED_LAUNCH_ADAPTERS_V1, SupplierIdentityAdapter,
  buildSellerOsLaunchEvidencePackageV1, buildSellerOsLaunchOutcomeIdV1,
  buildSellerOsPrelinkedLaunchCandidateV1,
  buildSellerOsPrelinkedLaunchCandidateIdV1,
  buildSellerOsPrelinkedLaunchConfigurationV1,
  buildSellerOsPrelinkedLaunchIdV1,
  buildSellerOsPrelinkedLaunchShadowPoolV1,
  buildSellerOsPrelinkedLaunchShadowV1,
  createSellerOsPrelinkedLaunchLineageRegistryV1,
  getSellerOsPrelinkedListingFastLaneFoundationV1,
  requestSellerOsPrelinkedLaunchPublishV1,
} = d

const D = (character) => `sha256:${character.repeat(64)}`
const AT = "2026-08-22T16:00:00.000Z"
const UUID_A = "11111111-1111-4111-8111-111111111111"
const UUID_B = "22222222-2222-4222-8222-222222222222"
const SKU_A = "IMNOVA11111111111141118111111111111111"
function component(overrides = {}) {
  return { lunaProductId: "9220805755104", lunaVariantId: "48809607659744",
    lunaSku: "ITEM5810", supplierQuantityRequired: 1,
    supplierIdentityStatus: "EXACT_PRELINKED", p2LinkageId: null, ...overrides }
}
function configuration(overrides = {}) {
  return buildSellerOsPrelinkedLaunchConfigurationV1({
    accountKey: "canonical-ebay-account", marketplaceId: "EBAY_US",
    configurationMode: "SINGLE_COMPONENT", expectedComponentCount: 1,
    components: [component()], ...overrides })
}
function subject(config) {
  return { accountKey: config.accountKey, marketplaceId: config.marketplaceId,
    configurationIdentity: config.configurationIdentity,
    componentIdentityIds: config.components.map((item) => item.componentIdentityId) }
}
function evidenceInput(character, config, overrides = {}) {
  return { subject: subject(config), adapterVersion: "v1",
    reference: `evidence:${character}`, evidenceDigest: D(character),
    sourceContractVersion: "SOURCE_CONTRACT_V1", observedAt: AT,
    maximumAgeSeconds: 3600, availability: "AVAILABLE",
    authorityClass: "DURABLY_PERSISTED_FACT", blockerCodes: [], ...overrides }
}
function evidence(config) {
  return [
    SupplierIdentityAdapter(evidenceInput("a", config,
      { authorityClass: "DIRECT_OBSERVATION" })),
    MarketEvidenceAdapter(evidenceInput("b", config,
      { authorityClass: "OFFICIAL_EXTERNAL_FACT" })),
    EconomicsEvidenceAdapter(evidenceInput("c", config,
      { authorityClass: "DERIVED_FACT" })),
    ListingReadinessAdapter(evidenceInput("d", config,
      { authorityClass: "DURABLY_PERSISTED_FACT" })),
    PortfolioPolicyAdapter(evidenceInput("e", config,
      { authorityClass: "RECOMMENDATION" })),
    LearningOutcomeAdapter(evidenceInput("f", config,
      { authorityClass: "DERIVED_FACT" })),
  ]
}
function packageFor(config, items = evidence(config), overrides = {}) {
  return buildSellerOsLaunchEvidencePackageV1({ configuration: config,
    evidence: items, evaluatedAt: AT,
    p2DependencyGate: "PREPUBLICATION_PRELINKED_ONLY", ...overrides })
}
function provenance(overrides = {}) {
  return { authorityClass: "DURABLY_PERSISTED_FACT",
    sourceContractVersion: "SELLER_OS_OPPORTUNITY_CANDIDATE_V1",
    sourceReferences: ["opportunity:candidate-001"], observedAt: AT,
    limitations: ["PREPUBLICATION_SHADOW_ONLY"], productCaseLineage: null,
    ...overrides }
}
function candidate(overrides = {}) {
  const config = overrides.configuration ?? configuration()
  const pack = overrides.evidencePackage ?? packageFor(config)
  return buildSellerOsPrelinkedLaunchCandidateV1({ configuration: config,
    evidencePackage: pack,
    opportunityCandidateKey: "luna:9220805755104:48809607659744",
    launchScore: 95, scoreVersion: "SELLER_OS_LAUNCH_SCORE_V1",
    provenance: provenance(), canonicalEbaySku: null, listingPackageId: null,
    ebayItemId: null, p2LinkageId: null, createdAt: AT, updatedAt: AT,
    ...overrides })
}
function receipt(overrides = {}) {
  return { contractVersion: "SELLER_OS_EXTERNAL_PUBLICATION_RECEIPT_V1",
    authority: "OUTSIDE_OP_LAUNCH_I01", reference: "publisher:receipt-1",
    receiptDigest: D("9"), publishedAt: "2026-08-22T17:00:00.000Z",
    ...overrides }
}

test("contracts expose exactly six adapters and eight authority classes", () => {
  const foundation = getSellerOsPrelinkedListingFastLaneFoundationV1()
  assert.equal(foundation.candidateContractVersion,
    "SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_V1")
  assert.equal(foundation.evidencePackageContractVersion,
    "SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_V1")
  assert.deepEqual(SELLER_OS_PRELINKED_LAUNCH_ADAPTERS_V1, [
    "SupplierIdentityAdapter", "MarketEvidenceAdapter",
    "EconomicsEvidenceAdapter", "ListingReadinessAdapter",
    "PortfolioPolicyAdapter", "LearningOutcomeAdapter"])
  assert.deepEqual(SELLER_OS_LAUNCH_EVIDENCE_AUTHORITY_CLASSES_V1, [
    "OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT",
    "DERIVED_FACT", "INFERENCE", "RECOMMENDATION", "UNPROVEN", "UNAVAILABLE"])
  assert.deepEqual(foundation.gates, ["SUPPLY", "MARKET", "ECONOMICS", "LISTING"])
})

test("candidate exposes the complete V1 surface", () => {
  const value = candidate({ canonicalEbaySku: SKU_A,
    listingPackageId: UUID_A })
  for (const key of ["launchCandidateId", "configurationIdentity", "lunaProductId",
    "lunaVariantId", "lunaSku", "supplierQuantityRequired", "supplierIdentityStatus",
    "marketEvidenceStatus", "economicsStatus", "listingReadinessStatus",
    "supplyReadinessStatus", "hardBlockers", "launchClassification", "launchScore",
    "scoreVersion", "evidencePackageId", "evidenceDigest", "provenance",
    "canonicalEbaySku", "listingPackageId", "ebayItemId", "p2LinkageId",
    "outcomeTrackingId", "createdAt", "updatedAt"]) assert.ok(key in value, key)
  assert.equal(value.lunaProductId, "9220805755104")
  assert.equal(value.supplierQuantityRequired, 1)
  assert.equal(value.launchClassification, "READY_TO_LIST")
  assert.equal(value.publishAllowed, false)
})

test("one logical configuration has one candidate across replay, discovery and account lineage", () => {
  const baseline = candidate()
  for (let index = 0; index < 100; index += 1) {
    const replay = candidate({ opportunityCandidateKey: `discovery:${index}`,
      createdAt: new Date(Date.parse(AT) + index * 1000).toISOString(),
      updatedAt: new Date(Date.parse(AT) + index * 1000).toISOString() })
    assert.equal(replay.launchCandidateId, baseline.launchCandidateId)
    assert.equal(replay.configurationIdentity, baseline.configurationIdentity)
    assert.equal(replay.launchId, baseline.launchId)
  }
  const otherAccountConfig = configuration({ accountKey: "another-ebay-account" })
  const otherAccount = candidate({ configuration: otherAccountConfig,
    evidencePackage: packageFor(otherAccountConfig) })
  assert.equal(otherAccount.launchCandidateId, baseline.launchCandidateId)
})

test("configuration, candidate and launch identities use the exact Postgres framing", () => {
  const config = configuration()
  const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex")
  const expectedConfiguration = `launch-configuration-v1:sha256:${digest([
    "SELLER_OS_PRELINKED_CONFIGURATION_V1", "SINGLE_COMPONENT",
    "9220805755104:48809607659744:1",
  ].join("\n"))}`
  assert.equal(config.configurationIdentity, expectedConfiguration)
  assert.equal(buildSellerOsPrelinkedLaunchCandidateIdV1({
    configurationIdentity: expectedConfiguration,
  }), `prelinked-candidate-v1:sha256:${digest([
    "SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_V1", expectedConfiguration,
  ].join("\n"))}`)
  assert.equal(buildSellerOsPrelinkedLaunchIdV1({
    configurationIdentity: expectedConfiguration,
  }), `prelinked-launch-v1:sha256:${digest([
    "SELLER_OS_PRELINKED_LAUNCH_V1", expectedConfiguration,
  ].join("\n"))}`)
})

test("different variant changes configuration identity", () => {
  const original = configuration()
  const other = configuration({ components: [component({
    lunaVariantId: "48809607659745", lunaSku: "ITEM5810 white" })] })
  assert.notEqual(original.configurationIdentity, other.configurationIdentity)
})

test("simple multiplier and BOM preserve exact quantities", () => {
  const multiplier = configuration({ configurationMode: "SIMPLE_MULTIPLIER",
    components: [component({ supplierQuantityRequired: 3 })] })
  assert.equal(multiplier.components[0].supplierQuantityRequired, 3)
  const second = component({ lunaProductId: "9220805755105",
    lunaVariantId: "48809607659745", lunaSku: "OTHER SKU" })
  const bom = configuration({ configurationMode: "MULTI_COMPONENT_BOM",
    expectedComponentCount: 2, components: [component(), second] })
  const bomCandidate = candidate({ configuration: bom,
    evidencePackage: packageFor(bom) })
  assert.equal(bomCandidate.components.length, 2)
  assert.equal(bomCandidate.lunaProductId, null)
  assert.equal(bomCandidate.supplierQuantityRequired, null)
})

test("configuration identity canonicalizes BOM by external Luna tuple", () => {
  const first = component()
  const second = component({ lunaProductId: "9220805755105",
    lunaVariantId: "48809607659745", lunaSku: "OTHER SKU",
    supplierQuantityRequired: 2 })
  const forward = configuration({ configurationMode: "MULTI_COMPONENT_BOM",
    expectedComponentCount: 2, components: [first, second] })
  const reverse = configuration({ configurationMode: "MULTI_COMPONENT_BOM",
    expectedComponentCount: 2, components: [second, first] })
  assert.equal(forward.configurationIdentity, reverse.configurationIdentity)
  assert.deepEqual(forward.components.map((entry) => [entry.lunaProductId,
    entry.lunaVariantId, entry.supplierQuantityRequired]), [
    ["9220805755104", "48809607659744", 1],
    ["9220805755105", "48809607659745", 2],
  ])
})

test("missing component or unknown supplier identity is NOT_READY_TO_LIST", () => {
  const missing = configuration({ configurationMode: "MULTI_COMPONENT_BOM",
    expectedComponentCount: 2, components: [component()] })
  const missingCandidate = candidate({ configuration: missing,
    evidencePackage: packageFor(missing) })
  assert.equal(missingCandidate.launchClassification, "NOT_READY_TO_LIST")
  assert.ok(missingCandidate.hardBlockers.includes("BOM_COMPONENT_MISSING"))
  const unknown = configuration({ components: [component({
    supplierIdentityStatus: "UNKNOWN" })] })
  assert.equal(candidate({ configuration: unknown,
    evidencePackage: packageFor(unknown) }).launchClassification,
  "NOT_READY_TO_LIST")
})

test("missing market and economics evidence remain mandatory not-ready gates", () => {
  for (const omitted of ["MARKET_EVIDENCE", "ECONOMICS_EVIDENCE"]) {
    const config = configuration()
    const pack = packageFor(config, evidence(config).filter((item) =>
      item.evidenceClass !== omitted))
    assert.equal(pack.readiness, "NOT_READY_TO_LIST")
    assert.ok(pack.hardBlockers.includes(`MISSING_${omitted}`))
  }
})

test("score 100 cannot override a blocker or UNPROVEN authority", () => {
  const config = configuration()
  const items = evidence(config).map((item) => item.evidenceClass === "MARKET_EVIDENCE"
    ? MarketEvidenceAdapter(evidenceInput("b", config, { availability: "UNPROVEN",
      authorityClass: "UNPROVEN" })) : item)
  const value = candidate({ configuration: config,
    evidencePackage: packageFor(config, items), launchScore: 100 })
  assert.equal(value.launchScore, 100)
  assert.equal(value.marketEvidenceStatus, "UNPROVEN")
  assert.equal(value.launchClassification, "NOT_READY_TO_LIST")
})

test("foreign configuration evidence is rejected", () => {
  const target = configuration()
  const other = configuration({ components: [component({
    lunaVariantId: "48809607659745", lunaSku: "WHITE" })] })
  assert.throws(() => packageFor(target, evidence(other)),
    /EVIDENCE_SUBJECT_CONFIGURATION_MISMATCH/)
})

test("freshness affects package identity and stale evidence is not ready", () => {
  const config = configuration()
  const fresh = packageFor(config)
  const staleItems = evidence(config).map((item) => item.evidenceClass === "MARKET_EVIDENCE"
    ? MarketEvidenceAdapter(evidenceInput("b", config, {
      observedAt: "2026-08-22T14:00:00.000Z", maximumAgeSeconds: 60,
      authorityClass: "OFFICIAL_EXTERNAL_FACT" })) : item)
  const stale = packageFor(config, staleItems)
  assert.notEqual(fresh.evidencePackageId, stale.evidencePackageId)
  assert.equal(stale.marketEvidenceStatus, "STALE")
  assert.equal(stale.readiness, "NOT_READY_TO_LIST")
})

test("adapter upgrade changes evidence package but not configuration/candidate identity", () => {
  const config = configuration()
  const v1 = candidate({ configuration: config, evidencePackage: packageFor(config) })
  const upgraded = evidence(config).map((item) => item.evidenceClass === "MARKET_EVIDENCE"
    ? MarketEvidenceAdapter(evidenceInput("b", config, { adapterVersion: "v2",
      authorityClass: "OFFICIAL_EXTERNAL_FACT" })) : item)
  const v2 = candidate({ configuration: config,
    evidencePackage: packageFor(config, upgraded) })
  assert.equal(v1.launchCandidateId, v2.launchCandidateId)
  assert.equal(v1.launchId, v2.launchId)
  assert.notEqual(v1.evidencePackageId, v2.evidencePackageId)
})

test("Product Case is optional/provisional and never mutates launch identity", () => {
  const without = candidate()
  const pc = (version, character) => provenance({ productCaseLineage: {
    productCaseId: "product-case-1", productCaseVersionId: version,
    productCaseVersionDigest: D(character),
    authority: "PROVISIONAL_NON_AUTHORITATIVE_LINEAGE" } })
  const v1 = candidate({ provenance: pc("version-1", "7") })
  const v2 = candidate({ provenance: pc("version-2", "8") })
  assert.equal(v1.launchCandidateId, without.launchCandidateId)
  assert.equal(v2.launchId, v1.launchId)
})

test("custom label grammar rejects spaces and >50 while supplier SKU stays separate", () => {
  assert.throws(() => candidate({ canonicalEbaySku: "ITEM 5810" }),
    /CANONICAL_EBAY_SKU_INVALID/)
  assert.throws(() => candidate({ canonicalEbaySku: `A${"B".repeat(50)}` }),
    /CANONICAL_EBAY_SKU_INVALID/)
  assert.throws(() => candidate({ canonicalEbaySku: "A_b:c.1-2" }),
    /SKU_LISTING_PACKAGE_PAIR_REQUIRED/)
  assert.equal(candidate({ canonicalEbaySku: SKU_A,
    listingPackageId: UUID_A }).canonicalEbaySku, SKU_A)
  assert.equal(configuration({ components: [component({ lunaSku: "Supplier SKU 1" })] })
    .components[0].lunaSku, "Supplier SKU 1")
})

test("shadow builder blocks P2 bypass and I01 publication", () => {
  const shadow = buildSellerOsPrelinkedLaunchShadowV1({ candidate: candidate(),
    p2BypassRequested: true, publishRequested: true })
  assert.equal(shadow.status, "BLOCKED")
  assert.ok(shadow.reasonCodes.includes("P2_GATE_BYPASS_FORBIDDEN"))
  assert.ok(shadow.reasonCodes.includes("OP_LAUNCH_I01_PUBLISH_FORBIDDEN"))
  assert.equal(requestSellerOsPrelinkedLaunchPublishV1().marketplaceWrites, 0)
})

test("shadow pool deduplicates, ranks deterministically and caps at 20", () => {
  const base = candidate()
  const entries = [base, base]
  for (let index = 1; index <= 21; index += 1) {
    const config = configuration({ components: [component({
      lunaVariantId: String(48809607659744n + BigInt(index)),
      lunaSku: `ITEM-${index}` })] })
    entries.push(candidate({ configuration: config,
      evidencePackage: packageFor(config), launchScore: index }))
  }
  const pool = buildSellerOsPrelinkedLaunchShadowPoolV1({ candidates: entries })
  assert.equal(pool.selectedCount, 20)
  assert.equal(pool.uniqueCount, 22)
  assert.equal(pool.truncated, true)
  assert.equal(new Set(pool.candidates.map((entry) => entry.rank)).size, 20)
})

test("lineage replay is idempotent and provisional Product Case lineage reconstructs", () => {
  const value = candidate({ provenance: provenance({ productCaseLineage: {
    productCaseId: "product-case-1", productCaseVersionId: "version-1",
    productCaseVersionDigest: D("7"),
    authority: "PROVISIONAL_NON_AUTHORITATIVE_LINEAGE" } }) })
  const registry = createSellerOsPrelinkedLaunchLineageRegistryV1()
  assert.equal(registry.register(value).outcome, "CREATED")
  assert.equal(registry.register(value).outcome, "IDEMPOTENT_SUCCESS")
  assert.equal(registry.reconstruct(value.launchId).productCaseLineage.productCaseId,
    "product-case-1")
})

test("SKU collision, historical collision and concurrent reservation fail closed", async () => {
  const first = candidate()
  const config2 = configuration({ components: [component({
    lunaVariantId: "48809607659745", lunaSku: "WHITE" })] })
  const second = candidate({ configuration: config2,
    evidencePackage: packageFor(config2) })
  const registry = createSellerOsPrelinkedLaunchLineageRegistryV1({
    historicalSkuBindings: [{ sku: SKU_A, launchId: null }],
    allocateListingPackageId: ({ launchCandidateId, attempt }) =>
      attempt === 1 ? UUID_A : launchCandidateId === first.launchCandidateId
        ? UUID_B : "33333333-3333-4333-8333-333333333333" })
  registry.register(first); registry.register(second)
  const race = await Promise.all([
    registry.reserveSku({ launchId: first.launchId }),
    registry.reserveSku({ launchId: second.launchId })])
  assert.deepEqual(race.map((entry) => entry.outcome), ["CREATED", "CREATED"])
  assert.notEqual(race[0].lineage.reservedSku, race[1].lineage.reservedSku)
  assert.notEqual(race[0].lineage.reservedSku, SKU_A)
})

test("published-later binding requires external receipt and guards duplicate Item ID", async () => {
  const first = candidate()
  const config2 = configuration({ components: [component({
    lunaVariantId: "48809607659745", lunaSku: "WHITE" })] })
  const second = candidate({ configuration: config2,
    evidencePackage: packageFor(config2) })
  const registry = createSellerOsPrelinkedLaunchLineageRegistryV1()
  registry.register(first); registry.register(second)
  await registry.reserveSku({ launchId: first.launchId })
  await registry.reserveSku({ launchId: second.launchId })
  const bind = () => registry.bindPublishedListing({ launchId: first.launchId,
    ebayItemId: "123456789012", receipt: receipt() })
  assert.equal(bind().outcome, "CREATED")
  assert.equal(bind().outcome, "IDEMPOTENT_SUCCESS")
  const conflict = registry.bindPublishedListing({ launchId: second.launchId,
    ebayItemId: "123456789012",
    receipt: receipt({ reference: "publisher:receipt-2", receiptDigest: D("8") }) })
  assert.equal(conflict.reasonCode, "EBAY_ITEM_ID_CONFLICT")
})

test("same launch rejects a conflicting second Item ID", async () => {
  const value = candidate()
  const registry = createSellerOsPrelinkedLaunchLineageRegistryV1()
  registry.register(value)
  await registry.reserveSku({ launchId: value.launchId })
  registry.bindPublishedListing({ launchId: value.launchId,
    ebayItemId: "123456789012", receipt: receipt() })
  const conflict = registry.bindPublishedListing({ launchId: value.launchId,
    ebayItemId: "123456789013",
    receipt: receipt({ reference: "publisher:receipt-2", receiptDigest: D("8") }) })
  assert.equal(conflict.reasonCode, "LAUNCH_ITEM_ID_CONFLICT")
})

test("SKU allocation is server-owned, replay-stable and caller SKU is rejected", async () => {
  const value = candidate()
  const registry = createSellerOsPrelinkedLaunchLineageRegistryV1({
    allocateListingPackageId: () => UUID_A,
  })
  registry.register(value)
  const forbidden = await registry.reserveSku({ launchId: value.launchId,
    sku: "CALLER-SKU" })
  assert.equal(forbidden.reasonCode, "CALLER_SKU_INPUT_FORBIDDEN")
  const first = await registry.reserveSku({ launchId: value.launchId })
  const replay = await registry.reserveSku({ launchId: value.launchId })
  assert.equal(first.reasonCode, "SERVER_SKU_RESERVED")
  assert.equal(first.lineage.reservedListingPackageId, UUID_A)
  assert.equal(first.lineage.reservedSku, SKU_A)
  assert.equal(replay.outcome, "IDEMPOTENT_SUCCESS")
  assert.equal(replay.lineage.reservedSku, first.lineage.reservedSku)

  const automaticRegistry = createSellerOsPrelinkedLaunchLineageRegistryV1()
  automaticRegistry.register(value)
  const automatic = await automaticRegistry.reserveSku({ launchId: value.launchId })
  const compact = createHash("sha256").update([
    "SELLER_OS_PRELINKED_LISTING_PACKAGE_V1", value.launchCandidateId, "0",
  ].join("\n"), "utf8").digest("hex").slice(0, 32)
  assert.doesNotMatch(compact[12], /^[1-5]$/)
  const expectedPackageId = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-` +
    `${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
  assert.equal(automatic.lineage.reservedListingPackageId, expectedPackageId)
  assert.equal(automatic.lineage.reservedSku, `IMNOVA${compact.toUpperCase()}`)
})

test("configuration, evidence and outcome IDs are deterministic", () => {
  const config = configuration()
  const first = packageFor(config, evidence(config))
  const second = packageFor(config, [...evidence(config)].reverse())
  assert.equal(first.evidencePackageId, second.evidencePackageId)
  const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex")
  const itemLines = first.evidence.map((item) => [item.adapter,
    item.evidenceClass, item.adapterVersion, item.reference, item.evidenceDigest,
    item.sourceContractVersion, item.observedAt, String(item.maximumAgeSeconds),
    item.availability, item.authorityClass,
    [...item.blockerCodes].sort().join(",")].join("|")).sort()
  const expectedPackageId = `launch-evidence-v1:sha256:${hash([
    "SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_ID_V1", config.accountKey,
    config.marketplaceId, config.configurationIdentity,
    "PREPUBLICATION_PRELINKED_ONLY", ...itemLines,
  ].join("\n"))}`
  assert.equal(first.evidencePackageId, expectedPackageId)
  assert.equal(first.evidenceDigest, `sha256:${hash([
    "SELLER_OS_LAUNCH_EVIDENCE_DIGEST_V1", expectedPackageId, AT,
    "READY", "READY", "READY", "READY",
  ].join("\n"))}`)
  const p2Pass = packageFor(config, evidence(config), {
    p2DependencyGate: "PASS",
  })
  assert.notEqual(p2Pass.evidencePackageId, first.evidencePackageId)
  const value = candidate({ configuration: config, evidencePackage: first })
  const input = { launchId: value.launchId, ebayItemId: "123456789012",
    windowStart: "2026-08-23T00:00:00.000Z",
    windowEnd: "2026-08-30T00:00:00.000Z",
    outcomeContractVersion: "SELLER_OS_LAUNCH_OUTCOME_V1" }
  assert.equal(buildSellerOsLaunchOutcomeIdV1(input),
    buildSellerOsLaunchOutcomeIdV1(input))
})
