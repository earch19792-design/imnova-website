import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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
  collectLunaQuickPickInputsV1,
  isRehydratableQuickPickOperationV1,
  normalizeLunaQuickPickUrlsV1,
  readLunaQuickPickProgressV1,
  resolveLunaQuickPickInputV1,
} = await import("./ebay-luna-quick-pick-v1.ts")

const url = "https://www.lunaportex.com/products/test-product"

function row(variantId, sku, available = true) {
  return {
    product_id: "100",
    supplier_product_id: "100",
    supplier_variant_id: variantId,
    sku,
    title: "Exact test product",
    variant_title: `Variant ${variantId}`,
    product_type: "home kitchen",
    tags: [], metadata: {}, price: 12.5,
    available, inventory_quantity: available ? 4 : 0,
    product_url: url, image_urls: [], barcode: null,
    captured_at: "2026-08-31T12:00:00.000Z",
  }
}

test("canonicalizes duplicate multiline input and preserves distinct variants", () => {
  assert.deepEqual(normalizeLunaQuickPickUrlsV1(`${url}\n${url}/\n${url}?variant=2`),
    [url, `${url}?variant=2`])
})

test("batch receipt counts raw, canonical unique and rejected inputs separately", () => {
  const collected = collectLunaQuickPickInputsV1([
    url, `${url}/`, `${url}?variant=2`, "https://example.com/not-luna",
  ])
  assert.equal(collected.rawInputCount, 4)
  assert.equal(collected.urls.length, 2)
  assert.equal(collected.invalid.length, 1)
})

test("rejects malformed Luna input at the canonical normalization boundary", () => {
  assert.throws(() => normalizeLunaQuickPickUrlsV1(`${url}\nhttps://example.com/x`),
    /LUNA_QUICK_PICK_URL_INVALID/)
})

test("requires a selector when multiple eligible variants lack exact intent", async () => {
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [row("1", "SKU1"), row("2", "SKU2")] })
  assert.equal(result.selected, null)
  assert.equal(result.blocker, "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED")
  assert.equal(result.variants.length, 2)
})

test("cross-checks an explicit URL variant and never picks the first row", async () => {
  const result = await resolveLunaQuickPickInputV1({
    sourceUrl: `${url}?variant=2`,
    catalogRows: [row("1", "SKU1"), row("2", "SKU2")],
  })
  assert.equal(result.selected?.lunaVariantId, "2")
  assert.equal(result.selected?.supplierSku, "SKU2")
  assert.equal(result.blocker, null)
})

test("auto-selects the sole eligible variant while preserving unavailable choices", async () => {
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [row("1", "SKU1", false), row("2", "SKU2", true)] })
  assert.equal(result.selected?.lunaVariantId, "2")
  assert.equal(result.variants.length, 2)
})

test("preserves canonical available stock when quantity is not explicitly supplied", async () => {
  const exact = row("53002139205856", "FL-NHPF3369737")
  exact.inventory_quantity = null
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [exact] })
  assert.equal(result.selected?.available, true)
})

test("rehydrates marked operations and the bounded legacy market-test lineage", () => {
  const durableFamily = `market-family-v1:sha256:${"a".repeat(64)}`
  const syntheticFamily = `market-family-v1:sha256:${"b".repeat(64)}`
  assert.equal(isRehydratableQuickPickOperationV1({
    assessment: { lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
    } }, durableFamilyIds: new Set([durableFamily]),
  }), true)
  assert.equal(isRehydratableQuickPickOperationV1({ assessment: {
    radarFactoryCandidateV1: { familyId: syntheticFamily },
    radarAutomaticLunaShippingContinuationV1: {
      contractVersion: "RADAR_AUTOMATIC_LUNA_SHIPPING_CONTINUATION_V1",
    },
  }, durableFamilyIds: new Set([durableFamily]) }), true)
  assert.equal(isRehydratableQuickPickOperationV1({ assessment: {
    radarFactoryCandidateV1: { familyId: durableFamily },
    radarAutomaticLunaShippingContinuationV1: {
      contractVersion: "RADAR_AUTOMATIC_LUNA_SHIPPING_CONTINUATION_V1",
    },
  }, durableFamilyIds: new Set([durableFamily]) }), false)
})

class ReadQuery {
  constructor(data) { this.data = data }
  select() { return this }
  eq() { return this }
  in() { return this }
  order() { return this }
  limit() { return Promise.resolve({ data: this.data, error: null }) }
}

