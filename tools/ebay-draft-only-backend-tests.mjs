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
const tradingIdentityProofSource = readFileSync(
  new URL("../lib/ebay/ebay-trading-identity-proof.ts", import.meta.url),
  "utf8",
)
const skuSource = readFileSync(
  new URL("../lib/ebay/ebay-sku.ts", import.meta.url),
  "utf8",
)

function embedSnapshotModule(source) {
  const withoutImport = source
    .replace('import { verifyEbayDraftOnlyPreflightSnapshot } from "./ebay-draft-only-preflight-snapshot"\n', "")
    .replace(/import \{\n  calculateEbayUnitEconomics,\n  DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,\n  normalizeEbayUnitEconomicsConfig,\n  type EbayUnitEconomicsConfig,\n\} from "\.\/ebay-unit-economics"\n/, "")
    .replace(/import \{\n  issueEbayDraftOnlyPreflightSnapshot,\n  verifyEbayDraftOnlyPreflightSnapshot,\n\} from "\.\/ebay-draft-only-preflight-snapshot"\n/, "")
    .replace('import { getEbayDraftWriteEnvironmentBoundary } from "./environment-boundaries"\n', "")
    .replace('import { readEbayTradingUserIdWithAccessToken } from "./ebay-trading-identity-proof"\n', "")
    .replace(/import \{\n  canonicalEbayPackageSku,\n  isCanonicalEbayPackageSku,\n\} from "\.\/ebay-sku"\n/, "")
    .replace('import { isCanonicalEbayPackageSku } from "./ebay-sku"\n', "")
  return `${snapshotSource}\n${economicsSource}\n${environmentBoundarySource}\n${tradingIdentityProofSource}\n${skuSource}\n${withoutImport}`
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
const prewriteRetirementSource = readFileSync(
  new URL("../lib/ebay/ebay-draft-only-prewrite-retirement.ts", import.meta.url),
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
const alphanumericSkuMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260723017000_use_ebay_inventory_alphanumeric_sku.sql", import.meta.url),
  "utf8",
)
const inventoryHeaderMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260723018000_retire_invalid_inventory_header_preflight.sql", import.meta.url),
  "utf8",
)
const v3PublicationPreviewMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260724001000_support_v3_authorized_publication_preview.sql", import.meta.url),
  "utf8",
)
const v3PublicationClaimMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260724002000_support_v3_publication_claim_image_gate.sql", import.meta.url),
  "utf8",
)
const finalMonitorClosureMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260724003000_fix_final_publication_monitor_closure.sql", import.meta.url),
  "utf8",
)
const smartStockingImageGateMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260828000800_align_smart_stocking_prepare_image_gate_v1.sql", import.meta.url),
  "utf8",
)
const smartStockingMonitorMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260828001200_align_smart_stocking_monitor_registration_v1.sql", import.meta.url),
  "utf8",
)
const compensatedPublicationRecoveryMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260828001500_recover_compensated_smart_stocking_publication_v1.sql", import.meta.url),
  "utf8",
)
const canonicalStockQuantityGateMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260828183828_canonical_stock_quantity_gate_v1.sql", import.meta.url),
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
const RESERVED_SKU = "IMNOVA11111111111141118111111111111111"
const snapshotModule = await importTypeScript(snapshotSource)
const prewriteRetirementModule = await importTypeScript(
  prewriteRetirementSource,
)

process.env.EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET = SNAPSHOT_SECRET

test("only a superseded, provably pre-write SKU preflight can be retired", () => {
  const now = Date.parse("2026-07-23T12:30:00.000Z")
  const execution = {
    phase: "claimed",
    last_error_code: "EBAY_SKU_PREFLIGHT_UNAVAILABLE",
    inventory_http_status: null,
    inventory_confirmed_at: null,
    offer_create_started_at: null,
    offer_http_status: null,
    offer_id: null,
    completed_at: null,
    lease_expires_at: null,
    sanitized_result: {
      collision: false,
      inventoryOwnershipVerified: false,
    },
  }
  const approval = { status: "SUPERSEDED_BY_RECONCILIATION" }
  assert.equal(
    prewriteRetirementModule.canRetireSupersededSkuPreflight(
      execution,
      approval,
      now,
    ),
    true,
  )
  for (const unsafeExecution of [
    { ...execution, phase: "inventory_confirmed" },
    { ...execution, inventory_http_status: 200 },
    { ...execution, inventory_confirmed_at: "2026-07-23T12:00:00.000Z" },
    { ...execution, offer_create_started_at: "2026-07-23T12:00:00.000Z" },
    { ...execution, offer_http_status: 201 },
    { ...execution, offer_id: "offer-1" },
    { ...execution, completed_at: "2026-07-23T12:00:00.000Z" },
    { ...execution, lease_expires_at: "2026-07-23T12:31:00.000Z" },
    {
      ...execution,
      sanitized_result: {
        collision: true,
        inventoryOwnershipVerified: false,
      },
    },
  ]) {
    assert.equal(
      prewriteRetirementModule.canRetireSupersededSkuPreflight(
        unsafeExecution,
        approval,
        now,
      ),
      false,
    )
  }
  assert.equal(
    prewriteRetirementModule.canRetireSupersededSkuPreflight(
      execution,
      { status: "approved" },
      now,
    ),
    false,
  )
})

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

