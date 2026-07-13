import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const readinessSource = readFileSync(
  new URL("../lib/ebay/ebay-draft-only-readiness.ts", import.meta.url),
  "utf8",
)
const gatewaySource = readFileSync(
  new URL("../lib/ebay/ebay-draft-only-gateway.ts", import.meta.url),
  "utf8",
)
const routeSource = readFileSync(
  new URL("../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
  "utf8",
)
const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260713050000_create_ebay_draft_only_control_plane.sql", import.meta.url),
  "utf8",
)

async function importTypeScript(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`)
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
        pricing: { targetPrice: 25, estimatedNetProfit: 6 },
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
      sku: "IMNOVA-ITEM-1",
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
        requiredAspects: ["Brand"],
      },
      skuCollisionCheck: { sku: "IMNOVA-ITEM-1", serverPreflightRequiredAtExecution: true },
    },
    activeSkuCollision: false,
    ledgerSkuCollision: false,
  }
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

test("gateway uses a separate write token, SANDBOX, collision GETs and only two write operations", async () => {
  const module = await importTypeScript(gatewaySource)
  const original = { ...process.env }
  Object.assign(process.env, {
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
    EBAY_DRAFT_ONLY_TARGET: "SANDBOX",
    EBAY_DRAFT_ONLY_CLIENT_ID: "client",
    EBAY_DRAFT_ONLY_CLIENT_SECRET: "secret",
    EBAY_DRAFT_ONLY_REFRESH_TOKEN: "separate-write-refresh-token",
  })
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ url: parsed, method: init.method, body: init.body })
    if (parsed.pathname.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access", expires_in: 7200 }), { status: 200 })
    }
    if (init.method === "GET" && parsed.pathname.includes("/inventory_item/")) return new Response("{}", { status: 404 })
    if (init.method === "GET" && parsed.pathname.endsWith("/offer")) return new Response(JSON.stringify({ offers: [] }), { status: 200 })
    if (init.method === "PUT") return new Response(null, { status: 204 })
    if (init.method === "POST" && parsed.pathname.endsWith("/offer")) return new Response(JSON.stringify({ offerId: "123456" }), { status: 201 })
    throw new Error("unexpected request")
  }
  try {
    const preflight = await module.preflightEbayDraftSkuCollision("IMNOVA-ITEM-1", fetchImpl)
    assert.equal(preflight.safe, true)
    const inventory = await module.createOrReplaceEbayDraftInventoryItem("IMNOVA-ITEM-1", { product: {} }, fetchImpl)
    const offer = await module.createEbayUnpublishedOffer({ sku: "IMNOVA-ITEM-1" }, fetchImpl)
    assert.equal(inventory.ok, true)
    assert.equal(offer.ok, true)
    const ebayCalls = calls.filter((call) => call.url.pathname.startsWith("/sell/inventory/"))
    assert.deepEqual(ebayCalls.map((call) => call.method), ["GET", "GET", "PUT", "POST"])
    assert.ok(ebayCalls.every((call) => call.url.origin === "https://api.sandbox.ebay.com"))
    assert.ok(ebayCalls.every((call) => !call.url.pathname.includes("publish_offer")))
  } finally {
    process.env = original
  }
})

test("route requires a human Admin, exact approval, fresh revalidation and unknown-offer quarantine", () => {
  assert.match(routeSource, /validateAdminApiRequest/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_HUMAN_ADMIN_REQUIRED/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_APPROVAL_PHRASE/)
  assert.match(routeSource, /confirmUnpublishedOnly/)
  assert.match(routeSource, /confirmNoPublish/)
  assert.match(routeSource, /evaluateEbayDraftOnlyReadiness/)
  assert.match(routeSource, /APPROVED_PAYLOAD_CHANGED/)
  assert.match(routeSource, /preflightEbayDraftSkuCollision/)
  assert.match(routeSource, /serverApprovedConfiguration/)
  assert.match(routeSource, /p_claim_token: randomUUID\(\)/)
  assert.match(routeSource, /offer_create_in_flight/)
  assert.match(routeSource, /offer_outcome_unknown/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_JSON_INVALID/)
  assert.match(routeSource, /action === "revoke"/)
  assert.match(routeSource, /EBAY_DRAFT_ONLY_APPROVAL_NOT_REVOCABLE/)
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