test("durable progress projects every Scan Reader blocker at its real stage", async () => {
  const candidateKey = `sha256:${"3".repeat(64)}`
  const queueRow = {
    id: "d348a69b-e44a-4b4d-9215-c8e9a9f39f44",
    candidate_key: candidateKey,
    supplier_product_id: "9220840456416",
    supplier_variant_id: "48809652158688",
    supplier_sku: "Alibaba-ScanReader-DigitalPen-B0CPHN5395",
    product_title: "Scan Reader Pen",
    queue_status: "review",
    decision: "FACTORY_PREPARED",
    updated_at: "2026-09-01T03:14:19.511Z",
    assessment: {
      lunaQuickPickOperationV1: {
        contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
        sourceUrl: `${url}?variant=48809652158688`,
        canonicalUrl: url,
      },
      sellerOsDeterministicFactory: {
        blockers: [
          "MARKETPLACE_CONDITION_NOT_READY",
          "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:MPN|Brand",
        ],
        stageStatuses: {
          DEMAND_READY: "READY", ECONOMICS_READY: "READY",
          PRODUCT_TRUTH_READY: "READY", LISTING_PACKAGE_READY: "READY",
        },
      },
      radarAutomaticLunaShippingContinuationV1: {
        shippingJobStatus: "SHIPPING_EVIDENCE_DURABLE",
      },
      canonicalMarketplaceReadinessV1: {
        conditionReady: false,
        ready: false,
        requiredItemSpecificsCount: 2,
        requiredItemSpecificsSatisfied: 0,
        requiredItemSpecificsReady: false,
        unsupportedRequiredSpecifics: ["MPN", "Brand"],
      },
    },
  }
  const supabase = {
    from(table) {
      if (table === "ebay_luna_opportunity_queue") {
        return new ReadQuery([queueRow])
      }
      if (table === "ebay_listing_packages") return new ReadQuery([])
      if (table === "market_radar_latest_variants") return new ReadQuery([{
        supplier_product_id: queueRow.supplier_product_id,
        supplier_variant_id: queueRow.supplier_variant_id,
        sku: queueRow.supplier_sku,
        product_url: url,
      }])
      throw new Error(`UNEXPECTED_TABLE:${table}`)
    },
    rpc() { return Promise.resolve({ data: { frontiers: [] }, error: null }) },
  }
  const [card] = await readLunaQuickPickProgressV1({
    supabase, candidateKeys: [candidateKey], accountKey: "seller:test",
  })
  assert.equal(card.lastStage, "REQUIRED_SPECIFICS")
  assert.equal(card.stages.REQUIRED_SPECIFICS, "BLOCKED")
  assert.equal(card.stages.MARKETPLACE_READINESS, "BLOCKED")
  assert.deepEqual(card.exactBlockers, [
    "MARKETPLACE_CONDITION_NOT_READY",
    "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:MPN|Brand",
  ])
  assert.equal(card.requiredItemSpecificsCount, 2)
  assert.equal(card.requiredItemSpecificsSatisfied, 0)
  assert.equal(card.requiredItemSpecificsReady, false)
  assert.deepEqual(card.unresolvedRequiredAspects, ["MPN", "Brand"])
  assert.equal(card.conditionReady, false)
})

test("Quick Pick remains a shared-factory feeder with bounded AI and no publish path", async () => {
  const source = await readFile(new URL("./ebay-luna-quick-pick-v1.ts", import.meta.url), "utf8")
  const route = await readFile(new URL("../../app/api/admin/ebay/luna-quick-pick/route.ts",
    import.meta.url), "utf8")
  const page = await readFile(new URL("../../app/admin/ebay/quick-pick/page.tsx",
    import.meta.url), "utf8")
  assert.match(source, /readAlreadyLiveExactLunaIdentitiesV1/)
  assert.ok(source.indexOf("readAlreadyLiveExactLunaIdentitiesV1") <
    source.indexOf("buildRadarRevenueFactoryCandidateBatchV1({\n    radarPayload"))
  assert.match(source, /materializeRadarRevenueFactoryCandidateBatchV1/)
  assert.match(source, /discoverAndPersistSellerOsOnDemandFamilyDemandV1/)
  assert.match(source, /LUNA_QUICK_PICK_DEMAND_DISCOVERY_CONCURRENCY = 2/)
  assert.match(source, /familyBindingCreatedOrReused/)
  assert.doesNotMatch(source,
    /LUNA_QUICK_PICK_COMPATIBLE_FAMILY_DEMAND_UNAVAILABLE/)
  assert.match(source, /requiredSpecificsAiStages: \["TEXT"\]/)
  assert.match(source, /lunaQuickPickOperationV1/)
  assert.match(source, /QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1/)
  assert.match(source, /QUICK_PICK_BATCH_RECEIPT_AND_LIVE_PROGRESS_V1/)
  assert.match(source, /from\("ebay_seller_automation_runs"\)/)
  assert.match(source, /run_kind: "manual_acceleration"/)
  assert.match(source, /lanes: \["quick_pick"\]/)
  assert.match(source, /duplicateOperationCount: 0/)
  assert.match(source, /boundedConcurrency: LUNA_QUICK_PICK_CONCURRENCY/)
  assert.match(source, /EXCLUDED_DUPLICATE_INPUT/)
  assert.match(source, /LUNA_QUICK_PICK_CANONICAL_STOCK_NOT_READY/)
  assert.match(source, /resolutionAttempts\.flatMap/)
  assert.doesNotMatch(route, /publishOffer|createOffer|bulkCreateOffer/)
  assert.match(page, /window\.setInterval\(\(\) => void poll\(\), 2_500\)/)
  assert.match(page, /Recuperando tus Quick Picks guardados/)
  assert.match(page, /Lote recibido/)
  assert.match(page, /No pude cargar el estado del lote · reintentando/)
  assert.match(page, /REQUIRED_SPECIFICS/)
  assert.match(route, /body\.action === "RECEIVE"/)
  assert.match(route, /body\.action === "PROCESS"/)
  assert.match(route, /readLunaQuickPickBatchReceiptsV1/)
  assert.match(page, /En proceso/)
  assert.match(page, /Listos para revisar/)
  assert.match(page, /Esperando worker Luna/)
  assert.match(page, /PUBLICAR EN EBAY/)
  assert.match(page, /listing-workspace\?opportunity=/)
})
