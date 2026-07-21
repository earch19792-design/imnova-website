import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const snapshotSource = readFileSync(
  new URL("../lib/ebay/ebay-draft-only-preflight-snapshot.ts", import.meta.url),
  "utf8",
)
const economicsSource = readFileSync(
  new URL("../lib/ebay/ebay-unit-economics.ts", import.meta.url),
  "utf8",
)
const environmentBoundarySource = readFileSync(
  new URL("../lib/ebay/environment-boundaries.ts", import.meta.url),
  "utf8",
)

function embedSnapshotModule(source) {
  const withoutImport = source
    .replace('import { verifyEbayDraftOnlyPreflightSnapshot } from "./ebay-draft-only-preflight-snapshot"\n', "")
    .replace(/import \{\n  calculateEbayUnitEconomics,\n  DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,\n  normalizeEbayUnitEconomicsConfig,\n  type EbayUnitEconomicsConfig,\n\} from "\.\/ebay-unit-economics"\n/, "")
    .replace(/import \{\n  issueEbayDraftOnlyPreflightSnapshot,\n  verifyEbayDraftOnlyPreflightSnapshot,\n\} from "\.\/ebay-draft-only-preflight-snapshot"\n/, "")
    .replace('import { getEbayDraftWriteEnvironmentBoundary } from "./environment-boundaries"\n', "")
  return `${snapshotSource}\n${economicsSource}\n${environmentBoundarySource}\n${withoutImport}`
}

const readinessSource = embedSnapshotModule(readFileSync(
  new URL("../lib/ebay/ebay-draft-only-readiness.ts", import.meta.url),
  "utf8",
))
const gatewaySource = embedSnapshotModule(readFileSync(
  new URL("../lib/ebay/ebay-draft-only-gateway.ts", import.meta.url),
  "utf8",
))
const routeSource = readFileSync(
  new URL("../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
  "utf8",
)
const taxonomyGatewaySource = readFileSync(
  new URL("../lib/ebay/ebay-seller-keyword-demand-gateway.ts", import.meta.url),
  "utf8",
)
const workspaceSource = readFileSync(
  new URL("../app/admin/ebay/listing-workspace/page.tsx", import.meta.url),
  "utf8",
)
const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260713050000_create_ebay_draft_only_control_plane.sql", import.meta.url),
  "utf8",
)
const productionMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260713052000_enable_production_ebay_unpublished_drafts.sql", import.meta.url),
  "utf8",
)
const publicationMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260720041000_create_ebay_authorized_listing_publication.sql", import.meta.url),
  "utf8",
)
const sameDayPublicationSource = readFileSync(
  new URL("../lib/ebay/ebay-same-day-authorized-publication.ts", import.meta.url),
  "utf8",
)
const sameDayImageRuntimeSource = readFileSync(
  new URL("../lib/ebay/ebay-same-day-image-package-runtime.ts", import.meta.url),
  "utf8",
)
const sameDaySourceSyncMigration = readFileSync(
  new URL("../supabase/migrations/20260721041000_sync_same_day_source_before_authorized_publication.sql", import.meta.url),
  "utf8",
)

