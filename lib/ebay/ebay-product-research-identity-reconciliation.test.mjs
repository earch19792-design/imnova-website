import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  aggregateProductIdentityReconciliation,
  normalizeProductResearchTargetVariantScope,
  productIdentityReconciliationBoundary,
  reconcileProductResearchIdentity,
} from "./ebay-product-research-identity-reconciliation.ts"
import { parseTradingItemIdentityResponse, readEbayTradingItemIdentityReadonly } from "./ebay-trading-item-identity-readonly.ts"

function target(overrides = {}) {
  return {
    id: "luna-variant-1",
    supplierProductId: "luna-product-1",
    supplierVariantId: "luna-variant-1",
    supplierSku: "ITEM3995",
    productName: "Lysol Disinfecting Wipes Lemon",
    officialLinkVerified: true,
    identity: {
      manufacturerBrand: "Lysol",
      gtin: "036000291452",
      productName: "Lysol Disinfecting Wipes Lemon",
      packCount: 3,
      unitCount: 15,
      size: "15 ct",
      scent: "lemon",
      variant: "lemon",
      condition: "new",
    },
    ...overrides,
  }
}

function observation(overrides = {}) {
  return {
    productName: "Lysol Disinfecting Wipes Lemon",
    brand: "Lysol",
    manufacturer: null,
    gtin: "036000291452",
    mpn: null,
    model: null,
    size: "15 ct",
    color: null,
    scent: "lemon",
    variant: "lemon",
    packCount: 3,
    unitCount: 15,
    condition: "new",
    categoryId: "180565",
    ...overrides,
  }
}

test("exact identity and exact offer alone can become confirmed sold exact", () => {
  const result = reconcileProductResearchIdentity({
    observation: observation(), queryTokens: ["lysol", "disinfecting", "wipes", "lemon"],
    targets: [target()],
  })
  assert.equal(result.classification, "EXACT_LUNA_MATCH")
  assert.equal(result.evidenceClass, "CONFIRMED_SOLD_EXACT")
  assert.equal(result.affectsSoldExactCount, true)
  assert.equal(result.affectsPackIntelligence, false)
  assert.equal(result.target?.supplierSku, "ITEM3995")
})

test("related packs and sizes influence strategy without contaminating soldExactCount", () => {
  const differentPack = reconcileProductResearchIdentity({
    observation: observation({ packCount: 6, unitCount: 80, size: "80 ct", gtin: null }),
    queryTokens: ["lysol", "disinfecting", "wipes", "lemon"], targets: [target()],
  })
  assert.equal(differentPack.classification, "SAME_PRODUCT_DIFFERENT_PACK")
  assert.equal(differentPack.evidenceClass, "CONFIRMED_SOLD_RELATED_PACK")
  assert.equal(differentPack.affectsSoldExactCount, false)
  assert.equal(differentPack.affectsPackIntelligence, true)

  const differentSize = reconcileProductResearchIdentity({
    observation: observation({ unitCount: 80, size: "80 ct", gtin: null }),
    queryTokens: ["lysol", "disinfecting", "wipes", "lemon"], targets: [target()],
  })
  assert.equal(differentSize.classification, "SAME_PRODUCT_DIFFERENT_SIZE")
  assert.equal(differentSize.evidenceClass, "CONFIRMED_SOLD_RELATED_SIZE")
})

test("variant and critical identifier conflicts are excluded", () => {
  const variant = reconcileProductResearchIdentity({
    observation: observation({ scent: "lavender", variant: "lavender", gtin: null }),
    queryTokens: ["lysol", "disinfecting", "wipes"], targets: [target()],
  })
  assert.equal(variant.classification, "DIFFERENT_VARIANT")
  assert.equal(variant.evidenceClass, "NON_QUALIFYING")

  const conflicted = reconcileProductResearchIdentity({
    observation: observation({ gtin: "042100005264" }),
    queryTokens: ["lysol", "disinfecting", "wipes"], targets: [target()],
  })
  assert.equal(conflicted.classification, "CONFLICTED")
  assert.equal(conflicted.affectsSoldExactCount, false)
})