test("exact durable Smart Stocking authorization replaces only the legacy candidate state machine", async () => {
  const module = await importTypeScript(readinessSource)
  const input = validInput()
  input.opportunity.hard_gates = ["LEGACY_RESEARCH_GATE"]
  input.opportunity.evidence_guards = ["LEGACY_SCORING_GUARD"]
  input.opportunity.supplier_product_id = "9220837146848"
  input.opportunity.supplier_variant_id = "48809648488672"
  input.opportunity.supplier_sku = "ITEM3404"
  input.opportunity.gtin = "740145348659"
  input.opportunity.supplier_inventory_quantity = null
  input.opportunity.assessment.identity.exactIdentityConfirmed = false
  input.opportunity.assessment.scores = {
    potentialScore: 55,
    confidenceScore: 0,
  }
  input.smartStockingPublicationAuthorization = {
    validated: true,
    version: "SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1",
    listingPackageId: input.listingPackage.id,
    opportunityId: input.opportunity.id,
    candidateKey: input.listingPackage.candidate_key,
    workspaceEvidenceAuthorityClass:
      "SELLER_OS_WINDOW_FILM_FINAL_WORKSPACE_EVIDENCE_V1",
    productTruthDigest: `sha256:${"d".repeat(64)}`,
    frontierId: `profitability-frontier-v1:sha256:${"e".repeat(64)}`,
    frontierDigest: `sha256:${"f".repeat(64)}`,
    frontierSnapshotDigest: `sha256:${"1".repeat(64)}`,
    entrySnapshotHash: `sha256:${"a".repeat(64)}`,
    decisionSnapshotHash: `sha256:${"b".repeat(64)}`,
    authorizationDigest: `sha256:${"c".repeat(64)}`,
    lunaProductId: "9220837146848",
    lunaVariantId: "48809648488672",
    supplierSku: "ITEM3404",
    gtin: "740145348659",
    stockState: "IN_STOCK_SUPPLIER_STATED",
    supplierInventoryQuantity: null,
    safeCapacity: null,
    finalEconomicsStatus: "PASS",
    thresholdResult: "PASS",
    sourceRevalidationAuthority:
      "SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1",
    finalHumanAuthorizationRequired: true,
    unattendedPublicationAllowed: false,
  }
  const authorized = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(authorized.ready, true)
  assert.equal(input.opportunity.supplier_inventory_quantity, null)
  assert.equal(
    authorized.payload.inventoryItemPayload.availability
      .shipToLocationAvailability.quantity,
    1,
  )
  assert.equal(authorized.payload.offerPayload.availableQuantity, 1)
  assert.deepEqual(
    authorized.payload.compliance.smartStockingPublicationAuthorization,
    input.smartStockingPublicationAuthorization,
  )

  input.smartStockingPublicationAuthorization.supplierSku = "FOREIGN-SKU"
  const forged = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(forged.ready, false)
  assert.ok(forged.blockers.includes("EXACT_IDENTITY_REQUIRED"))
  assert.ok(forged.blockers.includes("POTENTIAL_SCORE_BELOW_70"))
  assert.ok(forged.blockers.includes("LUNA_STOCK_UNAVAILABLE"))
})

test("SUPERSEDED_AUTHORITY_REINTRODUCED: ITEM3404 canonical prewrite stays blocker-free", async () => {
  const module = await importTypeScript(readinessSource)
  const now = new Date("2026-08-28T12:00:00.000Z")
  const input = validInput(now)
  const packageId = "3a394c94-108b-4ca0-b373-5e589dc4a652"
  const imageUrls = Array.from({ length: 4 }, (_, index) =>
    `https://assets.example.test/item3404-${index + 1}.jpg`)
  input.listingPackage = {
    ...input.listingPackage,
    id: packageId,
    candidate_key: "smart-stocking:EBAY_US:9220837146848:48809648488672",
    status: "ready_for_review",
    source_observed_at: now.toISOString(),
    package_data: {
      title: "Window Privacy Film One Way Tint for Home Black",
      categoryId: "175757",
      aspects: { Color: ["Black"], Type: ["Window Film"] },
      description: "Supplier-backed black window privacy film.",
      imageUrls,
      pricing: { targetPrice: 30 },
    },
  }
  input.opportunity = {
    ...input.opportunity,
    candidate_key: input.listingPackage.candidate_key,
    queue_status: "ready",
    hard_gates: [
      "NEED_AUTHORIZED_PRODUCT_IMAGES",
      "NEED_PACKAGE_WEIGHT",
      "NEED_PACKAGE_DIMENSIONS",
      "NEED_EBAY_TAXONOMY_CATEGORY",
      "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
    ],
    evidence_guards: ["LEGACY_SCORING_GUARD"],
    supplier_product_id: "9220837146848",
    supplier_variant_id: "48809648488672",
    supplier_sku: "ITEM3404",
    gtin: "740145348659",
    supplier_available: true,
    supplier_inventory_quantity: 8,
    supplier_price: 7,
    supplier_snapshot_at: now.toISOString(),
    last_scanned_at: now.toISOString(),
  }
  input.draftConfiguration = {
    ...input.draftConfiguration,
    sku: module.expectedEbayDraftOnlySku(input.listingPackage),
    packageWeightAndSize: {
      // 113 exists, but neither its unit nor package LxWxH are authoritative.
      weight: { value: 113, unit: "" },
      dimensions: { length: null, width: null, height: null, unit: "" },
    },
    imageAuthorization: {
      approved: true,
      approvedAt: now.toISOString(),
      approvedImageUrls: imageUrls,
      protectedManifestVerified: true,
      protectedManifestAssetCount: 4,
      rightsBasis: "supplier_authorized",
      source: "luna",
    },
    aspectValidation: {
      validated: true,
      validatedAt: now.toISOString(),
      categoryId: "175757",
      categoryTreeId: "0",
      categoryTreeVersion: "134",
      requiredAspects: ["Color", "Type"],
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
      constraintSnapshotStatus: "AVAILABLE",
      aspectConstraints: [{
        name: "Color",
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        maxLength: 65,
        dataType: "STRING",
        format: null,
        advancedDataType: null,
        valuesComplete: true,
        constraintsComplete: true,
        values: [{ value: "Black", valueConstraints: [] }],
      }, {
        name: "Type",
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        maxLength: 65,
        dataType: "STRING",
        format: null,
        advancedDataType: null,
        valuesComplete: true,
        constraintsComplete: true,
        values: [{ value: "Window Film", valueConstraints: [] }],
      }],
    },
    ebayPreflightSnapshot: signedSnapshot({ now }),
  }
  input.smartStockingPublicationAuthorization = {
    validated: true,
    version: "SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1",
    listingPackageId: packageId,
    opportunityId: input.opportunity.id,
    candidateKey: input.listingPackage.candidate_key,
    workspaceEvidenceAuthorityClass:
      "SELLER_OS_ITEM3404_FINAL_WORKSPACE_EVIDENCE_V1",
    productTruthDigest: `sha256:${"d".repeat(64)}`,
    frontierId: `profitability-frontier-v1:sha256:${"e".repeat(64)}`,
    frontierDigest: `sha256:${"f".repeat(64)}`,
    frontierSnapshotDigest: `sha256:${"1".repeat(64)}`,
    entrySnapshotHash: `sha256:${"a".repeat(64)}`,
    decisionSnapshotHash: `sha256:${"b".repeat(64)}`,
    authorizationDigest: `sha256:${"c".repeat(64)}`,
    lunaProductId: "9220837146848",
    lunaVariantId: "48809648488672",
    supplierSku: "ITEM3404",
    gtin: "740145348659",
    stockState: "IN_STOCK_SUPPLIER_STATED",
    supplierInventoryQuantity: 8,
    safeCapacity: null,
    finalEconomicsStatus: "PASS",
    thresholdResult: "PASS",
    sourceRevalidationAuthority:
      "SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1",
    finalHumanAuthorizationRequired: true,
    unattendedPublicationAllowed: false,
  }
  const result = module.evaluateEbayDraftOnlyReadiness(input)
  const supersededBlockers = new Set([
    "CATEGORY_ASPECTS_NOT_VALIDATED",
    "ASPECT_CONSTRAINTS_UNVERIFIABLE",
    "IMAGE_AUTHORIZATION_REQUIRED",
    "IMAGE_NOT_AUTHORIZED",
    "PACKAGE_DIMENSIONS_REQUIRED",
    "PACKAGE_DIMENSION_UNIT_INVALID",
    "PACKAGE_WEIGHT_UNIT_REQUIRED",
    "EBAY_PREFLIGHT_SNAPSHOT_REQUIRED",
  ])
  assert.deepEqual(
    result.blockers.filter((blocker) => supersededBlockers.has(blocker)),
    [],
    "SUPERSEDED_AUTHORITY_REINTRODUCED",
  )
  assert.equal(result.ready, true)
  assert.deepEqual(result.blockers, [])
  assert.equal("packageWeightAndSize" in result.payload.inventoryItemPayload,
    false)
  assert.ok(result.warnings.includes("OPTIONAL_PACKAGE_MEASUREMENTS_OMITTED"))
  assert.equal(result.payload.inventoryItemPayload.product.imageUrls.length, 4)
  assert.deepEqual(result.payload.inventoryItemPayload.product.aspects, {
    Color: ["Black"], Type: ["Window Film"],
  })
})