async function importTypeScript(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`)
}

const SNAPSHOT_SECRET = "test-only-preflight-snapshot-secret-0123456789"
const SANDBOX_FINGERPRINT = "a".repeat(64)
const PRODUCTION_FINGERPRINT = "b".repeat(64)
const RESERVED_SKU = "IMNOVA-11111111111141118111111111111111"
const snapshotModule = await importTypeScript(snapshotSource)

process.env.EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET = SNAPSHOT_SECRET

function signedSnapshot({
  target = "SANDBOX",
  accountFingerprint = SANDBOX_FINGERPRINT,
  now = new Date("2026-07-13T05:00:00.000Z"),
  fulfillmentPolicyId = "fulfillment_1",
  paymentPolicyId = "payment_1",
  returnPolicyId = "return_1",
  merchantLocationKey = "LUNA_PORTEX_US",
} = {}) {
  return snapshotModule.issueEbayDraftOnlyPreflightSnapshot({
    target,
    accountFingerprint,
    marketplaceId: "EBAY_US",
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    merchantLocationKey,
  }, SNAPSHOT_SECRET, now)
}

function validInput(now = new Date("2026-07-13T05:00:00.000Z")) {
  const timestamp = now.toISOString()
  const image = "https://supplier.example.test/product.jpg"
  return {
    now,
    listingPackage: {
      id: "11111111-1111-4111-8111-111111111111",
      candidate_key: "luna:item-1:default",
      status: "ready_for_review",
      source_observed_at: timestamp,
      package_data: {
        title: "Professional product title",
        categoryId: "11700",
        aspects: { Brand: ["Acme"] },
        description: "Accurate supplier-backed product description.",
        imageUrls: [image],
        pricing: { targetPrice: 30, estimatedNetProfit: 999_999 },
      },
    },
    opportunity: {
      id: "22222222-2222-4222-8222-222222222222",
      candidate_key: "luna:item-1:default",
      queue_status: "ready",
      hard_gates: [],
      evidence_guards: [],
      supplier_available: true,
      supplier_inventory_quantity: 8,
      supplier_price: 7,
      supplier_snapshot_at: timestamp,
      last_scanned_at: timestamp,
      identity_score: 100,
      assessment: {
        identity: { exactIdentityConfirmed: true },
        scores: { potentialScore: 86, confidenceScore: 91 },
        listingIntelligencePackage: {
          categoryRecommendation: {
            categoryId: "11700",
            taxonomyStatus: "AVAILABLE",
            requiredAspects: [{ name: "Brand" }],
            verification: { status: "CATEGORY_AND_REQUIRED_ASPECTS_CONFIRMED", missingRequiredAspects: [] },
          },
        },
      },
    },
    draftConfiguration: {
      sku: RESERVED_SKU,
      quantity: 1,
      condition: "NEW",
      merchantLocationKey: "LUNA_PORTEX_US",
      businessPolicies: {
        fulfillmentPolicyId: "fulfillment_1",
        paymentPolicyId: "payment_1",
        returnPolicyId: "return_1",
      },
      packageWeightAndSize: {
        dimensions: { height: 3, length: 8, width: 5, unit: "INCH" },
        weight: { value: 1, unit: "POUND" },
      },
      imageAuthorization: {
        approved: true,
        approvedAt: timestamp,
        approvedImageUrls: [image],
        rightsBasis: "supplier_authorized",
        source: "luna",
      },
      aspectValidation: {
        validated: true,
        validatedAt: timestamp,
        categoryId: "11700",
        categoryTreeId: "0",
        categoryTreeVersion: "2026-07-01",
        requiredAspects: ["Brand"],
        source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
        constraintSnapshotStatus: "AVAILABLE",
        aspectConstraints: [{
          name: "Brand",
          mode: "FREE_TEXT",
          cardinality: "SINGLE",
          maxLength: 65,
          dataType: "STRING",
          format: null,
          advancedDataType: null,
          expectedRequiredByDate: null,
          suggestedValues: [],
          values: [],
          valuesComplete: true,
          constraintsComplete: true,
        }],
      },
      skuCollisionCheck: { sku: RESERVED_SKU, serverPreflightRequiredAtExecution: true },
      ebayPreflightSnapshot: signedSnapshot({ now }),
    },
    activeSkuCollision: false,
    ledgerSkuCollision: false,
    accountFingerprint: SANDBOX_FINGERPRINT,
  }
}

function mobilePreflightMock({
  userId = "mobile-seller-user",
  identityStatus = "CONFIRMED",
  sellingLimit,
  fulfillmentPolicies = [{
    fulfillmentPolicyId: "fulfillment_1",
    name: "US shipping",
    marketplaceId: "EBAY_US",
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
  }],
  paymentPolicies = [{
    paymentPolicyId: "payment_1",
    name: "Immediate payment",
    marketplaceId: "EBAY_US",
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    immediatePay: true,
  }],
  returnPolicies = [{
    returnPolicyId: "return_1",
    name: "30-day returns",
    marketplaceId: "EBAY_US",
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
  }],
  locations = [{
    merchantLocationKey: "LUNA_PORTEX_US",
    name: "Luna warehouse",
    merchantLocationStatus: "ENABLED",
    location: { address: { addressLine1: "must-never-leak" } },
  }],
} = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ url: parsed, method: init.method, headers: init.headers, body: init.body })
    if (parsed.pathname.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({
        access_token: "must-never-leak-access-token",
        refresh_token: "must-never-leak-refresh-token",
        expires_in: 7200,
      }), { status: 200 })
    }
    if (parsed.pathname === "/commerce/identity/v1/user/") {
      return new Response(JSON.stringify({
        userId,
        status: identityStatus,
        accountType: "BUSINESS",
        registrationMarketplaceId: "EBAY_US",
        privateRegistrationAddress: "must-never-leak-identity-address",
      }), { status: 200 })
    }
    if (parsed.pathname === "/sell/account/v1/privilege") {
      return new Response(JSON.stringify({
        sellerRegistrationCompleted: true,
        ...(sellingLimit === undefined ? {} : { sellingLimit }),
      }), { status: 200 })
    }
    if (parsed.pathname === "/sell/account/v1/fulfillment_policy") {
      return new Response(JSON.stringify({ fulfillmentPolicies }), { status: 200 })
    }
    if (parsed.pathname === "/sell/account/v1/payment_policy") {
      return new Response(JSON.stringify({ paymentPolicies }), { status: 200 })
    }
    if (parsed.pathname === "/sell/account/v1/return_policy") {
      return new Response(JSON.stringify({ returnPolicies }), { status: 200 })
    }
    if (parsed.pathname === "/sell/inventory/v1/location") {
      return new Response(JSON.stringify({ locations }), { status: 200 })
    }
    throw new Error(`unexpected ${init.method} ${parsed}`)
  }
  return { calls, fetchImpl }
}

test("readiness binds all required evidence to one deterministic approval hash", async () => {
  const module = await importTypeScript(readinessSource)
  const input = validInput()
  const result = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(result.ready, true)
  assert.match(result.payloadHash, /^[0-9a-f]{64}$/)
  assert.equal(result.payload.safety.target, "SANDBOX")
  assert.equal(result.payload.safety.unpublishedOnly, true)
  assert.equal(result.payload.safety.publishOfferPresent, false)
  assert.deepEqual(result.payload.safety.permittedOperations, ["createOrReplaceInventoryItem", "createOffer"])
  assert.equal(module.hashEbayDraftOnlyPayload(result.payload), result.payloadHash)
})

test("a server-validated same-day binding supersedes only stale generic scoring gates", async () => {
  const module = await importTypeScript(readinessSource)
  const input = validInput()
  input.opportunity.queue_status = "hold"
  input.opportunity.hard_gates = ["LEGACY_SCORE_GATE"]
  input.opportunity.evidence_guards = ["LEGACY_RESEARCH_GUARD"]
  input.opportunity.identity_score = 0
  input.opportunity.assessment.identity.exactIdentityConfirmed = false
  input.opportunity.assessment.scores = { potentialScore: 0, confidenceScore: 0 }
  input.sameDayPilotAuthorization = {
    validated: true,
    version: "SELLER_OS_AUTHORIZED_PUBLICATION_V1_2026_07_20",
    runId: "33333333-3333-4333-8333-333333333333",
    candidateId: "44444444-4444-4444-8444-444444444444",
    listingPackageId: input.listingPackage.id,
    finalHumanAuthorizationRequired: true,
    unattendedPublicationAllowed: false,
  }
  const authorized = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(authorized.ready, true)
  assert.deepEqual(
    authorized.payload.compliance.sameDayPilotAuthorization,
    input.sameDayPilotAuthorization,
  )

  input.sameDayPilotAuthorization.unattendedPublicationAllowed = true
  const forged = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(forged.ready, false)
  assert.ok(forged.blockers.includes("OPPORTUNITY_STATUS_BLOCKED"))
  assert.ok(forged.blockers.includes("EXACT_IDENTITY_REQUIRED"))
})

test("taxonomy constraint validation fails closed on selection, cardinality, length and dependencies", async () => {
  const module = await importTypeScript(readinessSource)
  const base = {
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    constraintSnapshotStatus: "AVAILABLE",
    categoryTreeId: "0",
    categoryTreeVersion: "2026-07-01",
    aspectConstraints: [{
      name: "Color",
      mode: "SELECTION_ONLY",
      cardinality: "SINGLE",
      maxLength: 5,
      dataType: "STRING",
      format: null,
      advancedDataType: null,
      valuesComplete: true,
      constraintsComplete: true,
      values: [{
        value: "Red",
        valueConstraints: [{
          applicableForAspectName: "Size",
          applicableForAspectValues: ["Small"],
        }],
      }],
    }, {
      name: "Size",
      mode: "FREE_TEXT",
      cardinality: "SINGLE",
      maxLength: 5,
      dataType: "STRING",
      format: null,
      advancedDataType: null,
      valuesComplete: true,
      constraintsComplete: true,
      values: [],
    }],
  }
  const invalid = module.validateEbayTaxonomyAspectValues({
    Color: ["Blue", "Red"],
    Size: ["Large"],
  }, base)
  assert.ok(invalid.includes("ASPECT_SINGLE_VALUE_REQUIRED:COLOR"))
  assert.ok(invalid.includes("ASPECT_SELECTION_VALUE_INVALID:COLOR"))
  assert.ok(invalid.includes("ASPECT_VALUE_CONSTRAINT_NOT_MET:COLOR"))

  const tooLong = module.validateEbayTaxonomyAspectValues({
    Color: ["Red"],
    Size: ["Medium"],
  }, base)
  assert.ok(tooLong.includes("ASPECT_MAX_LENGTH_EXCEEDED:SIZE"))

  const unavailable = module.validateEbayTaxonomyAspectValues({ Color: ["Red"] }, {
    ...base,
    categoryTreeVersion: null,
  })
  assert.deepEqual(unavailable, ["ASPECT_CONSTRAINTS_UNVERIFIABLE"])

  assert.deepEqual(module.validateEbayTaxonomyAspectValues({}, {
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    constraintSnapshotStatus: "AVAILABLE",
    categoryTreeId: "0",
    categoryTreeVersion: "2026-07-01",
    aspectConstraints: [],
  }), [])
})

test("una categoría oficial sin aspectos puede estar lista sin inventar campos", async () => {
  const module = await importTypeScript(readinessSource)
  const input = validInput()
  input.listingPackage.package_data.aspects = {}
  input.opportunity.assessment.listingIntelligencePackage.categoryRecommendation.requiredAspects = []
  input.draftConfiguration.aspectValidation.requiredAspects = []
  input.draftConfiguration.aspectValidation.aspectConstraints = []
  const result = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(result.ready, true)
  assert.equal(result.blockers.includes("ASPECTS_REQUIRED"), false)
})

test("taxonomy typed values support official eBay formats and reject unsupported metadata", async () => {
  const module = await importTypeScript(readinessSource)
  const validation = {
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    constraintSnapshotStatus: "AVAILABLE",
    categoryTreeId: "0",
    categoryTreeVersion: "2026-07-01",
    aspectConstraints: [
      ["Year", "DATE", "YYYY", null],
      ["Count", "NUMBER", "int32", null],
      ["Device Charging Range", "NUMBER", "double", "NUMERIC_RANGE"],
    ].map(([name, dataType, format, advancedDataType]) => ({
      name,
      mode: "FREE_TEXT",
      cardinality: "SINGLE",
      maxLength: 40,
      dataType,
      format,
      advancedDataType,
      values: [],
      valuesComplete: true,
      constraintsComplete: true,
    })),
  }
  assert.deepEqual(module.validateEbayTaxonomyAspectValues({
    Year: ["2026"],
    Count: ["12"],
    "Device Charging Range": ["10-20.5"],
  }, validation), [])

  const invalid = module.validateEbayTaxonomyAspectValues({
    Year: ["202613"],
    Count: ["1.2"],
    "Device Charging Range": ["20-10"],
  }, validation)
  assert.ok(invalid.includes("ASPECT_VALUE_FORMAT_INVALID:YEAR"))
  assert.ok(invalid.includes("ASPECT_VALUE_FORMAT_INVALID:COUNT"))
  assert.ok(invalid.includes("ASPECT_VALUE_FORMAT_INVALID:DEVICE_CHARGING_RANGE"))

  validation.aspectConstraints[0].format = "RFC3339"
  assert.ok(module.validateEbayTaxonomyAspectValues({ Year: ["2026"] }, validation)
    .includes("ASPECT_TYPE_FORMAT_UNVERIFIABLE:YEAR"))
})

test("taxonomy adapter, server snapshot and workspace retain and enforce official constraints", () => {
  for (const field of [
    "categoryTreeVersion",
    "aspectMode",
    "itemToAspectCardinality",
    "aspectMaxLength",
    "aspectDataType",
    "aspectFormat",
    "aspectAdvancedDataType",
    "expectedRequiredByDate",
    "valueConstraints",
  ]) assert.match(taxonomyGatewaySource, new RegExp(field))
  assert.match(routeSource, /aspectConstraints: liveAspectConstraints/)
  assert.match(routeSource, /constraintSnapshotStatus/)
  assert.match(workspaceSource, /selectionOnly/)
  assert.match(workspaceSource, /maxLength=\{taxonomyAspect\?\.maxLength/)
  assert.match(workspaceSource, /no se puede borrar/)
})

test("readiness recalculates profit on the server and ignores client profit claims", async () => {
  const module = await importTypeScript(readinessSource)
  const baseline = validInput()
  const result = module.evaluateEbayDraftOnlyReadiness(baseline)
  assert.equal(result.ready, true)
  assert.equal(result.economics.estimatedNetProfit, 8.32)
  assert.equal(result.economics.marginPercent, 27.73)
  assert.equal(result.economics.calculationSource, "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1")
  assert.equal(result.payload.listingPackage.packageData.pricing.estimatedNetProfit, 8.32)
  assert.notEqual(result.payload.listingPackage.packageData.pricing.estimatedNetProfit, 999_999)

  const tamperedProfit = validInput()
  tamperedProfit.listingPackage.package_data.pricing.estimatedNetProfit = -999_999
  const tamperedResult = module.evaluateEbayDraftOnlyReadiness(tamperedProfit)
  assert.equal(tamperedResult.payloadHash, result.payloadHash)

  const repriced = validInput()
  repriced.listingPackage.package_data.pricing.targetPrice = 20
  repriced.listingPackage.package_data.pricing.estimatedNetProfit = 1_000_000
  const repricedResult = module.evaluateEbayDraftOnlyReadiness(repriced)
  assert.equal(repricedResult.economics.estimatedNetProfit, 0.75)
  assert.equal(repricedResult.ready, false)
  assert.ok(repricedResult.blockers.includes("MINIMUM_NET_MARGIN_NOT_MET"))

  const costlyShipping = module.evaluateEbayDraftOnlyReadiness({
    ...validInput(),
    economicsConfig: { estimatedOutboundShipping: 20 },
  })
  assert.equal(costlyShipping.economics.estimatedOutboundShipping, 20)
  assert.equal(costlyShipping.ready, false)

  const missingSupplierCost = validInput()
  missingSupplierCost.opportunity.supplier_price = null
  const missingSupplierCostResult = module.evaluateEbayDraftOnlyReadiness(missingSupplierCost)
  assert.equal(missingSupplierCostResult.economics.estimatedNetProfit, null)
  assert.ok(missingSupplierCostResult.blockers.includes("LUNA_COST_REQUIRED"))
})

test("readiness requires a real authorized image, explicit weight unit and collision-free identity", async () => {
  const module = await importTypeScript(readinessSource)
  const input = validInput()
  input.listingPackage.package_data.imageUrls = []
  input.draftConfiguration.imageAuthorization.approvedImageUrls = []
  input.draftConfiguration.packageWeightAndSize.weight.unit = ""
  input.identityCollisionReasons = ["ACTIVE_SUPPLIER_SKU", "LISTING_PACKAGE_GTIN"]
  const result = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes("HTTPS_IMAGES_REQUIRED"))
  assert.ok(result.blockers.includes("IMAGE_AUTHORIZATION_WITHOUT_SOURCE_IMAGE"))
  assert.ok(result.blockers.includes("PACKAGE_WEIGHT_UNIT_REQUIRED"))
  assert.ok(result.blockers.includes("PRODUCT_IDENTITY_COLLISION"))
  assert.ok(result.blockers.includes("PRODUCT_IDENTITY_COLLISION:ACTIVE_SUPPLIER_SKU"))
  assert.ok(result.blockers.includes("PRODUCT_IDENTITY_COLLISION:LISTING_PACKAGE_GTIN"))
})

test("route checks canonical product identities and preserves taxonomy evidence time", () => {
  for (const field of [
    "candidate_key",
    "supplier_sku",
    "supplier_variant_id",
    "market_radar_product_id",
    "gtin",
  ]) assert.match(routeSource, new RegExp(field))
  assert.match(routeSource, /DRAFT_APPROVAL_CANDIDATE_KEY/)
  assert.match(routeSource, /LISTING_PACKAGE_GTIN/)
  assert.match(routeSource, /opportunity\.last_scanned_at/)
  assert.match(routeSource, /validatedAt: taxonomyObservedAt/)
  assert.doesNotMatch(routeSource, /validatedAt: now\.toISOString\(\)/)
})

test("readiness fails closed on evidence, freshness, rights, margin, policies and SKU collisions", async () => {
  const module = await importTypeScript(readinessSource)
  const input = validInput()
  input.opportunity.hard_gates = ["NEED_EXACT_IDENTITY"]
  input.opportunity.supplier_snapshot_at = "2026-07-12T00:00:00.000Z"
  input.draftConfiguration.imageAuthorization.source = "competitor"
  input.draftConfiguration.businessPolicies.returnPolicyId = ""
  input.activeSkuCollision = true
  const result = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes("HARD_GATE:NEED_EXACT_IDENTITY"))
  assert.ok(result.blockers.includes("LUNA_SNAPSHOT_STALE"))
  assert.ok(result.blockers.includes("IMAGE_SOURCE_INVALID"))
  assert.ok(result.blockers.includes("RETURN_POLICY_REQUIRED"))
  assert.ok(result.blockers.includes("SKU_COLLISION"))
})

test("gateway uses Sandbox GETs to verify policies, enabled location and SKU before PUT", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_TARGET: "SANDBOX",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID: "client",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET: "secret",
    EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN: "separate-write-refresh-token",
    EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID: "sandbox-user-1",
    EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ url: parsed, method: init.method, body: init.body })
    if (parsed.pathname.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access", expires_in: 7200 }), { status: 200 })
    }
    if (parsed.pathname === "/commerce/identity/v1/user/") {
      return new Response(JSON.stringify({
        userId: "sandbox-user-1",
        status: "CONFIRMED",
        accountType: "BUSINESS",
        registrationMarketplaceId: "EBAY_US",
      }), { status: 200 })
    }
    if (parsed.pathname === "/sell/account/v1/privilege") {
      return new Response(JSON.stringify({
        sellerRegistrationCompleted: true,
        sellingLimit: { amount: { value: "1000", currency: "USD" } },
      }), { status: 200 })
    }
    if (init.method === "GET" && parsed.pathname.includes("/inventory_item/")) return new Response("{}", { status: 404 })
    if (init.method === "GET" && parsed.pathname.endsWith("/offer")) return new Response(JSON.stringify({ offers: [] }), { status: 200 })
    if (init.method === "GET" && parsed.pathname.includes("/fulfillment_policy/")) {
      return new Response(JSON.stringify({ fulfillmentPolicyId: "fulfillment_1", marketplaceId: "EBAY_US", categoryTypes: ["ALL_EXCLUDING_MOTORS_VEHICLES"] }), { status: 200 })
    }
    if (init.method === "GET" && parsed.pathname.includes("/payment_policy/")) {
      return new Response(JSON.stringify({ paymentPolicyId: "payment_1", marketplaceId: "EBAY_US", categoryTypes: ["ALL_EXCLUDING_MOTORS_VEHICLES"], immediatePay: true }), { status: 200 })
    }
    if (init.method === "GET" && parsed.pathname.includes("/return_policy/")) {
      return new Response(JSON.stringify({ returnPolicyId: "return_1", marketplaceId: "EBAY_US", categoryTypes: ["ALL_EXCLUDING_MOTORS_VEHICLES"] }), { status: 200 })
    }
    if (init.method === "GET" && parsed.pathname.includes("/location/")) {
      return new Response(JSON.stringify({ merchantLocationKey: "LUNA_PORTEX_US", merchantLocationStatus: "ENABLED" }), { status: 200 })
    }
    if (init.method === "PUT") return new Response(null, { status: 204 })
    if (init.method === "POST" && parsed.pathname.endsWith("/offer")) return new Response(JSON.stringify({ offerId: "123456" }), { status: 201 })
    throw new Error("unexpected request")
  }
  try {
    const gatewayFingerprint = module.getEbayDraftOnlyGatewayConfig().accountFingerprint
    const dependencies = await module.preflightEbayDraftDependencies({
      fulfillmentPolicyId: "fulfillment_1",
      paymentPolicyId: "payment_1",
      returnPolicyId: "return_1",
      merchantLocationKey: "LUNA_PORTEX_US",
      preflightSnapshot: signedSnapshot({
        accountFingerprint: gatewayFingerprint,
        now: new Date(),
      }),
    }, fetchImpl)
    assert.equal(dependencies.safe, true)
    assert.equal(dependencies.checks.fulfillmentPolicy.valid, true)
    assert.equal(dependencies.checks.paymentPolicy.valid, true)
    assert.equal(dependencies.checks.returnPolicy.valid, true)
    assert.equal(dependencies.checks.merchantLocation.enabled, true)
    const collision = await module.preflightEbayDraftSkuCollision("IMNOVA-ITEM-1", fetchImpl)
    assert.equal(collision.safe, true)
    const inventory = await module.createOrReplaceEbayDraftInventoryItem("IMNOVA-ITEM-1", { product: {} }, fetchImpl)
    const offer = await module.createEbayUnpublishedOffer({ sku: "IMNOVA-ITEM-1" }, fetchImpl)
    assert.equal(inventory.ok, true)
    assert.equal(offer.ok, true)
    const tokenCalls = calls.filter((call) => call.url.pathname.endsWith("/oauth2/token"))
    assert.ok(tokenCalls.every((call) => call.url.origin === "https://api.sandbox.ebay.com"))
    assert.ok(tokenCalls.every((call) => String(call.body).includes("sell.account.readonly")))
    assert.ok(tokenCalls.every((call) => String(call.body).includes("commerce.identity.readonly")))
    const identityCalls = calls.filter((call) => call.url.pathname === "/commerce/identity/v1/user/")
    assert.ok(identityCalls.every((call) => call.url.origin === "https://apiz.sandbox.ebay.com"))
    const ebayCalls = calls.filter((call) => call.url.pathname.startsWith("/sell/"))
    assert.deepEqual(ebayCalls.map((call) => call.method), ["GET", "GET", "GET", "GET", "GET", "GET", "GET", "PUT", "POST"])
    assert.ok(ebayCalls.every((call) => call.url.origin === "https://api.sandbox.ebay.com"))
    assert.ok(ebayCalls.every((call) => !call.url.pathname.includes("publish_offer")))
    assert.deepEqual(
      ebayCalls.filter((call) => call.method === "GET").map((call) => call.url.pathname),
      [
        "/sell/account/v1/privilege",
        "/sell/account/v1/fulfillment_policy/fulfillment_1",
        "/sell/account/v1/payment_policy/payment_1",
        "/sell/account/v1/return_policy/return_1",
        "/sell/inventory/v1/location/LUNA_PORTEX_US",
        "/sell/inventory/v1/inventory_item/IMNOVA-ITEM-1",
        "/sell/inventory/v1/offer",
      ],
    )
  } finally {
    process.env = original
  }
})

test("dependency preflight fails closed for a missing policy or disabled merchant location", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_TARGET: "SANDBOX",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID: "client",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET: "secret",
    EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN: "separate-write-refresh-token",
    EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID: "sandbox-user-1",
    EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const gatewayFingerprint = module.getEbayDraftOnlyGatewayConfig().accountFingerprint
  const input = {
    fulfillmentPolicyId: "fulfillment_1",
    paymentPolicyId: "payment_1",
    returnPolicyId: "return_1",
    merchantLocationKey: "LUNA_PORTEX_US",
    preflightSnapshot: signedSnapshot({
      accountFingerprint: gatewayFingerprint,
      now: new Date(),
    }),
  }
  const dependencyCalls = []
  const responseFor = (parsed, locationStatus, missingFulfillment) => {
    if (parsed.pathname.endsWith("/oauth2/token")) return { access_token: "access" }
    if (parsed.pathname === "/commerce/identity/v1/user/") return { userId: "sandbox-user-1", status: "CONFIRMED" }
    if (parsed.pathname === "/sell/account/v1/privilege") {
      return { sellerRegistrationCompleted: true, sellingLimit: { amount: { value: "1000", currency: "USD" } } }
    }
    if (parsed.pathname.includes("/fulfillment_policy/")) {
      return missingFulfillment ? null : { fulfillmentPolicyId: "fulfillment_1", marketplaceId: "EBAY_US", categoryTypes: ["ALL_EXCLUDING_MOTORS_VEHICLES"] }
    }
    if (parsed.pathname.includes("/payment_policy/")) return { paymentPolicyId: "payment_1", marketplaceId: "EBAY_US", categoryTypes: ["ALL_EXCLUDING_MOTORS_VEHICLES"], immediatePay: true }
    if (parsed.pathname.includes("/return_policy/")) return { returnPolicyId: "return_1", marketplaceId: "EBAY_US", categoryTypes: ["ALL_EXCLUDING_MOTORS_VEHICLES"] }
    if (parsed.pathname.includes("/location/")) {
      return { merchantLocationKey: "LUNA_PORTEX_US", merchantLocationStatus: locationStatus }
    }
    throw new Error("unexpected request")
  }
  try {
    const disabled = await module.preflightEbayDraftDependencies(input, async (url, init = {}) => {
      const parsed = new URL(url)
      dependencyCalls.push({ parsed, method: init.method })
      const body = responseFor(parsed, "DISABLED", false)
      return new Response(JSON.stringify(body), { status: 200 })
    })
    assert.equal(disabled.safe, false)
    assert.equal(disabled.terminal, false)
    assert.equal(disabled.blocker, "EBAY_MERCHANT_LOCATION_DISABLED")

    const missingPolicy = await module.preflightEbayDraftDependencies(input, async (url, init = {}) => {
      const parsed = new URL(url)
      dependencyCalls.push({ parsed, method: init.method })
      const body = responseFor(parsed, "ENABLED", true)
      return body === null
        ? new Response(JSON.stringify({ errors: [] }), { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 })
    })
    assert.equal(missingPolicy.safe, false)
    assert.equal(missingPolicy.terminal, false)
    assert.equal(missingPolicy.blocker, "EBAY_FULFILLMENT_POLICY_INVALID")

    const changedPayment = await module.preflightEbayDraftDependencies(input, async (url, init = {}) => {
      const parsed = new URL(url)
      const body = responseFor(parsed, "ENABLED", false)
      if (parsed.pathname.includes("/payment_policy/")) {
        body.categoryTypes = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }]
        body.immediatePay = false
      }
      return new Response(JSON.stringify(body), { status: 200 })
    })
    assert.equal(changedPayment.safe, false)
    assert.equal(changedPayment.blocker, "EBAY_PAYMENT_POLICY_INVALID")
    assert.ok(dependencyCalls
      .filter((call) => call.parsed.pathname.startsWith("/sell/"))
      .every((call) => call.method === "GET"))
  } finally {
    process.env = original
  }
})

test("mobile preflight bootstraps a fingerprint with writes disabled and returns only sanitized GET data", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "false",
    EBAY_DRAFT_ONLY_TARGET: "SANDBOX",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID: "mobile-bootstrap-client",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET: "mobile-bootstrap-client-secret",
    EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN: "mobile-bootstrap-refresh-token",
    EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  delete process.env.EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID
  delete process.env.EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_ACCOUNT_FINGERPRINT
  const { calls, fetchImpl } = mobilePreflightMock({ userId: "mobile-user-id-must-never-leak" })
  try {
    const unbound = await module.preflightEbayDraftOnlyMobile({}, fetchImpl)
    assert.equal(unbound.identity.status, "IDENTITY_UNBOUND")
    assert.match(unbound.identity.accountFingerprint, /^[0-9a-f]{64}$/)
    assert.equal(unbound.identity.accountType, "BUSINESS")
    assert.equal(unbound.identity.registrationMarketplaceId, "EBAY_US")
    assert.equal(unbound.privilege.usable, true)
    assert.equal(unbound.privilege.sellingLimitPresent, false)
    assert.equal(unbound.selectionComplete, true)
    assert.equal(unbound.snapshot, "")
    assert.equal(unbound.snapshotStatus, "IDENTITY_UNBOUND")

    process.env.EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_ACCOUNT_FINGERPRINT = unbound.identity.accountFingerprint
    const bound = await module.preflightEbayDraftOnlyMobile({}, fetchImpl)
    assert.equal(bound.identity.status, "BOUND")
    assert.equal(bound.snapshotStatus, "READY")
    assert.ok(bound.snapshot)
    assert.deepEqual(bound.selection, {
      fulfillmentPolicyId: "fulfillment_1",
      paymentPolicyId: "payment_1",
      returnPolicyId: "return_1",
      merchantLocationKey: "LUNA_PORTEX_US",
    })
    assert.equal(module.getEbayDraftOnlyGatewayConfig().configured, true)
    await assert.rejects(
      module.createEbayUnpublishedOffer({ sku: RESERVED_SKU }, fetchImpl),
      /EBAY_DRAFT_ONLY_WRITES_DISABLED/,
    )

    const serialized = JSON.stringify(bound)
    for (const secret of [
      "mobile-user-id-must-never-leak",
      "must-never-leak-access-token",
      "must-never-leak-refresh-token",
      "must-never-leak-identity-address",
      "must-never-leak",
      "mobile-bootstrap-client-secret",
    ]) assert.equal(serialized.includes(secret), false)
    const resourceCalls = calls.filter((call) => call.url.pathname.startsWith("/sell/")
      || call.url.pathname.startsWith("/commerce/"))
    assert.ok(resourceCalls.every((call) => call.method === "GET"))
    assert.equal(calls.filter((call) => call.method === "POST").length, 1)
    assert.equal(calls.filter((call) => call.url.pathname.endsWith("/oauth2/token")).length, 1)
    for (const call of calls.filter((item) => /_policy$/.test(item.url.pathname))) {
      assert.deepEqual([...call.url.searchParams.keys()], ["marketplace_id"])
      assert.equal(call.url.searchParams.get("marketplace_id"), "EBAY_US")
    }
  } finally {
    process.env = original
  }
})

test("mobile selectors auto-select only one publish-ready option and require an explicit choice when ambiguous", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "false",
    EBAY_DRAFT_ONLY_TARGET: "SANDBOX",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID: "mobile-selector-client",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET: "mobile-selector-secret",
    EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN: "mobile-selector-refresh",
    EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID: "selector-user",
    EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  delete process.env.EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_ACCOUNT_FINGERPRINT
  const categories = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }]
  const { fetchImpl } = mobilePreflightMock({
    userId: "selector-user",
    sellingLimit: { amount: { value: "0", currency: "USD" } },
    fulfillmentPolicies: [
      { fulfillmentPolicyId: "fulfillment_1", name: "First", marketplaceId: "EBAY_US", categoryTypes: categories },
      { fulfillmentPolicyId: "fulfillment_2", name: "Second", marketplaceId: "EBAY_US", categoryTypes: categories },
      { fulfillmentPolicyId: "motors_only", name: "Motors", marketplaceId: "EBAY_US", categoryTypes: [{ name: "MOTORS_VEHICLES" }] },
    ],
    paymentPolicies: [
      { paymentPolicyId: "payment_bad", name: "No immediate", marketplaceId: "EBAY_US", categoryTypes: categories, immediatePay: false },
      { paymentPolicyId: "payment_1", name: "Immediate", marketplaceId: "EBAY_US", categoryTypes: categories, immediatePay: true },
    ],
    locations: [
      { merchantLocationKey: "LUNA_PORTEX_US", name: "Enabled", merchantLocationStatus: "ENABLED" },
      { merchantLocationKey: "DISABLED_US", name: "Disabled", merchantLocationStatus: "DISABLED" },
      { merchantLocationKey: "invalid location key", name: "Invalid", merchantLocationStatus: "ENABLED" },
    ],
  })
  try {
    const ambiguous = await module.preflightEbayDraftOnlyMobile({}, fetchImpl)
    assert.equal(ambiguous.selection.fulfillmentPolicyId, "")
    assert.equal(ambiguous.selection.paymentPolicyId, "payment_1")
    assert.equal(ambiguous.selection.merchantLocationKey, "LUNA_PORTEX_US")
    assert.equal(ambiguous.snapshotStatus, "SELECTION_REQUIRED")
    assert.equal(ambiguous.snapshot, "")
    assert.equal(ambiguous.privilege.usable, true)
    assert.equal(ambiguous.privilege.sellingLimitZero, true)
    assert.deepEqual(ambiguous.warnings, ["SELLING_LIMIT_ZERO_PUBLISH_BLOCKED"])
    assert.equal(ambiguous.options.paymentPolicies.find((item) => item.id === "payment_bad").usable, false)
    assert.equal(ambiguous.options.fulfillmentPolicies.find((item) => item.id === "motors_only").usable, false)
    assert.equal(ambiguous.options.merchantLocations.some((item) => item.id === "invalid location key"), false)

    const selected = await module.preflightEbayDraftOnlyMobile({
      fulfillmentPolicyId: "fulfillment_2",
    }, fetchImpl)
    assert.equal(selected.selection.fulfillmentPolicyId, "fulfillment_2")
    assert.equal(selected.snapshotStatus, "READY")
    assert.ok(selected.snapshot)
  } finally {
    process.env = original
  }
})

test("Identity must be CONFIRMED before any seller-resource preflight", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "false",
    EBAY_DRAFT_ONLY_TARGET: "SANDBOX",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID: "identity-pending-client",
    EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET: "identity-pending-secret",
    EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN: "identity-pending-refresh",
    EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID: "pending-user",
    EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const { calls, fetchImpl } = mobilePreflightMock({
    userId: "pending-user",
    identityStatus: "PENDING",
  })
  try {
    await assert.rejects(
      module.preflightEbayDraftOnlyMobile({}, fetchImpl),
      /EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_NOT_CONFIRMED/,
    )
    assert.equal(calls.filter((call) => call.url.pathname.startsWith("/sell/")).length, 0)
  } finally {
    process.env = original
  }
})

test("signed eBay preflight snapshots expire after five minutes and are bound to account and IDs", () => {
  const now = new Date("2026-07-13T05:00:00.000Z")
  const token = signedSnapshot({ now })
  const expected = {
    target: "SANDBOX",
    accountFingerprint: SANDBOX_FINGERPRINT,
    marketplaceId: "EBAY_US",
    fulfillmentPolicyId: "fulfillment_1",
    paymentPolicyId: "payment_1",
    returnPolicyId: "return_1",
    merchantLocationKey: "LUNA_PORTEX_US",
  }
  assert.equal(snapshotModule.verifyEbayDraftOnlyPreflightSnapshot(token, expected, SNAPSHOT_SECRET, new Date(now.getTime() + 300_000)).valid, true)
  assert.equal(snapshotModule.verifyEbayDraftOnlyPreflightSnapshot(token, expected, SNAPSHOT_SECRET, new Date(now.getTime() + 300_001)).blocker, "EBAY_PREFLIGHT_SNAPSHOT_STALE")
  assert.equal(snapshotModule.verifyEbayDraftOnlyPreflightSnapshot(token, { ...expected, paymentPolicyId: "other" }, SNAPSHOT_SECRET, now).blocker, "EBAY_PREFLIGHT_SNAPSHOT_BINDING_MISMATCH")
  assert.equal(snapshotModule.verifyEbayDraftOnlyPreflightSnapshot(`${token}x`, expected, SNAPSHOT_SECRET, now).valid, false)
})

test("route requires a human Admin, exact approval, fresh revalidation and unknown-offer quarantine", () => {
  assert.match(routeSource, /validateAdminApiRequest/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_HUMAN_ADMIN_REQUIRED/)
  assert.match(routeSource, /ebayDraftOnlyApprovalPhrase/)
  assert.match(routeSource, /confirmUnpublishedOnly/)
  assert.match(routeSource, /confirmNoPublish/)
  assert.match(routeSource, /evaluateEbayDraftOnlyReadiness/)
  assert.match(routeSource, /APPROVED_PAYLOAD_CHANGED/)
  assert.match(routeSource, /preflightEbayDraftDependencies/)
  assert.match(routeSource, /preflightEbayDraftSkuCollision/)
  const executeSource = routeSource.slice(routeSource.indexOf("async function executeDraft"))
  assert.ok(executeSource.indexOf("preflightEbayDraftDependencies") < executeSource.indexOf("claim_ebay_draft_only_execution"))
  assert.ok(executeSource.indexOf("preflightEbayDraftSkuCollision") < executeSource.indexOf("createOrReplaceEbayDraftInventoryItem"))
  assert.match(executeSource, /preflight\.collision \? "terminal_failure" : "claimed"/)
  assert.match(routeSource, /serverApprovedConfiguration/)
  assert.match(routeSource, /imageAssetManifest/)
  assert.match(routeSource, /imageManifestConfirmed/)
  assert.match(routeSource, /protectedManifestVerified/)
  assert.match(routeSource, /const claimToken = randomUUID\(\)/)
  assert.match(routeSource, /p_claim_token: claimToken/)
  assert.match(routeSource, /offer_create_in_flight/)
  assert.match(routeSource, /offer_outcome_unknown/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_JSON_INVALID/)
  assert.match(routeSource, /action === "revoke"/)
  assert.match(routeSource, /action === "preflight"/)
  assert.match(routeSource, /preflightEbayDraftOnlyMobile/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_APPROVAL_NOT_REVOCABLE/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_EXECUTION_BUSY/)
  assert.match(routeSource, /inspectEbayDraftSkuState/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED/)
  assert.match(routeSource, /UNPUBLISHED_VERIFIED_AT_CREATE/)
  assert.match(routeSource, /\.eq\("lease_token", claimToken\)/)
  assert.ok(
    executeSource.indexOf('existing?.phase === "inventory_outcome_unknown"')
      < executeSource.indexOf('approval.status !== "approved"'),
  )
  assert.ok(
    executeSource.indexOf("inspectEbayDraftSkuState")
      < executeSource.lastIndexOf('if (approval.status !== "approved"'),
  )
  assert.doesNotMatch(routeSource, /publishOffer\s*\(/)
})

test("migration enforces one-time TTL approvals, idempotency, SKU uniqueness and no publish operation", () => {
  assert.match(migrationSource, /expires_at <= approved_at \+ interval '60 minutes'/)
  assert.match(migrationSource, /approval_id uuid not null unique/)
  assert.match(migrationSource, /idempotency_key text not null unique/)
  assert.match(migrationSource, /ebay_draft_only_target_sku_uidx/)
  assert.match(migrationSource, /offer_create_in_flight/)
  assert.match(migrationSource, /offer_outcome_unknown/)
  assert.match(migrationSource, /not \('publishOffer' = any\(permitted_operations\)\)/)
  assert.match(migrationSource, /enable row level security/)
  assert.match(migrationSource, /revoke all.*anon, authenticated/)
  assert.match(migrationSource, /for update/)
  assert.match(migrationSource, /lease_expires_at > now\(\)/)
  assert.match(migrationSource, /approve_ebay_draft_only_package/)
  assert.match(migrationSource, /claim_ebay_draft_only_execution/)
  assert.match(migrationSource, /complete_ebay_draft_only_execution/)
})

test("professional package evidence resolves only package-level hard gates", async () => {
  const module = await importTypeScript(readinessSource)
  const input = validInput()
  input.listingPackage.status = "draft"
  input.opportunity.queue_status = "review"
  input.opportunity.hard_gates = [
    "NEED_AUTHORIZED_PRODUCT_IMAGES",
    "NEED_PACKAGE_WEIGHT_AND_DIMENSIONS",
    "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
  ]
  const result = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(result.ready, true)
  input.opportunity.hard_gates.push("NEED_EXACT_IDENTITY")
  const blocked = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(blocked.ready, false)
  assert.ok(blocked.blockers.includes("HARD_GATE:NEED_EXACT_IDENTITY"))
})

test("Production target is double-opt-in and cannot reuse generic or Sandbox credentials", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  try {
    Object.assign(process.env, {
      EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
      EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
      EBAY_DRAFT_ONLY_CLIENT_ID: "generic-client-must-be-ignored",
      EBAY_DRAFT_ONLY_CLIENT_SECRET: "generic-secret-must-be-ignored",
      EBAY_DRAFT_ONLY_REFRESH_TOKEN: "generic-token-must-be-ignored",
      EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID: "sandbox-client-must-be-ignored",
      EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET: "sandbox-secret-must-be-ignored",
      EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN: "sandbox-token-must-be-ignored",
      EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "false",
    })
    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID
    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET
    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN
    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID
    const isolated = module.getEbayDraftOnlyGatewayConfig()
    assert.equal(isolated.target, "PRODUCTION")
    assert.equal(isolated.configured, false)
    assert.equal(isolated.enabled, false)
    assert.equal(isolated.clientId, "")
    assert.equal(isolated.apiOrigin, "https://api.ebay.com")
    assert.equal(isolated.identityOrigin, "https://apiz.ebay.com")
    assert.equal(isolated.tokenEndpoint, "https://api.ebay.com/identity/v1/oauth2/token")

    Object.assign(process.env, {
      EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
      EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/draft-production",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/draft-production",
      EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-draft-client",
      EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-draft-secret",
      EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-draft-refresh",
      EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "immutable-production-user",
      EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
    })
    const configured = module.getEbayDraftOnlyGatewayConfig()
    assert.equal(configured.configured, true)
    assert.equal(configured.enabled, true)
    assert.equal(configured.clientId, "production-draft-client")
    assert.match(configured.accountFingerprint, /^[0-9a-f]{64}$/)
    assert.equal(module.isEbayDraftOnlyForbiddenWritePath("/sell/inventory/v1/offer/123/publish"), true)
    assert.equal(module.isEbayDraftOnlyForbiddenWritePath("/sell/inventory/v1/bulk_publish_offer"), true)
    assert.equal(module.isEbayDraftOnlyForbiddenWritePath("/sell/inventory/v1/offer/publish_by_inventory_item_group"), true)
    assert.equal(module.isEbayDraftOnlyForbiddenWritePath("/sell/inventory/v1/offer"), false)
    process.env.VERCEL_ENV = "production"
    const productionDeployment = module.getEbayDraftOnlyGatewayConfig()
    assert.equal(productionDeployment.environmentAllowed, false)
    assert.equal(productionDeployment.enabled, false)
  } finally {
    process.env = original
  }
})

test("Production account identity mismatch fails closed before every seller write", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/draft-production",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/draft-production",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-client",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "expected-user",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const calls = []
  try {
    await assert.rejects(
      module.createEbayUnpublishedOffer({ sku: "PROD-SKU-IDENTITY" }, async (url, init = {}) => {
        const parsed = new URL(url)
        calls.push({ url: parsed, method: init.method })
        if (parsed.pathname.endsWith("/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "access" }), { status: 200 })
        }
        if (parsed.pathname === "/commerce/identity/v1/user/") {
          return new Response(JSON.stringify({ userId: "different-user", status: "CONFIRMED" }), { status: 200 })
        }
        throw new Error("seller write must never be reached")
      }),
      /EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_MISMATCH/,
    )
    assert.equal(calls.filter((call) => call.url.pathname.startsWith("/sell/")).length, 0)
  } finally {
    process.env = original
  }
})

test("Production PUT is attempted once and reconciled by a read from the correct account", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/draft-production",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/draft-production",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-client",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "production-user-1",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const payload = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: "NEW",
    product: { title: "Exact item", imageUrls: ["https://supplier.example.test/1.jpg"] },
  }
  const calls = []
  try {
    const result = await module.createOrReplaceEbayDraftInventoryItem(
      "PROD-SKU-1",
      payload,
      async (url, init = {}) => {
        const parsed = new URL(url)
        calls.push({ url: parsed, method: init.method })
        if (parsed.pathname.endsWith("/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "access" }), { status: 200 })
        }
        if (parsed.pathname === "/commerce/identity/v1/user/") {
          return new Response(JSON.stringify({ userId: "production-user-1", status: "CONFIRMED" }), { status: 200 })
        }
        if (init.method === "PUT") throw new Error("simulated timeout after send")
        if (init.method === "GET" && parsed.pathname.includes("/inventory_item/")) {
          return new Response(JSON.stringify({ ...payload, locale: "en_US" }), { status: 200 })
        }
        throw new Error(`unexpected ${init.method} ${parsed}`)
      },
    )
    assert.equal(result.ok, true)
    assert.equal(result.reconciled, true)
    assert.equal(calls.filter((call) => call.method === "PUT").length, 1)
    assert.equal(calls.find((call) => call.url.pathname === "/commerce/identity/v1/user/").url.origin, "https://apiz.ebay.com")
    assert.ok(calls.filter((call) => call.url.pathname.startsWith("/sell/")).every((call) => call.url.origin === "https://api.ebay.com"))
  } finally {
    process.env = original
  }
})

test("Production PUT with an unknown outcome and immediate 404s stays quarantined after bounded rereads", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/draft-production",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/draft-production",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "unknown-put-client",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "unknown-put-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "unknown-put-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "unknown-put-user",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const calls = []
  try {
    const result = await module.createOrReplaceEbayDraftInventoryItem(
      "IMNOVA-UNKNOWN-PUT",
      { condition: "NEW", product: { title: "Unknown PUT" } },
      async (url, init = {}) => {
        const parsed = new URL(url)
        calls.push({ url: parsed, method: init.method })
        if (parsed.pathname.endsWith("/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "access", expires_in: 7200 }), { status: 200 })
        }
        if (parsed.pathname === "/commerce/identity/v1/user/") {
          return new Response(JSON.stringify({ userId: "unknown-put-user", status: "CONFIRMED" }), { status: 200 })
        }
        if (init.method === "PUT") throw new Error("timeout after bytes may have been sent")
        if (init.method === "GET" && parsed.pathname.includes("/inventory_item/")) {
          return new Response(JSON.stringify({ errors: [] }), { status: 404 })
        }
        throw new Error(`unexpected ${init.method} ${parsed}`)
      },
    )
    assert.equal(result.ok, false)
    assert.equal(result.outcomeKnown, false)
    assert.equal(result.retryable, false)
    assert.equal(result.body.blocker, "EBAY_INVENTORY_OUTCOME_UNKNOWN")
    assert.equal(result.body.lastReadStatus, 404)
    assert.equal(result.body.boundedReadAttempts, 3)
    assert.equal(calls.filter((call) => call.method === "PUT").length, 1)
    assert.equal(calls.filter((call) => call.method === "GET" && call.url.pathname.includes("/inventory_item/")).length, 3)
  } finally {
    process.env = original
  }
})

test("Offer verification binds offer, SKU and marketplace; unique unknown outcome can be reconciled read-only", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "false",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "false",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-client",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "production-user-1",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const expected = {
    sku: "PROD-SKU-2",
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: "11700",
    merchantLocationKey: "WAREHOUSE_1",
    listingPolicies: {
      fulfillmentPolicyId: "f1",
      paymentPolicyId: "p1",
      returnPolicyId: "r1",
    },
    pricingSummary: { price: { value: "24.99", currency: "USD" } },
  }
  const offer = { ...expected, offerId: "offer-123", status: "UNPUBLISHED" }
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ url: parsed, method: init.method })
    if (parsed.pathname.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access" }), { status: 200 })
    }
    if (parsed.pathname === "/commerce/identity/v1/user/") {
      return new Response(JSON.stringify({ userId: "production-user-1", status: "CONFIRMED" }), { status: 200 })
    }
    if (parsed.pathname === "/sell/inventory/v1/offer") {
      return new Response(JSON.stringify({ offers: [offer] }), { status: 200 })
    }
    if (parsed.pathname === "/sell/inventory/v1/offer/offer-123") {
      return new Response(JSON.stringify(offer), { status: 200 })
    }
    throw new Error(`unexpected ${init.method} ${parsed}`)
  }
  try {
    const reconciled = await module.discoverEbayUnpublishedOfferBySku("PROD-SKU-2", expected, fetchImpl)
    assert.equal(reconciled.safe, true)
    assert.equal(reconciled.offerId, "offer-123")
    const mismatch = await module.verifyEbayUnpublishedOffer("offer-123", "WRONG-SKU", "EBAY_US", fetchImpl)
    assert.equal(mismatch.safe, false)
    assert.equal(mismatch.blocker, "EBAY_OFFER_IDENTITY_MISMATCH")
    assert.ok(calls.every((call) => !/publish|bulk_publish/.test(call.url.pathname)))
  } finally {
    process.env = original
  }
})

test("authorized publication sends publishOffer exactly once and returns the listing ID", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-client-publish-success",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "production-user-1",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
    EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/draft-production",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/draft-production",
    EBAY_PRO_RUNTIME: "staging",
  })
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    const method = init.method ?? "GET"
    calls.push({ pathname: parsed.pathname, method })
    if (parsed.pathname.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access" }), { status: 200 })
    }
    if (parsed.pathname === "/commerce/identity/v1/user/") {
      return new Response(JSON.stringify({ userId: "production-user-1", status: "CONFIRMED" }), { status: 200 })
    }
    if (parsed.pathname === "/sell/inventory/v1/offer/offer-123" && method === "GET") {
      return new Response(JSON.stringify({
        offerId: "offer-123",
        sku: RESERVED_SKU,
        marketplaceId: "EBAY_US",
        status: "UNPUBLISHED",
      }), { status: 200 })
    }
    if (parsed.pathname === "/sell/inventory/v1/offer/offer-123/publish" && method === "POST") {
      return new Response(JSON.stringify({ listingId: "123456789012" }), { status: 200 })
    }
    throw new Error(`unexpected ${method} ${parsed.pathname}`)
  }
  try {
    const result = await module.publishEbayOfferOnce({
      offerId: "offer-123",
      expectedSku: RESERVED_SKU,
      previewHash: "a".repeat(64),
      publicationControlId: "55555555-5555-4555-8555-555555555555",
      confirmPublish: "PUBLICAR LISTING EN EBAY",
    }, fetchImpl)
    assert.equal(result.ok, true)
    assert.equal(result.listingId, "123456789012")
    assert.equal(result.publishRequestSent, true)
    assert.equal(result.reconciled, false)
    assert.equal(calls.filter((call) => call.method === "POST"
      && call.pathname.endsWith("/publish")).length, 1)
  } finally {
    process.env = original
  }
})

test("an uncertain publish response is reconciled with GET and never repeats POST", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-client-publish-timeout",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "production-user-1",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
    EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/draft-production",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/draft-production",
    EBAY_PRO_RUNTIME: "staging",
  })
  const calls = []
  let offerReads = 0
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    const method = init.method ?? "GET"
    calls.push({ pathname: parsed.pathname, method })
    if (parsed.pathname.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access" }), { status: 200 })
    }
    if (parsed.pathname === "/commerce/identity/v1/user/") {
      return new Response(JSON.stringify({ userId: "production-user-1", status: "CONFIRMED" }), { status: 200 })
    }
    if (parsed.pathname === "/sell/inventory/v1/offer/offer-456" && method === "GET") {
      offerReads += 1
      return new Response(JSON.stringify({
        offerId: "offer-456",
        sku: RESERVED_SKU,
        marketplaceId: "EBAY_US",
        status: offerReads === 1 ? "UNPUBLISHED" : "PUBLISHED",
        ...(offerReads === 1 ? {} : { listing: { listingId: "987654321098" } }),
      }), { status: 200 })
    }
    if (parsed.pathname === "/sell/inventory/v1/offer/offer-456/publish" && method === "POST") {
      throw new Error("simulated connection timeout after dispatch")
    }
    throw new Error(`unexpected ${method} ${parsed.pathname}`)
  }
  try {
    const result = await module.publishEbayOfferOnce({
      offerId: "offer-456",
      expectedSku: RESERVED_SKU,
      previewHash: "b".repeat(64),
      publicationControlId: "66666666-6666-4666-8666-666666666666",
      confirmPublish: "PUBLICAR LISTING EN EBAY",
    }, fetchImpl)
    assert.equal(result.ok, true)
    assert.equal(result.listingId, "987654321098")
    assert.equal(result.reconciled, true)
    assert.equal(calls.filter((call) => call.method === "POST"
      && call.pathname.endsWith("/publish")).length, 1)
    assert.ok(calls.filter((call) => call.method === "GET"
      && call.pathname.endsWith("/offer/offer-456")).length >= 2)
  } finally {
    process.env = original
  }
})

test("Production draft and final publication use separate account-bound one-shot ledgers", async () => {
  const module = await importTypeScript(readinessSource)
  const input = validInput()
  input.target = "PRODUCTION"
  input.accountFingerprint = PRODUCTION_FINGERPRINT
  input.draftConfiguration.ebayPreflightSnapshot = signedSnapshot({
    target: "PRODUCTION",
    accountFingerprint: PRODUCTION_FINGERPRINT,
    now: input.now,
  })
  process.env.EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET = SNAPSHOT_SECRET
  const production = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(production.ready, true)
  assert.equal(production.payload.safety.target, "PRODUCTION")
  assert.equal(production.payload.safety.accountFingerprint, PRODUCTION_FINGERPRINT)
  assert.equal(module.ebayDraftOnlyApprovalPhrase("PRODUCTION"), "CREAR DRAFT NO PUBLICADO EN PRODUCCIÓN")

  const quantityTwo = validInput()
  quantityTwo.target = "PRODUCTION"
  quantityTwo.accountFingerprint = PRODUCTION_FINGERPRINT
  quantityTwo.draftConfiguration.quantity = 2
  quantityTwo.draftConfiguration.ebayPreflightSnapshot = signedSnapshot({
    target: "PRODUCTION",
    accountFingerprint: PRODUCTION_FINGERPRINT,
    now: quantityTwo.now,
  })
  const quantityBlocked = module.evaluateEbayDraftOnlyReadiness(quantityTwo)
  assert.equal(quantityBlocked.ready, false)
  assert.ok(quantityBlocked.blockers.includes("PRODUCTION_QUANTITY_MUST_EQUAL_ONE"))

  assert.match(gatewaySource, /https:\/\/api\.ebay\.com/)
  assert.match(gatewaySource, /https:\/\/apiz\.ebay\.com/)
  assert.match(gatewaySource, /bulk_publish_offer/)
  assert.match(gatewaySource, /publish_by_inventory_item_group/)
  assert.match(gatewaySource, /offer\\\/\[\^\/\]\+\\\/publish/)
  assert.match(routeSource, /verifyEbayUnpublishedOffer/)
  assert.match(routeSource, /discoverEbayUnpublishedOfferBySku/)
  assert.match(routeSource, /prepare_publish/)
  assert.match(routeSource, /reconcile_publish/)
  assert.match(routeSource, /confirmPublish !== EBAY_FINAL_PUBLISH_CONFIRMATION/)
  assert.equal((routeSource.match(/publishEbayOfferOnce\(/g) ?? []).length, 1)
  assert.match(gatewaySource, /EBAY_FINAL_PUBLISH_CONFIRMATION = "PUBLICAR LISTING EN EBAY"/)
  assert.match(gatewaySource, /A timeout is never retried with POST/)
  assert.match(routeSource, /verifyEbayPublishedOffer/)
  assert.match(routeSource, /sync_same_day_source_before_authorized_publication/)
  assert.match(routeSource, /EBAY_FINAL_PUBLICATION_SAME_DAY_BINDING_REQUIRED/)
  assert.match(sameDayPublicationSource, /SELLER_OS_AUTHORIZED_PUBLICATION_V1_2026_07_20/)
  assert.match(sameDayPublicationSource, /exactSixHttpsUrls/)
  assert.match(sameDayPublicationSource, /finalHumanAuthorizationRequired: true/)
  assert.match(sameDayPublicationSource, /unattendedPublicationAllowed: false/)
  assert.match(sameDayImageRuntimeSource, /SAME_DAY_IMAGE_LISTING_PACKAGE_BINDING_CONFLICT/)
  assert.match(sameDayImageRuntimeSource, /sameDayPilot: requestedBinding/)
  assert.match(publicationMigrationSource, /ebay_authorized_listing_publications/)
  assert.match(publicationMigrationSource, /preview_hash text not null/)
  assert.match(publicationMigrationSource, /publish_attempt_count between 0 and 1/)
  assert.match(publicationMigrationSource, /p_confirm_publish <> 'PUBLICAR LISTING EN EBAY'/)
  assert.match(publicationMigrationSource, /phase = 'published_pending_verification'/)
  assert.match(publicationMigrationSource, /phase = 'monitor_registered'/)
  assert.match(sameDaySourceSyncMigration, /sync_same_day_source_before_authorized_publication/)
  assert.match(sameDaySourceSyncMigration, /candidate\.machine_state in \('READY_FOR_MANUAL_PUBLICATION', 'WAITING_ITEM_ID'\)/)
  assert.match(sameDaySourceSyncMigration, /jsonb_array_length\(coalesce\(v_package\.package_data->'imageUrls'/)
  assert.match(sameDaySourceSyncMigration, /EBAY_SAME_DAY_PUBLICATION_IMAGE_BINDING_INVALID/)
  assert.match(sameDaySourceSyncMigration, /v_image_summary->'publicUrls'[\s\S]*v_handoff#>'\{images,urls\}'/)
  assert.match(sameDaySourceSyncMigration, /v_source_observed_at < clock_timestamp\(\) - interval '6 hours'/)
  assert.match(sameDaySourceSyncMigration, /abs\(v_approved_source_price - v_source_price\) >= 0\.005/)
  assert.match(sameDaySourceSyncMigration, /ebay_writes, production_changed[\s\S]*0, 0, 0, false/)
  assert.match(sameDaySourceSyncMigration, /revoke all[\s\S]*from public, anon, authenticated/)
  assert.match(sameDaySourceSyncMigration, /grant execute[\s\S]*to service_role/)
  assert.match(routeSource, /p_account_fingerprint: fingerprint/)
  assert.match(productionMigrationSource, /target in \('SANDBOX', 'PRODUCTION'\)/)
  assert.match(productionMigrationSource, /account_fingerprint/)
  assert.match(productionMigrationSource, /p_verified_status/)
  assert.match(productionMigrationSource, /p_listing_present/)
  assert.match(productionMigrationSource, /p_verified_sku/)
  assert.match(productionMigrationSource, /p_verified_marketplace_id/)
  assert.match(productionMigrationSource, /interval '15 minutes'/)
  assert.match(productionMigrationSource, /inventory_outcome_unknown/)
  assert.match(productionMigrationSource, /offer_outcome_unknown/)
  assert.match(productionMigrationSource, /interval '5 minutes'/)
  assert.match(productionMigrationSource, /p_claim_token uuid/)
  assert.match(productionMigrationSource, /lease_token is distinct from p_claim_token/)
  assert.match(productionMigrationSource, /inventoryItemPayload,availability,shipToLocationAvailability,quantity.*is distinct from '1'/s)
})