test("weak same-pack evidence remains ambiguous and competitor SKU is never required", () => {
  const weak = target({ officialLinkVerified: false,
    supplierSku: "LUNA-SUPPLIER-SKU",
    identity: { ...target().identity, gtin: null, manufacturerBrand: null } })
  const result = reconcileProductResearchIdentity({
    observation: observation({ gtin: null, brand: null }),
    queryTokens: ["lysol", "disinfecting", "wipes", "lemon"], targets: [weak],
  })
  assert.equal(result.classification, "AMBIGUOUS")
  assert.equal(result.target, null)
  assert.equal(JSON.stringify(result).includes("competitorSku"), false)
})

test("planned target scope is deterministic and an explicit empty scope stays empty", () => {
  assert.deepEqual(normalizeProductResearchTargetVariantScope([
    " luna-variant-2 ", "luna-variant-1", "luna-variant-2", null, "",
  ]), ["luna-variant-2", "luna-variant-1"])
  assert.deepEqual(normalizeProductResearchTargetVariantScope([]), [])
  assert.equal(normalizeProductResearchTargetVariantScope(undefined), null)
})

test("GetItem identity parser reads official facts but never competitor Custom Label or SKU", () => {
  const xml = `<?xml version="1.0"?><GetItemResponse><Ack>Success</Ack><Item>
    <ItemID>123456789012</ItemID><Title>Lysol Wipes Lemon</Title>
    <PrimaryCategory><CategoryID>180565</CategoryID></PrimaryCategory>
    <ConditionDisplayName>New</ConditionDisplayName>
    <SKU>COMPETITOR-PRIVATE-LABEL</SKU>
    <ProductListingDetails><UPC>036000291452</UPC></ProductListingDetails>
    <ItemSpecifics>
      <NameValueList><Name>Brand</Name><Value>Lysol</Value></NameValueList>
      <NameValueList><Name>Number in Pack</Name><Value>3</Value></NameValueList>
      <NameValueList><Name>Unit Quantity</Name><Value>15</Value></NameValueList>
      <NameValueList><Name>Scent</Name><Value>Lemon</Value></NameValueList>
    </ItemSpecifics></Item></GetItemResponse>`
  const parsed = parseTradingItemIdentityResponse(xml, "123456789012")
  assert.equal(parsed.brand, "Lysol")
  assert.equal(parsed.packCount, 3)
  assert.equal(parsed.unitCount, 15)
  assert.equal(parsed.ebayWriteUsed, false)
  assert.equal("sku" in parsed, false)
  assert.doesNotMatch(JSON.stringify(parsed), /COMPETITOR-PRIVATE-LABEL/)
})

test("Trading fallback verifies official account identity and performs GetUser/GetItem reads only", async () => {
  const original = { ...process.env }
  process.env.EBAY_CLIENT_ID = "configured-client"
  process.env.EBAY_CLIENT_SECRET = "configured-secret"
  process.env.EBAY_SELLER_REFRESH_TOKEN = "configured-readonly-refresh"
  process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT =
    createHash("sha256").update("PRODUCTION:official-seller").digest("hex")
  const calls = []
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: String(init.body ?? "") })
    if (String(url).includes("oauth2/token")) return new Response(JSON.stringify({
      access_token: "ephemeral-access-token", expires_in: 7200,
    }), { status: 200, headers: { "Content-Type": "application/json" } })
    if (init.headers["X-EBAY-API-CALL-NAME"] === "GetUser") {
      return new Response("<GetUserResponse><Ack>Success</Ack><User><UserID>official-seller</UserID></User></GetUserResponse>", { status: 200 })
    }
    return new Response("<GetItemResponse><Ack>Success</Ack><Item><ItemID>123456789012</ItemID><Title>Lysol Wipes</Title><ItemSpecifics><NameValueList><Name>Brand</Name><Value>Lysol</Value></NameValueList></ItemSpecifics></Item></GetItemResponse>", { status: 200 })
  }
  try {
    const result = await readEbayTradingItemIdentityReadonly("123456789012", fakeFetch)
    assert.equal(result.brand, "Lysol")
    assert.equal(calls.length, 3)
    assert.deepEqual(calls.map((call) => call.method), ["POST", "POST", "POST"])
    assert.match(calls[1].body, /GetUserRequest/)
    assert.match(calls[2].body, /GetItemRequest/)
    assert.doesNotMatch(calls[2].body, /Item\.SKU|CustomLabel/)
  } finally {
    process.env = original
  }
})