test("execution reconstructs the approved server-bound StockGuard contract", () => {
  assert.match(
    routeSource,
    /function configurationFromApprovedPayload\([\s\S]*publishWithStockguardContract: compliance\.publishWithStockguardContract/,
  )
  assert.match(
    routeSource,
    /buildEbayDraftOnlyPayload\([\s\S]*context\.smartStockingPublicationAuthorization/,
  )
})

test("prewrite adapter prefers durable canonical Taxonomy and Final Listing Review authorities", () => {
  assert.match(routeSource, /taxonomySnapshotMatchesContextV1/)
  assert.match(routeSource, /persistedTaxonomyAvailable/)
  assert.match(routeSource, /bindCanonicalPublicationImageSet/)
  assert.match(routeSource, /packageMeasurementsComplete[\s\S]*\? raw\.packageWeightAndSize[\s\S]*: undefined/)
})

test("GET and POST readiness consume the same canonical authority adapter", () => {
  const getSource = routeSource.slice(
    routeSource.indexOf("export async function GET"),
    routeSource.indexOf("export async function POST"),
  )
  const previewSource = routeSource.slice(
    routeSource.indexOf("async function previewDraft"),
    routeSource.indexOf("async function approveDraft"),
  )
  const approveSource = routeSource.slice(
    routeSource.indexOf("async function approveDraft"),
    routeSource.indexOf("async function executeDraft"),
  )
  for (const source of [getSource, previewSource, approveSource]) {
    const finalReviewIndex = source.indexOf(
      "loadFinalListingReviewPublicationGate",
    )
    const taxonomyIndex = source.indexOf("loadLivePackageTaxonomy")
    const canonicalConfigurationIndex = source.indexOf(
      "serverApprovedConfiguration",
    )
    const readinessIndex = source.indexOf("evaluateEbayDraftOnlyReadiness")
    assert.ok(finalReviewIndex >= 0)
    assert.ok(taxonomyIndex > finalReviewIndex)
    assert.ok(canonicalConfigurationIndex > taxonomyIndex)
    assert.ok(readinessIndex > canonicalConfigurationIndex)
  }
  assert.match(getSource,
    /serverApprovedConfiguration\([\s\S]*visualPublicationGate,[\s\S]*liveTaxonomy,[\s\S]*\)[\s\S]*evaluateEbayDraftOnlyReadiness/)
})

test("Smart Stocking canonical images bypass only the legacy merchandising count", () => {
  assert.match(
    smartStockingImageGateMigrationSource,
    /if not v_smart_stocking and \([\s\S]*jsonb_array_length\(v_images\) not in \(6, 7\)/,
  )
  assert.match(
    smartStockingImageGateMigrationSource,
    /assert_ebay_smart_stocking_canonical_images_v1/,
  )
  assert.match(
    smartStockingImageGateMigrationSource,
    /EBAY_AUTHORIZED_PUBLICATION_V3_SEVEN_APPROVED_IMAGES_REQUIRED/,
  )
  assert.match(
    smartStockingImageGateMigrationSource,
    /EBAY_AUTHORIZED_PUBLICATION_SIX_APPROVED_IMAGES_REQUIRED/,
  )
})

test("locked V3 execution evidence supersedes only redundant package and image age", async () => {
  const module = await importTypeScript(readinessSource)
  const now = new Date("2026-07-13T12:00:00.000Z")
  const stale = new Date(now.getTime() - 361 * 60_000).toISOString()
  const input = validInput(now)
  const images = Array.from(
    { length: 7 },
    (_, index) => `https://supplier.example.test/v3-${index}.png`,
  )
  input.listingPackage.source_observed_at = stale
  input.listingPackage.package_data.imageUrls = images
  input.draftConfiguration.imageAuthorization = {
    ...input.draftConfiguration.imageAuthorization,
    approvedAt: stale,
    approvedImageUrls: images,
    protectedManifestVerified: true,
    protectedManifestAssetCount: 7,
  }
  input.sameDayPilotAuthorization = {
    validated: true,
    version: "SELLER_OS_AUTHORIZED_PUBLICATION_V1_2026_07_20",
    runId: "33333333-3333-4333-8333-333333333333",
    candidateId: "44444444-4444-4444-8444-444444444444",
    listingPackageId: input.listingPackage.id,
    sourceObservedAt: now.toISOString(),
    finalHumanAuthorizationRequired: true,
    unattendedPublicationAllowed: false,
  }
  const generic = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(generic.ready, false)
  assert.ok(generic.blockers.includes("PACKAGE_SOURCE_STALE"))
  assert.ok(generic.blockers.includes("IMAGE_AUTHORIZATION_REQUIRED"))

  input.revalidatedExecutionEvidence = {
    freshSameDaySourceVerified: true,
    finalV3ImageTransportVerified: true,
  }
  const verified = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(verified.ready, true)
  assert.equal(verified.payloadHash, generic.payloadHash)

  input.sameDayPilotAuthorization.sourceObservedAt = stale
  const staleSource = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(staleSource.ready, false)
  assert.ok(staleSource.blockers.includes("PACKAGE_SOURCE_STALE"))

  input.sameDayPilotAuthorization.sourceObservedAt = now.toISOString()
  input.draftConfiguration.imageAuthorization.protectedManifestVerified = false
  const unprotectedImages = module.evaluateEbayDraftOnlyReadiness(input)
  assert.equal(unprotectedImages.ready, false)
  assert.ok(unprotectedImages.blockers.includes("IMAGE_AUTHORIZATION_REQUIRED"))
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
  assert.match(routeSource,
    /aspectConstraints: liveTaxonomyAvailable[\s\S]*liveAspectConstraints/)
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

test("readiness omits an incomplete optional package block and still requires image and collision evidence", async () => {
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
  assert.equal(result.blockers.includes("PACKAGE_WEIGHT_UNIT_REQUIRED"), false)
  assert.equal("packageWeightAndSize" in result.payload.inventoryItemPayload,
    false)
  assert.ok(result.warnings.includes("OPTIONAL_PACKAGE_MEASUREMENTS_OMITTED"))
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

test("gateway uses valid-language Sandbox GETs to verify policies, enabled location and SKU before PUT", async () => {
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
    calls.push({
      url: parsed,
      method: init.method,
      body: init.body,
      headers: init.headers ?? {},
    })
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
    const collision = await module.preflightEbayDraftSkuCollision("IMNOVAITEM0000000001", fetchImpl)
    assert.equal(collision.safe, true)
    const inventory = await module.createOrReplaceEbayDraftInventoryItem("IMNOVAITEM0000000001", { product: {} }, fetchImpl)
    const offer = await module.createEbayUnpublishedOffer({ sku: "IMNOVAITEM0000000001" }, fetchImpl)
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
    assert.ok(ebayCalls
      .filter((call) => call.method === "GET")
      .every((call) =>
        Object.keys(call.headers).length === 2
        && typeof call.headers.Authorization === "string"
        && call.headers["Accept-Language"] === "en-US"
        && !("X-EBAY-C-MARKETPLACE-ID" in call.headers)
      ))
    assert.ok(ebayCalls
      .filter((call) => call.method === "PUT" || call.method === "POST")
      .every((call) =>
        call.headers["Content-Type"] === "application/json"
        && call.headers["Content-Language"] === "en-US"
        && call.headers["Accept-Language"] === "en-US"
        && !("X-EBAY-C-MARKETPLACE-ID" in call.headers)
      ))
    assert.deepEqual(
      ebayCalls.filter((call) => call.method === "GET").map((call) => call.url.pathname),
      [
        "/sell/account/v1/privilege",
        "/sell/account/v1/fulfillment_policy/fulfillment_1",
        "/sell/account/v1/payment_policy/payment_1",
        "/sell/account/v1/return_policy/return_1",
        "/sell/inventory/v1/location/LUNA_PORTEX_US",
        "/sell/inventory/v1/inventory_item/IMNOVAITEM0000000001",
        "/sell/inventory/v1/offer",
      ],
    )
  } finally {
    process.env = original
  }
})

test("SKU preflight accepts contracted eBay absence, retries transient reads and classifies rejected requests", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  const runCase = async (
    name,
    offerResponses,
    inventoryResponse = { status: 404, body: { errors: [] } },
  ) => {
    Object.assign(process.env, {
      EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
      EBAY_DRAFT_ONLY_TARGET: "SANDBOX",
      EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID: `client-${name}`,
      EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET: `secret-${name}`,
      EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN: `refresh-${name}`,
      EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID: "sandbox-user-1",
      EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
    })
    let offerIndex = 0
    const calls = []
    const result = await module.preflightEbayDraftSkuCollision(
      `IMNOVA${name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}0000000000000000`,
      async (url, init = {}) => {
        const parsed = new URL(url)
        calls.push({ url: parsed, method: init.method })
        if (parsed.pathname.endsWith("/oauth2/token")) {
          return new Response(JSON.stringify({
            access_token: `access-${name}`,
            expires_in: 7200,
          }), { status: 200 })
        }
        if (parsed.pathname === "/commerce/identity/v1/user/") {
          return new Response(JSON.stringify({
            userId: "sandbox-user-1",
            status: "CONFIRMED",
          }), { status: 200 })
        }
        if (parsed.pathname.includes("/inventory_item/")) {
          return new Response(JSON.stringify(inventoryResponse.body), {
            status: inventoryResponse.status,
          })
        }
        if (parsed.pathname.endsWith("/offer")) {
          const response = offerResponses[
            Math.min(offerIndex, offerResponses.length - 1)
          ]
          offerIndex += 1
          return new Response(JSON.stringify(response.body), {
            status: response.status,
          })
        }
        throw new Error("unexpected request")
      },
    )
    return {
      result,
      offerCalls: calls.filter((call) =>
        call.url.pathname.endsWith("/offer")).length,
      sellMethods: calls
        .filter((call) => call.url.pathname.startsWith("/sell/"))
        .map((call) => call.method),
    }
  }
  try {
    const notFound = await runCase("not-found", [{
      status: 404,
      body: {
        errors: [{
          errorId: 25710,
          domain: "API_INVENTORY",
          category: "REQUEST",
          message: "Resource not found.",
        }],
      },
    }])
    assert.equal(notFound.result.safe, true)
    assert.equal(notFound.result.offerCount, 0)
    assert.equal(notFound.result.offersHttpStatus, 404)
    assert.equal(notFound.result.offerResponseShape, "NOT_FOUND")

    const explicitEmpty = await runCase("empty-page", [{
      status: 200,
      body: { href: "/offer", limit: 100, size: 0, total: 0 },
    }])
    assert.equal(explicitEmpty.result.safe, true)
    assert.equal(explicitEmpty.result.offerCount, 0)
    assert.equal(
      explicitEmpty.result.offerResponseShape,
      "EXPLICIT_EMPTY_PAGE",
    )

    const inventoryBadRequestAbsence = await runCase(
      "inventory-absence",
      [{
        status: 200,
        body: { href: "/offer", limit: 100, size: 0, total: 0 },
      }],
      {
        status: 400,
        body: {
          errors: [{
            errorId: 25702,
            domain: "API_INVENTORY",
            category: "REQUEST",
            message: "SKU could not be found.",
          }],
        },
      },
    )
    assert.equal(inventoryBadRequestAbsence.result.safe, true)
    assert.equal(inventoryBadRequestAbsence.result.inventoryAbsent, true)
    assert.deepEqual(
      inventoryBadRequestAbsence.result.inventoryErrorIds,
      ["25702"],
    )

    const retried = await runCase("transient", [
      {
        status: 503,
        body: {
          errors: [{
            errorId: 2000,
            domain: "API_INVENTORY",
            category: "APPLICATION",
            message: "Temporary service error.",
          }],
        },
      },
      {
        status: 200,
        body: { href: "/offer", limit: 100, size: 0, total: 0 },
      },
    ])
    assert.equal(retried.result.safe, true)
    assert.equal(retried.result.offersReadAttempts, 2)
    assert.equal(retried.offerCalls, 2)

    const ambiguous = await runCase("ambiguous", [{
      status: 200,
      body: { total: 0 },
    }])
    assert.equal(ambiguous.result.safe, false)
    assert.equal(
      ambiguous.result.blocker,
      "EBAY_SKU_PREFLIGHT_UNAVAILABLE",
    )
    assert.equal(ambiguous.result.offerResponseShape, "UNAVAILABLE")

    const rejected = await runCase(
      "request-rejected",
      [{
        status: 400,
        body: {
          errors: [{
            errorId: 25709,
            domain: "API_INVENTORY",
            category: "REQUEST",
            message: "Invalid value for sku.",
          }],
        },
      }],
      {
        status: 400,
        body: {
          errors: [{
            errorId: 25709,
            domain: "API_INVENTORY",
            category: "REQUEST",
            message: "Invalid value for sku.",
          }],
        },
      },
    )
    assert.equal(rejected.result.safe, false)
    assert.equal(rejected.result.requestRejected, true)
    assert.equal(
      rejected.result.blocker,
      "EBAY_SKU_PREFLIGHT_REQUEST_REJECTED",
    )
    assert.deepEqual(rejected.result.inventoryErrorIds, ["25709"])
    assert.deepEqual(rejected.result.offersErrorIds, ["25709"])
    assert.equal(
      rejected.result.inventoryErrors[0].message,
      "Invalid value for sku.",
    )
    assert.ok([
      ...notFound.sellMethods,
      ...explicitEmpty.sellMethods,
      ...inventoryBadRequestAbsence.sellMethods,
      ...retried.sellMethods,
      ...ambiguous.sellMethods,
      ...rejected.sellMethods,
    ].every((method) => method === "GET"))
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
  assert.ok(
    executeSource.indexOf("retireSupersededPrewriteSkuPreflight")
      < executeSource.indexOf("loadPackageContext"),
  )
  assert.match(executeSource, /const terminalPreflight = preflight\.collision/)
  assert.match(executeSource, /phase: terminalPreflight \? "terminal_failure" : "claimed"/)
  assert.match(
    routeSource,
    /EBAY_SKU_PREFLIGHT_SUPERSEDED_BY_REAPPROVAL/,
  )
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
  assert.match(routeSource, /EBAY_V3_EXECUTION_EVIDENCE_INVALID/)
  assert.match(routeSource, /revalidatedExecutionEvidence/)
  assert.match(routeSource, /finalV3ImageTransportVerified:\s*true/)
  assert.match(routeSource, /freshSameDaySourceVerified:\s*true/)
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
  assert.match(workspaceSource, /shouldRenewExpiredSkuPreflight/)
  assert.match(
    workspaceSource,
    /execution\.last_error_code === "EBAY_SKU_PREFLIGHT_UNAVAILABLE"/,
  )
  assert.match(
    workspaceSource,
    /EBAY_SKU_NAMESPACE_MIGRATED_BEFORE_WRITE/,
  )
  assert.match(
    workspaceSource,
    /EBAY_PREFLIGHT_HEADER_CONTRACT_MIGRATED_BEFORE_WRITE/,
  )
  assert.match(
    workspaceSource,
    /const retiredPrewriteExecution = shouldRenewExpiredSkuPreflight/,
  )
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

test("alphanumeric SKU migration supersedes only pre-write legacy authority", () => {
  assert.match(
    alphanumericSkuMigrationSource,
    /EBAY_LEGACY_SKU_WRITE_EVIDENCE_RECONCILIATION_REQUIRED/,
  )
  assert.match(
    alphanumericSkuMigrationSource,
    /EBAY_SKU_NAMESPACE_MIGRATED_BEFORE_WRITE/,
  )
  assert.match(
    alphanumericSkuMigrationSource,
    /\^IMNOVA\[A-Z0-9\]\{16,32\}\$/,
  )
  assert.match(
    alphanumericSkuMigrationSource,
    /SUPERSEDED_BY_RECONCILIATION/,
  )
  assert.match(
    alphanumericSkuMigrationSource,
    /This migration performs no external eBay operation/,
  )
})

test("Inventory header migration retires only the exact pre-write 25709 pair", () => {
  assert.match(
    inventoryHeaderMigrationSource,
    /EBAY_PREFLIGHT_HEADER_RECONCILIATION_WRITE_EVIDENCE_REQUIRED/,
  )
  assert.match(
    inventoryHeaderMigrationSource,
    /EBAY_PREFLIGHT_HEADER_CONTRACT_MIGRATED_BEFORE_WRITE/,
  )
  assert.match(
    inventoryHeaderMigrationSource,
    /inventoryErrorIds[\s\S]*25709/,
  )
  assert.match(
    inventoryHeaderMigrationSource,
    /offersErrorIds[\s\S]*25709/,
  )
  assert.match(
    inventoryHeaderMigrationSource,
    /inventory_http_status is null/,
  )
  assert.match(
    inventoryHeaderMigrationSource,
    /offer_id is null/,
  )
  assert.match(
    inventoryHeaderMigrationSource,
    /This migration performs no[\s\S]*external eBay operation/,
  )
})

test("canonical package SKU is alphanumeric and deterministic", async () => {
  const module = await importTypeScript(readinessSource)
  const sku = module.expectedEbayDraftOnlySku({
    id: "123e4567-e89b-42d3-a456-426614174000",
  })
  assert.equal(sku, "IMNOVA123E4567E89B42D3A456426614174000")
  assert.match(sku, /^[A-Z0-9]+$/)
  assert.equal(sku.length, 38)
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

test("Production identity preserves its verified legacy binding after eBay immutable ID migration", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "false",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "false",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "identity-migration-client",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "identity-migration-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "identity-migration-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "legacy-official-seller",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const calls = []
  try {
    const result = await module.verifyEbayUnpublishedOffer(
      "offer-identity-migration",
      "SKU-IDENTITY-MIGRATION",
      "EBAY_US",
      async (url, init = {}) => {
        const parsed = new URL(url)
        const method = init.method ?? "GET"
        calls.push({ origin: parsed.origin, pathname: parsed.pathname, method })
        if (parsed.pathname.endsWith("/oauth2/token")) {
          return new Response(JSON.stringify({
            access_token: "identity-migration-access",
            expires_in: 7200,
          }), { status: 200 })
        }
        if (parsed.pathname === "/commerce/identity/v1/user/") {
          return new Response(JSON.stringify({
            userId: "immutable-replacement-user-id",
          }), { status: 200 })
        }
        if (parsed.pathname === "/ws/api.dll") {
          return new Response(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
              "<GetUserResponse xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
              "<Ack>Success</Ack><User><UserID>legacy-official-seller</UserID></User>" +
              "</GetUserResponse>",
            { status: 200 },
          )
        }
        if (parsed.pathname === "/sell/inventory/v1/offer/offer-identity-migration") {
          return new Response(JSON.stringify({
            offerId: "offer-identity-migration",
            sku: "SKU-IDENTITY-MIGRATION",
            marketplaceId: "EBAY_US",
            status: "UNPUBLISHED",
          }), { status: 200 })
        }
        throw new Error(`unexpected ${method} ${parsed}`)
      },
    )
    assert.equal(result.safe, true)
    assert.equal(
      calls.filter((call) => call.pathname === "/ws/api.dll").length,
      1,
    )
    assert.ok(calls.every((call) => call.method === "GET" ||
      call.pathname.endsWith("/oauth2/token") ||
      call.pathname === "/ws/api.dll"))
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
    const exact = await module.verifyEbayUnpublishedOffer(
      "offer-123",
      "PROD-SKU-2",
      "EBAY_US",
      expected,
      fetchImpl,
    )
    assert.equal(exact.safe, true)
    assert.equal(exact.payloadMatches, true)
    const changedPrice = structuredClone(expected)
    changedPrice.pricingSummary.price.value = "29.99"
    const exactMismatch = await module.verifyEbayUnpublishedOffer(
      "offer-123",
      "PROD-SKU-2",
      "EBAY_US",
      changedPrice,
      fetchImpl,
    )
    assert.equal(exactMismatch.safe, false)
    assert.equal(exactMismatch.payloadMatches, false)
    assert.equal(exactMismatch.blocker, "EBAY_OFFER_EXACT_PAYLOAD_MISMATCH")
    const mismatch = await module.verifyEbayUnpublishedOffer("offer-123", "WRONG-SKU", "EBAY_US", fetchImpl)
    assert.equal(mismatch.safe, false)
    assert.equal(mismatch.blocker, "EBAY_OFFER_IDENTITY_MISMATCH")
    assert.ok(calls.every((call) => !/publish|bulk_publish/.test(call.url.pathname)))
  } finally {
    process.env = original
  }
})

test("compensated publication recovery accepts only one exact unpublished offer", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/draft-production",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/draft-production",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-client-recovery",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "production-user-1",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
  })
  const offer = {
    offerId: "offer-recovery",
    sku: RESERVED_SKU,
    marketplaceId: "EBAY_US",
    status: "UNPUBLISHED",
  }
  const fetchFor = (offers) => async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access" }), { status: 200 })
    }
    if (parsed.pathname === "/commerce/identity/v1/user/") {
      return new Response(JSON.stringify({ userId: "production-user-1" }), { status: 200 })
    }
    if (parsed.pathname === "/sell/inventory/v1/offer") {
      return new Response(JSON.stringify({ offers }), { status: 200 })
    }
    throw new Error(`unexpected GET ${parsed.pathname}`)
  }
  try {
    const safe = await module.verifyEbayCompensatedOfferRecoveryState(
      offer.offerId, RESERVED_SKU, "366633121948", fetchFor([offer]),
    )
    assert.equal(safe.safe, true)
    assert.equal(safe.offerDiscoveryCount, 1)
    assert.equal(safe.offerHasListing, false)
    assert.equal(safe.associatedListingId, null)
    assert.equal(safe.publishedOfferCount, 0)
    const published = await module.verifyEbayCompensatedOfferRecoveryState(
      offer.offerId, RESERVED_SKU, "366633121948", fetchFor([{
        ...offer, status: "PUBLISHED", listingId: "366633121948",
      }]),
    )
    assert.equal(published.safe, false)
    assert.equal(published.blocker,
      "EBAY_COMPENSATED_PUBLICATION_RECOVERY_ACTIVE_OR_PUBLISHED_OFFER")
    assert.equal(published.offerHasListing, true)
    assert.equal(published.associatedListingId, "366633121948")
    const linked = await module.verifyEbayCompensatedOfferRecoveryState(
      offer.offerId, RESERVED_SKU, "366633121948", fetchFor([{
        ...offer, listingId: "366633121948",
      }]),
    )
    assert.equal(linked.safe, true)
    assert.equal(linked.status, "UNPUBLISHED")
    assert.equal(linked.offerHasListing, true)
    assert.equal(linked.associatedListingId, "366633121948")
    assert.equal(linked.blocker, "")
    const wrongHistoricalListing =
      await module.verifyEbayCompensatedOfferRecoveryState(
        offer.offerId, RESERVED_SKU, "366633121948", fetchFor([{
          ...offer, listingId: "366633121949",
        }]),
      )
    assert.equal(wrongHistoricalListing.safe, false)
    assert.equal(wrongHistoricalListing.blocker,
      "EBAY_COMPENSATED_PUBLICATION_RECOVERY_HISTORICAL_LISTING_MISMATCH")
    const duplicate = await module.verifyEbayCompensatedOfferRecoveryState(
      offer.offerId, RESERVED_SKU, "366633121948", fetchFor([
        offer, { ...offer, offerId: "other-offer" },
      ]),
    )
    assert.equal(duplicate.safe, false)
    assert.equal(duplicate.offerDiscoveryCount, 2)
    assert.equal(duplicate.blocker,
      "EBAY_COMPENSATED_PUBLICATION_RECOVERY_OFFER_AMBIGUOUS")
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
    calls.push({
      pathname: parsed.pathname,
      method,
      headers: init.headers ?? {},
    })
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
    const publishCall = calls.find((call) => call.method === "POST"
      && call.pathname.endsWith("/publish"))
    assert.deepEqual(
      Object.keys(publishCall.headers),
      ["Authorization", "Accept-Language"],
    )
    assert.equal(publishCall.headers["Accept-Language"], "en-US")
  } finally {
    process.env = original
  }
})

test("exact Inventory or Offer mismatch stops before publishOffer", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: "production-client-exact-readback",
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: "production-secret",
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: "production-refresh",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "production-user-1",
    EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET: SNAPSHOT_SECRET,
    EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/draft-production",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/draft-production",
    EBAY_PRO_RUNTIME: "staging",
  })
  const inventory = {
    condition: "NEW",
    availability: { shipToLocationAvailability: { quantity: 1 } },
    product: {
      title: "Exact product",
      aspects: { Brand: ["Unbranded"], Type: ["Window Film"] },
      imageUrls: ["https://assets.example.test/product.jpg"],
    },
  }
  const offer = {
    sku: RESERVED_SKU,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: "175757",
    merchantLocationKey: "WAREHOUSE_1",
    listingPolicies: {
      fulfillmentPolicyId: "f1",
      paymentPolicyId: "p1",
      returnPolicyId: "r1",
    },
    pricingSummary: { price: { value: "24.99", currency: "USD" } },
  }
  async function run({ inventoryBody = inventory, offerBody = offer } = {}) {
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
      if (parsed.pathname.includes("/inventory_item/") && method === "GET") {
        return new Response(JSON.stringify(inventoryBody), { status: 200 })
      }
      if (parsed.pathname === "/sell/inventory/v1/offer/offer-exact" && method === "GET") {
        return new Response(JSON.stringify({
          ...offerBody,
          offerId: "offer-exact",
          status: "UNPUBLISHED",
        }), { status: 200 })
      }
      if (method === "POST" && parsed.pathname.endsWith("/publish")) {
        return new Response(JSON.stringify({ listingId: "123456789012" }), { status: 200 })
      }
      throw new Error(`unexpected ${method} ${parsed.pathname}`)
    }
    const result = await module.publishEbayOfferOnce({
      offerId: "offer-exact",
      expectedSku: RESERVED_SKU,
      expectedInventoryItemPayload: inventory,
      expectedOfferPayload: offer,
      previewHash: "d".repeat(64),
      publicationControlId: "77777777-7777-4777-8777-777777777777",
      confirmPublish: "PUBLICAR LISTING EN EBAY",
    }, fetchImpl)
    return { result, calls }
  }
  try {
    const inventoryMismatch = await run({
      inventoryBody: { ...inventory, condition: "USED_GOOD" },
    })
    assert.equal(inventoryMismatch.result.ok, false)
    assert.equal(inventoryMismatch.result.publishRequestSent, false)
    assert.equal(inventoryMismatch.result.blocker,
      "EBAY_FINAL_PUBLICATION_INVENTORY_EXACT_READBACK_MISMATCH")
    assert.equal(inventoryMismatch.calls.some((call) =>
      call.method === "POST" && call.pathname.endsWith("/publish")), false)

    const offerMismatch = await run({
      offerBody: {
        ...offer,
        pricingSummary: { price: { value: "29.99", currency: "USD" } },
      },
    })
    assert.equal(offerMismatch.result.ok, false)
    assert.equal(offerMismatch.result.publishRequestSent, false)
    assert.equal(offerMismatch.result.blocker,
      "EBAY_OFFER_EXACT_PAYLOAD_MISMATCH")
    assert.equal(offerMismatch.calls.some((call) =>
      call.method === "POST" && call.pathname.endsWith("/publish")), false)

    const publishedFetch = async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith("/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "access" }), { status: 200 })
      }
      if (parsed.pathname === "/commerce/identity/v1/user/") {
        return new Response(JSON.stringify({ userId: "production-user-1", status: "CONFIRMED" }), { status: 200 })
      }
      if (parsed.pathname === "/sell/inventory/v1/offer/offer-exact") {
        return new Response(JSON.stringify({
          ...offer,
          offerId: "offer-exact",
          status: "PUBLISHED",
          listing: { listingId: "123456789012" },
        }), { status: 200 })
      }
      throw new Error(`unexpected GET ${parsed.pathname}`)
    }
    const activeExact = await module.verifyEbayPublishedOffer(
      "offer-exact",
      RESERVED_SKU,
      offer,
      publishedFetch,
    )
    assert.equal(activeExact.safe, true)
    assert.equal(activeExact.payloadMatches, true)
    const activeExpectedMismatch = structuredClone(offer)
    activeExpectedMismatch.categoryId = "999999"
    const activeMismatch = await module.verifyEbayPublishedOffer(
      "offer-exact",
      RESERVED_SKU,
      activeExpectedMismatch,
      publishedFetch,
    )
    assert.equal(activeMismatch.safe, false)
    assert.equal(activeMismatch.payloadMatches, false)
    assert.equal(activeMismatch.blocker,
      "EBAY_PUBLISHED_OFFER_EXACT_PAYLOAD_MISMATCH")
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
  assert.match(routeSource, /EBAY_FINAL_PUBLICATION_SOURCE_BINDING_REQUIRED/)
  assert.match(routeSource,
    /EBAY_FINAL_PUBLICATION_SMART_STOCKING_BINDING_CHANGED/)
  assert.match(sameDayPublicationSource, /SELLER_OS_AUTHORIZED_PUBLICATION_V1_2026_07_20/)
  assert.match(sameDayPublicationSource, /exactSevenHttpsUrls/)
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

test("canonical stock quantity gate admits fresh supplier-stated unknown quantity only", () => {
  const gateBlocks = ({ quantity, canonicalStockAuthorized }) =>
    quantity === null ? !canonicalStockAuthorized : quantity < 1

  assert.equal(gateBlocks({
    quantity: null,
    canonicalStockAuthorized: true,
  }), false, "fresh supplier-stated stock with unknown quantity must pass")
  assert.equal(gateBlocks({
    quantity: 0,
    canonicalStockAuthorized: true,
  }), true, "explicit authoritative zero must block")
  for (const canonicalStockFailure of [
    "CERTIFIED_OOS",
    "STALE",
    "UNKNOWN",
    "ERROR",
  ]) {
    assert.equal(gateBlocks({
      quantity: null,
      canonicalStockAuthorized: false,
    }), true, canonicalStockFailure)
  }

  assert.match(canonicalStockQuantityGateMigrationSource,
    /execute replace\(v_definition, v_legacy_gate, v_canonical_gate\)/)
  assert.match(canonicalStockQuantityGateMigrationSource,
    /supplier_inventory_quantity is null[\s\S]*not public\.is_ebay_smart_stocking_authorized_publication_v1/)
  assert.match(canonicalStockQuantityGateMigrationSource,
    /supplier_inventory_quantity is not null[\s\S]*supplier_inventory_quantity < 1/)
  assert.match(canonicalStockQuantityGateMigrationSource,
    /coalesce\(v_opportunity\.supplier_inventory_quantity, 0\) < 1/)
  assert.match(canonicalStockQuantityGateMigrationSource,
    /strpos\(v_definition,[\s\S]*coalesce\(v_opportunity\.supplier_inventory_quantity, 0\) < 1'[\s\S]*> 0/)
  assert.doesNotMatch(canonicalStockQuantityGateMigrationSource,
    /\b(?:create table|alter table|drop table|truncate table)\b/i)
  assert.doesNotMatch(canonicalStockQuantityGateMigrationSource,
    /createOrReplaceInventoryItem|createOffer|publishOffer\s*\(/)
})

test("V3 final publication persists the exact seven-image authority and preserves legacy six", () => {
  assert.match(
    v3PublicationPreviewMigrationSource,
    /jsonb_array_length\(v_images\) not in \(6, 7\)/,
  )
  assert.match(
    v3PublicationPreviewMigrationSource,
    /EBAY_AUTHORIZED_PUBLICATION_V3_SEVEN_APPROVED_IMAGES_REQUIRED/,
  )
  assert.match(
    v3PublicationPreviewMigrationSource,
    /v3FinalSetAuthorization,selectedAssets/,
  )
  assert.match(
    v3PublicationPreviewMigrationSource,
    /v_images is distinct from[\s\S]*jsonb_agg\([\s\S]*asset->'url'/,
  )
  assert.match(
    v3PublicationPreviewMigrationSource,
    /EBAY_AUTHORIZED_PUBLICATION_SIX_APPROVED_IMAGES_REQUIRED/,
  )
  assert.match(
    routeSource,
    /databaseExceptionCode\([\s\S]*EBAY_FINAL_PUBLICATION_PREVIEW_PERSIST_FAILED/,
  )
  assert.match(workspaceSource, /siete imágenes V3/)
})

test("V3 final publication claim validates the append-only seven-image chain", () => {
  assert.match(
    v3PublicationClaimMigrationSource,
    /assert_ebay_authorized_publication_image_set_high_quality/,
  )
  assert.match(
    v3PublicationClaimMigrationSource,
    /v_transport\.assets is distinct from v_assets/,
  )
  assert.match(
    v3PublicationClaimMigrationSource,
    /v_final\.selected_assets is distinct from v_review_assets/,
  )
  assert.match(
    v3PublicationClaimMigrationSource,
    /object\.metadata->>'size' = asset->>'bytes'/,
  )
  assert.match(
    v3PublicationClaimMigrationSource,
    /perform public\.assert_ebay_publish_image_set_high_quality/,
  )
  assert.match(
    routeSource,
    /databaseExceptionCode\([\s\S]*EBAY_FINAL_PUBLICATION_CLAIM_FAILED/,
  )
  assert.match(
    routeSource,
    /revalidateFinalPublicationSource[\s\S]*sync_ebay_v3_source_before_authorized_publication/,
  )
  assert.match(
    routeSource,
    /verifyEbayUnpublishedOffer\([\s\S]*revalidateFinalPublicationSource\([\s\S]*prepare_ebay_authorized_listing_publication[\s\S]*claim_ebay_authorized_listing_publication/,
  )
  assert.match(
    routeSource,
    /EBAY_FINAL_PUBLICATION_PREVIEW_REFRESH_FAILED/,
  )
})

test("published ACTIVE monitor closure uses schema-qualified pgcrypto", () => {
  assert.match(
    finalMonitorClosureMigrationSource,
    /extensions\.digest/,
  )
  assert.match(
    finalMonitorClosureMigrationSource,
    /complete_ebay_authorized_listing_monitor_registration/,
  )
  assert.match(
    finalMonitorClosureMigrationSource,
    /never calls eBay/,
  )
  assert.match(
    routeSource,
    /databaseExceptionCode\([\s\S]*EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED/,
  )
  assert.match(
    routeSource,
    /if \(publication\.phase === "monitor_registered"\)[\s\S]*loadFinalListingReviewPublicationGate/,
  )
})

test("Smart Stocking monitor closure and compensated recovery stay fail closed", () => {
  assert.match(smartStockingMonitorMigrationSource,
    /is_ebay_smart_stocking_authorized_publication_v1/)
  assert.match(smartStockingMonitorMigrationSource,
    /EBAY_AUTHORIZED_PUBLICATION_ACTIVE_EVIDENCE_REQUIRED/)
  assert.match(smartStockingMonitorMigrationSource,
    /EBAY_AUTHORIZED_PUBLICATION_PILOT_CANDIDATE_REQUIRED/)
  assert.match(compensatedPublicationRecoveryMigrationSource,
    /compensatingEndVerified.*'true'/s)
  assert.match(compensatedPublicationRecoveryMigrationSource,
    /listing_status = 'ended'/)
  assert.match(compensatedPublicationRecoveryMigrationSource,
    /EBAY_COMPENSATED_PUBLICATION_ACTIVE_DUPLICATE/)
  assert.match(compensatedPublicationRecoveryMigrationSource,
    /publish_recovery_count = 1/)
  assert.match(compensatedPublicationRecoveryMigrationSource,
    /sanitized_result = sanitized_result \|\| jsonb_build_object/)
  assert.match(compensatedPublicationRecoveryMigrationSource,
    /MANUAL_LISTING_COMPENSATED_RELINK_FAILED/)
  assert.match(routeSource, /verifyEbayCompensatedOfferRecoveryState/)
  assert.match(routeSource,
    /readCompensatedPublicationFreshSafety\(\{/)
  assert.match(routeSource,
    /SAFE_TO_REARM_EXISTING_GOLDEN_PATH/)
  assert.match(routeSource,
    /rearm_ebay_authorized_listing_after_compensated_monitor_failure/)
})