test("aggregates preserve exact, related and non-qualifying cohorts", () => {
  assert.deepEqual(aggregateProductIdentityReconciliation([
    { classification: "EXACT_LUNA_MATCH", supplierVariantId: "a" },
    { classification: "SAME_PRODUCT_DIFFERENT_PACK", supplierVariantId: "a" },
    { classification: "SAME_PRODUCT_DIFFERENT_SIZE", supplierVariantId: "a" },
    { classification: "DIFFERENT_VARIANT", supplierVariantId: "b" },
    { classification: "AMBIGUOUS", supplierVariantId: null },
    { classification: "NO_LUNA_MATCH", supplierVariantId: null },
    { classification: "CONFLICTED", supplierVariantId: "c" },
  ]), { reconciled: 7, exact: 1, differentPack: 1, differentSize: 1,
    differentVariant: 1, ambiguous: 1, withoutLunaMatch: 1, conflicted: 1,
    candidatesEnriched: 3 })
})

test("Preview/staging/branch is a hard boundary", () => {
  assert.deepEqual(productIdentityReconciliationBoundary({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-command-center",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
  }), { preview: true, staging: true, branchMatch: true, productionBlocked: true,
    openAiCalls: 0, ebayWrites: 0 })
  assert.equal(productIdentityReconciliationBoundary({ VERCEL_ENV: "production" }).preview, false)
})

test("migration is additive, append-only, RLS protected and preserves original observations", () => {
  const migration = readFileSync(
    "supabase/migrations/20260717023000_create_product_identity_reconciliation_events.sql", "utf8",
  )
  assert.doesNotMatch(migration, /drop\s+table|drop\s+constraint|delete\s+from|truncate/i)
  assert.match(migration, /marketplace_product_identity_reconciliation_events/)
  assert.match(migration, /before update or delete/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /grant select, insert[^;]+service_role/)
  assert.doesNotMatch(migration, /grant[^;]+update|grant[^;]+delete/i)
  assert.match(migration, /raw_competitor_content_stored boolean not null default false/)
  assert.match(migration, /pii_stored boolean not null default false/)
})

test("integration is read-only, selective and exposes only sanitized aggregates", () => {
  const engine = readFileSync("lib/ebay/ebay-product-research-identity-reconciliation.ts", "utf8")
  const route = readFileSync(
    "app/api/admin/ebay/listing-ai/product-research-reconciliation/route.ts", "utf8",
  )
  const captureRoute = readFileSync(
    "app/api/admin/ebay/listing-ai/product-research-capture/route.ts", "utf8",
  )
  const ui = readFileSync("app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx", "utf8")
  assert.match(engine, /EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE[\s\S]+EBAY_TRADING_GET_ITEM_READONLY[\s\S]+EBAY_BROWSE_OFFICIAL_READONLY[\s\S]+EBAY_CATALOG_OFFICIAL_READONLY[\s\S]+EBAY_TAXONOMY_OFFICIAL_READONLY/)
  assert.match(engine, /status: "PRESELECTED"/)
  assert.match(engine, /discoveryRepeated: false/)
  assert.match(engine, /targetSupplierVariantIds\?: string\[\]/)
  assert.match(engine, /catalogQuery = catalogQuery\.in\("supplier_variant_id", targetScope\)/)
  assert.match(engine, /linksQuery = linksQuery\.in\("supplier_variant_id", targetScope\)/)
  assert.match(engine, /sharedEvidenceByBatch = new Map<string, Promise<SharedOfficialEvidence>>/)
  assert.match(engine, /plannedTokens[\s\S]+batchTokens\.get\(observation\.capture_batch_id\)/)
  assert.match(engine, /maximumTradingReadsPerBatch = Math\.max\(0, Math\.min\(2,/)
  assert.match(engine, /officialCallBudget:[\s\S]+sharedQueryReadsPerBatch: true/)
  assert.match(captureRoute, /reconcileProductResearchObservations/)
  assert.match(ui, /Reconciliación automática de identidad/)
  assert.match(ui, /Custom Label o SKU de competidores nunca se compara/)
  assert.match(route, /openAiCalls: 0, ebayWrites: 0/)
  assert.doesNotMatch(`${engine}\n${route}`, /publishOffer|createOffer|shipping_fulfillment/)
  assert.doesNotMatch(`${engine}\n${route}`, /buyerEmail|buyerPhone|shippingAddress/)
})
