import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  detectProductResearchOfferFacts,
  isProductResearchNinetyDayWindow,
  parseProductResearchBrowserCapture,
  productResearchCapturePersistenceError,
  productResearchCapturePersistenceRows,
  targetFromVerifiedActiveListingLink,
} from "./ebay-product-research-browser-capture.ts"
import {
  buildProductResearchQueryPlan,
  productResearchDisplayQuery,
  productResearchPlannedQueryHash,
  productResearchQueriesMatch,
} from "./ebay-product-research-query-plan.ts"
import {
  buildVisualMarketBriefs,
  sanitizeProductResearchVisualPattern,
} from "./ebay-product-research-visual-pattern.ts"
import { parseEbayApplicationBrowseQuota } from "./ebay-application-rate-limit.ts"
import { buildSameDayProductResearchQuery } from "./ebay-same-day-pilot-domain.ts"

test("same-day capture recognizes the official 90-day window by label or exact range", () => {
  assert.equal(isProductResearchNinetyDayWindow({ label: "Last 90 days" }), true)
  assert.equal(isProductResearchNinetyDayWindow({ label: "Últimos 90 días" }), true)
  assert.equal(isProductResearchNinetyDayWindow({
    start: "1776676668766",
    end: "1784452668766",
  }), true)
  assert.equal(isProductResearchNinetyDayWindow({ label: "Last 30 days" }), false)
  const route = readFileSync(
    "app/api/admin/ebay/listing-ai/product-research-capture/route.ts",
    "utf8",
  )
  assert.match(route, /PRODUCT_RESEARCH_LAST_90_DAYS_REQUIRED/)
})

function storedZipEntries(archive) {
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8)
    const compressedSize = archive.readUInt32LE(offset + 18)
    const uncompressedSize = archive.readUInt32LE(offset + 22)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    assert.equal(method, 0, "extension archive entries must remain inspectable and uncompressed")
    assert.equal(compressedSize, uncompressedSize)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8")
    entries.set(name, archive.subarray(dataStart, dataStart + uncompressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

const target = {
  id: "queue-pilot",
  queueItemId: "queue-pilot",
  supplierVariantId: "luna-item3995",
  productName: "Lysol Disinfecting Wipes Lemon",
  identity: {
    manufacturerBrand: "Lysol",
    gtin: "012345678905",
    productName: "Lysol Disinfecting Wipes Lemon",
    packCount: 3,
    unitCount: 15,
    size: "15 ct",
    scent: "lemon",
    variant: "lemon",
    condition: "new",
  },
}

function row(overrides = {}) {
  return {
    temporaryTitle: "Lysol Disinfecting Wipes Lemon 3 x 15 ct",
    listingId: "366543596425",
    averageSoldPrice: 19.98,
    averageShipping: 0,
    totalSold: 8,
    itemSales: 159.84,
    lastSoldDate: "2026-07-16",
    listingFormat: "Fixed Price",
    freeShippingPercent: 100,
    bids: 0,
    visibleImageCount: 1,
    detectedOfferPackCount: 3,
    detectedUnitCount: 15,
    detectedSize: "15 ct",
    detectedVariant: "lemon",
    ...overrides,
  }
}

function capture(rows = [row()], overrides = {}) {
  return {
    source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
    captureId: "1f537cd5-b302-47bc-8491-2c9a63bb7777",
    listingSite: "www.ebay.com",
    pagePath: "/sh/research",
    searchQuery: "Lysol disinfecting wipes",
    dateRange: { label: "Last 30 days" },
    capturedAt: new Date().toISOString(),
    visibleResultCount: rows.length,
    visibleColumns: ["Title", "Average sold price", "Average shipping", "Total sold", "Last sold date"],
    rows,
    ...overrides,
  }
}

function visualPattern(overrides = {}) {
  return {
    imagePresent: true,
    thumbnailAspectRatio: 1,
    thumbnailResolutionBucket: "MEDIUM",
    backgroundType: "WHITE_OR_NEUTRAL",
    backgroundConfidence: "MEDIUM",
    frameCoverage: "HIGH",
    visualComplexity: "LOW",
    textOverlayLikelihood: "NONE",
    badgeOrCalloutLikelihood: "UNKNOWN",
    presentationType: "PRODUCT_ONLY",
    productCountVisible: null,
    packClarity: "UNKNOWN",
    dominantComposition: "CENTERED",
    visualPatternConfidence: "MEDIUM",
    analysisStatus: "ANALYZED",
    algorithmVersion: "PR_VISIBLE_THUMBNAIL_LOCAL_V1",
    analyzedAt: new Date().toISOString(),
    evidence: {
      visual: { presentationType: "PRODUCT_ONLY", confidence: "MEDIUM" },
      titleDerived: { detectedPackCount: 3, detectedUnitCount: 15 },
      combinedConclusion: { presentationType: "PRODUCT_ONLY", confidence: "MEDIUM", basis: ["VISUAL"] },
    },
    ...overrides,
  }
}

test("the controlled Lysol 6 x 80 ct sold row is pack/size intelligence, never an exact 3 x 15 ct comparable", () => {
  const result = parseProductResearchBrowserCapture({ capture: capture([row({
    temporaryTitle: "Lysol Disinfecting Wipes Lemon Lot of 6 80 ct per pack",
    listingId: "123456789012",
    averageSoldPrice: 29.98,
    averageShipping: 0,
    totalSold: 18,
    itemSales: 539.64,
    lastSoldDate: "2026-07-16",
    detectedOfferPackCount: 6,
    detectedUnitCount: 80,
    detectedSize: "80 ct",
  })]), targets: [target] })
  assert.equal(result.matchCounts.exactLuna, 0)
  assert.equal(result.matchCounts.differentPack, 1)
  assert.equal(result.rows[0].matchClassification, "SAME_PRODUCT_DIFFERENT_PACK")
  assert.ok(result.rows[0].matchReasons.includes("PACK_COUNT_MISMATCH"))
  assert.ok(result.rows[0].matchReasons.includes("UNIT_COUNT_MISMATCH"))
  assert.ok(result.rows[0].matchReasons.includes("SIZE_MISMATCH"))
  assert.equal(result.rows[0].totalSold, 18)
  assert.equal(result.rows[0].averageSoldPrice, 29.98)
  assert.equal(result.rows[0].averageShipping, 0)
})

test("an exact strong Luna identity can enter confirmed sold evidence", () => {
  const result = parseProductResearchBrowserCapture({ capture: capture(), targets: [target] })
  assert.equal(result.matchCounts.exactLuna, 1)
  assert.equal(result.rows[0].matchClassification, "EXACT_LUNA_MATCH")
  assert.equal(result.rows[0].normalizedIdentity.packCount, 3)
  assert.equal(result.rows[0].normalizedIdentity.unitCount, 15)
})

test("browser-recognized listing and localized column aliases satisfy the server contract", () => {
  const english = parseProductResearchBrowserCapture({
    capture: capture(undefined, {
      visibleColumns: ["Listing", "Avg. sold price", "Avg. shipping", "Total sold", "Last sold"],
    }),
    targets: [target],
  })
  assert.equal(english.rows.length, 1)

  const spanish = parseProductResearchBrowserCapture({
    capture: capture(undefined, {
      visibleColumns: ["Título", "Precio promedio de venta", "Envío promedio", "Total vendido", "Última venta"],
    }),
    targets: [target],
  })
  assert.equal(spanish.rows.length, 1)

  const decoratedAccessibilityLabels = parseProductResearchBrowserCapture({
    capture: capture(undefined, {
      visibleColumns: ["Listing button sortable", "Price result column", "Sold result column", "Date result column"],
    }),
    targets: [target],
  })
  assert.equal(decoratedAccessibilityLabels.rows.length, 1)
})

test("structured required fields do not allow an empty visible-column capture", () => {
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture(undefined, { visibleColumns: [] }), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_REQUIRED_COLUMNS_MISSING/)
})

test("a verified active listing link can classify pack intelligence but cannot manufacture an exact match", () => {
  const linkedTarget = targetFromVerifiedActiveListingLink({
    link: {
      id: "link-pilot",
      supplier_variant_id: "48809640722656",
      supplier_sku: "ITEM3995",
      verification_status: "verified",
      verification_method: "EBAY_TRADING_GET_ITEM_READONLY",
    },
    opportunity: {
      supplier_product_id: "9220829970656",
      product_title: "Lysol Disinfecting Wipes To-Go Pack, Lemon Scent",
      variant_title: "3 Pack · Default Title",
      gtin: null,
      assessment: { identity: { exactIdentityConfirmed: true } },
    },
  })
  assert.ok(linkedTarget)
  assert.equal(linkedTarget.officialLinkVerified, true)
  assert.equal(linkedTarget.identity.packCount, 3)
  assert.equal(linkedTarget.identity.gtin, null)

  const differentPack = parseProductResearchBrowserCapture({ capture: capture([row({
    temporaryTitle: "Lysol Disinfecting Wipes To-Go Lemon Lot of 6 80 ct per pack",
    listingId: "123456789012",
    averageSoldPrice: 29.98,
    averageShipping: 0,
    totalSold: 18,
    lastSoldDate: "2026-07-16",
    detectedOfferPackCount: 6,
    detectedUnitCount: 80,
    detectedSize: "80 ct",
  })]), targets: [linkedTarget] })
  assert.equal(differentPack.rows[0].matchClassification, "SAME_PRODUCT_DIFFERENT_PACK")
  assert.equal(differentPack.matchCounts.exactLuna, 0)

  const samePack = parseProductResearchBrowserCapture({ capture: capture([row({
    temporaryTitle: "Lysol Disinfecting Wipes To-Go Lemon 3 x 15 ct",
  })]), targets: [linkedTarget] })
  assert.equal(samePack.rows[0].matchClassification, "AMBIGUOUS")
  assert.equal(samePack.matchCounts.exactLuna, 0)

  const withoutPriorExactIdentity = targetFromVerifiedActiveListingLink({
    link: {
      id: "link-pilot-not-yet-reconciled",
      supplier_variant_id: "48809640722656",
      supplier_sku: "ITEM3995",
      verification_status: "verified",
      verification_method: "EBAY_TRADING_GET_ITEM_READONLY",
    },
    opportunity: {
      supplier_product_id: "9220829970656",
      product_title: "Lysol Disinfecting Wipes To-Go Pack, Lemon Scent",
      variant_title: "3 Pack · Default Title",
      assessment: { identity: { exactIdentityConfirmed: false } },
    },
  })
  assert.ok(withoutPriorExactIdentity)
  assert.equal(withoutPriorExactIdentity.officialLinkVerified, true)
})

test("offer parsing distinguishes pack count, unit count and size", () => {
  assert.deepEqual(detectProductResearchOfferFacts(
    "Lysol Wipes Lemon Lot of 6 80 ct per pack",
  ), { packCount: 6, unitCount: 80, size: "80 ct" })
})

test("capture rejects non-official origins, missing query context and buyer/order fields", () => {
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture(undefined, { listingSite: "example.com" }), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_OFFICIAL_ORIGIN_REQUIRED/)
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture(undefined, { searchQuery: "" }), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_QUERY_CONTEXT_REQUIRED/)
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture([{ ...row(), buyerEmail: "buyer@example.com" }]), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_FORBIDDEN_FIELD/)
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture([{ ...row(), orderId: "private-order" }]), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_FORBIDDEN_FIELD/)
})

test("invalid quantities and dates never become sold observations", () => {
  assert.throws(() => parseProductResearchBrowserCapture({
    capture: capture([row({ totalSold: 0, lastSoldDate: "not-a-date" })]), targets: [target],
  }), /PRODUCT_RESEARCH_CAPTURE_NO_VALID_SOLD_ROWS/)
})

test("deduplication is stable and persistence drops transient titles and page content", () => {
  const result = parseProductResearchBrowserCapture({
    capture: capture([row(), row()]), targets: [target],
  })
  assert.equal(result.rows.length, 1)
  assert.equal(result.duplicateWithinCaptureCount, 1)
  const stored = JSON.stringify(productResearchCapturePersistenceRows(result.rows))
  assert.doesNotMatch(stored, /Lysol Disinfecting Wipes Lemon 3 x 15 ct/)
  assert.doesNotMatch(stored, /temporaryTitle|pageHtml|imageUrl|buyer|orderId/i)
  assert.match(stored, /title_fingerprint/)
})

test("one visible capture carries all rows and keeps visual enrichment separate from commercial deduplication", () => {
  const result = parseProductResearchBrowserCapture({
    capture: capture([
      row({ listingId: "366543596425", visualPattern: visualPattern() }),
      row({ listingId: "366543596426", totalSold: 13, visualPattern: visualPattern({
        frameCoverage: "MEDIUM", visualComplexity: "MEDIUM",
      }) }),
    ], { visualPatternSchemaVersion: "PRODUCT_RESEARCH_VISUAL_PATTERN_V1_2026_07_17" }),
    targets: [target],
  })
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows.filter((entry) => entry.visualPattern?.analysisStatus === "ANALYZED").length, 2)
  assert.equal(productResearchCapturePersistenceRows(result.rows).length, 2)
  assert.doesNotMatch(JSON.stringify(productResearchCapturePersistenceRows(result.rows)),
    /visualPattern|imageUrl|base64|blob|screenshot/i)
})

test("unsafe visual fields are rejected without blocking a valid commercial sold row", () => {
  for (const unsafe of [
    { imageUrl: "https://cdn.example.test/thumb.jpg" },
    { base64: "aGVsbG8=" },
    { blob: "blob:https://www.ebay.com/id" },
    { screenshot: "data:image/png;base64,aGVsbG8=" },
    { pixelData: [255, 0, 0, 255] },
  ]) assert.equal(sanitizeProductResearchVisualPattern({ ...visualPattern(), ...unsafe }), null)
  const result = parseProductResearchBrowserCapture({
    capture: capture([row({ visualPattern: { ...visualPattern(), algorithmVersion: "not a valid version" } })], {
      visualPatternSchemaVersion: "PRODUCT_RESEARCH_VISUAL_PATTERN_V1_2026_07_17",
    }),
    targets: [target],
  })
  assert.equal(result.validCount, 1)
  assert.equal(result.rows[0].visualPattern?.analysisStatus, "REJECTED")
})

test("visual briefs compare exact, related-pack and related-size cohorts without causal claims", () => {
  const entries = [
    ["exact", "EXACT_LUNA_MATCH", 30, visualPattern()],
    ["pack", "SAME_PRODUCT_DIFFERENT_PACK", 20, visualPattern({ presentationType: "MULTIPACK_LIKELY", packClarity: "CLEAR" })],
    ["size", "SAME_PRODUCT_DIFFERENT_SIZE", 10, visualPattern({ backgroundType: "COLORED", frameCoverage: "MEDIUM" })],
  ].map(([key, matchClassification, confirmedSoldQuantity, pattern]) => ({
    evidenceDeduplicationKey: `sha256:${String(key).padEnd(64, "0")}`,
    identityHash: `sha256:${String(key).padEnd(64, "1")}`,
    productFamilyFingerprint: `sha256:${"family".padEnd(64, "2")}`,
    matchClassification,
    detectedOfferPackCount: key === "pack" ? 6 : 3,
    confirmedSoldQuantity,
    visualPattern: pattern,
  }))
  const brief = buildVisualMarketBriefs(entries, {
    queryContextHash: `sha256:${"query".padEnd(64, "3")}`,
    captureRunId: "run-safe",
    categoryId: "123",
    capturedAt: "2026-07-17T00:00:00.000Z",
  })[0]
  assert.equal(brief.exactCohortSize, 1)
  assert.equal(brief.relatedPackCohortSize, 1)
  assert.equal(brief.relatedSizeCohortSize, 1)
  assert.equal(brief.supportingSignals.sampleSize, 3)
  assert.ok(brief.prohibitedConclusions.includes("VISUAL_PATTERN_DOES_NOT_PROVE_CAUSALITY"))
  assert.doesNotMatch(JSON.stringify(brief), /imageUrl|base64|blob|screenshot|caused sales/i)
})

test("an ambiguous closest Luna candidate is never persisted as a binding", () => {
  const weakTarget = {
    ...target,
    identity: {
      productName: target.productName,
      packCount: 3,
      unitCount: 15,
      size: "15 ct",
      scent: "lemon",
      condition: "new",
    },
  }
  const result = parseProductResearchBrowserCapture({
    capture: capture([row()]), targets: [weakTarget],
  })
  assert.equal(result.rows[0].matchClassification, "AMBIGUOUS")
  assert.equal(result.rows[0].matchedTarget, null)
  const stored = productResearchCapturePersistenceRows(result.rows)[0]
  assert.equal(stored.matched_queue_item_id, null)
  assert.equal(stored.matched_supplier_variant_id, null)
})

test("persistence errors use a strict sanitized allowlist", () => {
  assert.equal(productResearchCapturePersistenceError({ code: "23505", message: "raw detail" }),
    "PRODUCT_RESEARCH_CAPTURE_IDEMPOTENCY_CONFLICT")
  assert.equal(productResearchCapturePersistenceError({ code: "23514", detail: "raw detail" }),
    "PRODUCT_RESEARCH_CAPTURE_CONSTRAINT_REJECTED")
  assert.equal(productResearchCapturePersistenceError({ code: "23503" }),
    "PRODUCT_RESEARCH_CAPTURE_REFERENCE_MISMATCH")
  assert.equal(productResearchCapturePersistenceError({ code: "PGRST202" }),
    "PRODUCT_RESEARCH_CAPTURE_RPC_SCHEMA_STALE")
  assert.equal(productResearchCapturePersistenceError({ code: "UNKNOWN", message: "token-secret" }),
    "PRODUCT_RESEARCH_CAPTURE_PERSIST_FAILED")
})

test("capture v3 migration serializes and deduplicates concurrent deliveries additively", () => {
  const migration = readFileSync(
    "supabase/migrations/20260717150000_harden_product_research_capture_idempotency.sql", "utf8",
  )
  const service = readFileSync("lib/ebay/ebay-product-research-browser-capture.ts", "utf8")
  assert.doesNotMatch(migration, /drop\s+(?:table|constraint|column)|delete\s+from|truncate/i)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /v_existing_batch_id is not null[\s\S]*return v_existing_batch_id/)
  assert.match(migration, /on conflict \(marketplace_account_key,marketplace,evidence_deduplication_key\) do nothing/)
  assert.match(migration, /v_duplicate_count := p_duplicate_count \+ v_collision_count/)
  assert.match(migration, /v_inserted_count <> v_imported_count/)
  assert.match(migration, /grant execute[\s\S]*to service_role/)
  assert.match(service, /rpc\("import_product_research_browser_capture_v3"/)
  assert.doesNotMatch(service, /persistError\.(?:message|details|hint)/)
})

test("extension is origin-limited and transfers structured visible rows without network scraping", () => {
  const manifest = JSON.parse(readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/manifest.json", "utf8",
  ))
  const content = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/content.js", "utf8",
  )
  assert.deepEqual(manifest.host_permissions, ["https://www.ebay.com/sh/research*"])
  assert.deepEqual(manifest.permissions, [])
  assert.deepEqual(manifest.content_scripts?.[0]?.matches,
    ["https://www.ebay.com/sh/research*"])
  assert.match(content, /Capturar y continuar/)
  assert.match(content, /Product Research · v1\.2\.6/)
  assert.match(content, /Capturar y continuar/)
  assert.match(content, /captureContext = \{ roots: new WeakMap\(\), queries: new WeakMap\(\)/)
  assert.match(content, /if \(coordinateResult\) return coordinateResult/)
  assert.match(content, /preparedCandidates/)
  assert.match(content, /MAX_COORDINATE_CONTAINERS/)
  assert.match(content, /captureContext\.shallow = true/)
  assert.match(content, /ancestorCounts/)
  assert.match(content, /MAX_FALLBACK_HEADERS/)
  assert.match(content, /requestAnimationFrame/)
  assert.match(content, /1\. Copiar consulta/)
  assert.match(content, /data-testid\*="table/)
  assert.match(content, /function headerElementsFor/)
  assert.match(content, /function rowCells/)
  assert.match(content, /function deepRoots/)
  assert.match(content, /function safeStructureDiagnostics/)
  assert.match(content, /function coordinateValuesForRow/)
  assert.match(content, /function coordinateValuesForBand/)
  assert.match(content, /function coordinateRowsFromItemLinks/)
  assert.match(content, /function relaxedRowsFromItemLinks/)
  assert.match(content, /1\. Preparar consulta/)
  assert.match(content, /function assertExpectedQuery/)
  assert.match(content, /function applyAndSearchNextQuery/)
  assert.match(content, /function waitForResearchSearchInput/)
  assert.match(content, /function setNextQueryWorkflowStage/)
  assert.match(content, /function positivePlanInteger/)
  assert.match(content, /transitionSource = "INITIAL"/)
  assert.match(content, /CAPTURE_ACCEPTED/)
  assert.match(content, /CAPTURE_DISCARDED/)
  assert.match(content, /MANUAL_COPY_REQUIRED/)
  assert.match(content, /MANUAL_SEARCH_REQUIRED/)
  assert.match(content, /READY_TO_CAPTURE/)
  assert.match(content, /La captura anterior quedó guardada/)
  assert.match(content, /La tabla anterior fue descartada y no se guardó/)
  assert.match(content, /persistGuidedQueryFragment\([\s\S]*waitForResearchSearchInput/)
  assert.match(content, /Capturar cuando carguen resultados/)
  assert.match(content, /function completeGuidedPlan/)
  assert.match(content, /PROCESO COMPLETADO/)
  assert.match(content, /VOLVER A SELLER OS/)
  assert.match(content, /SELLER_OS_HOME_URL/)
  assert.match(content, /panel\.append\(title, status, nextQueryPanel, captureButton\)/)
  assert.match(content, /AHORA · PASO 3/)
  assert.match(content, /aria-current/)
  assert.match(content, /function advanceAfterAcceptedCapture/)
  assert.match(content, /function advanceAfterCorrectedCapture/)
  assert.match(content, /event\.data\.success && event\.data\.nextQuery[\s\S]*advanceAfterAcceptedCapture/)
  assert.match(content, /setTimeout\(\(\) => void applyAndSearchNextQuery\(\), 0\)/)
  assert.match(content, /waitingForResults[\s\S]*paintWorkflowStep\(captureButton/)
  assert.match(content, /function guidedQueryFragment/)
  assert.match(content, /function persistGuidedQueryFragment/)
  assert.match(content, /seller-os-previous-results/)
  assert.match(content, /crypto\.subtle\.digest\("SHA-256"/)
  assert.match(content, /fingerprint === nextQueryState\.previousResultsFingerprint/)
  assert.match(content, /sellerOsSeed\.applied[\s\S]*Verificando que eBay cargó resultados nuevos/)
  assert.match(content, /Consulta recibida de Seller OS\. Aplicándola automáticamente/)
  assert.match(content, /const accessibleLinkText/)
  assert.match(content, /getAttribute\?\.\("aria-label"\)/)
  assert.match(content, /querySelectorAll\?\.\("img\[alt\]"\)/)
  assert.match(content, /const linksByListing = new Map\(\)/)
  assert.match(content, /function coordinateTableParts/)
  assert.match(content, /results\.sort\(\(left, right\) => right\.rows\.length - left\.rows\.length/)
  assert.match(content, /válidas;.*nuevas;.*duplicadas;.*rechazadas/)
  assert.match(content, /function requiredValuesValid/)
  assert.match(content, /Cross-origin frames are intentionally not inspected/)
  assert.match(content, /recognizedFields/)
  assert.match(content, /let statusElement = null/)
  assert.match(content, /statusElement = status/)
  assert.match(content, /Leyendo la tabla visible de Product Research/)
  assert.match(content, /seller-os-query/)
  assert.match(content, /Consulta recibida de Seller OS/)
  assert.match(content, /PRODUCT_RESEARCH_RECEIVER_NOT_READY/)
  assert.doesNotMatch(content, /document\.getElementById\("imnova-product-research-capture-status"\)/)
  assert.equal(manifest.version, "1.2.6")
  assert.ok(content.includes('const OFFICIAL_RESEARCH_PATH = /^\\/sh\\/research\\/?$/'))
  assert.match(content, /function isOfficialResearchTarget/)
  assert.match(content, /function closestAcrossOpenRoots/)
  assert.match(content, /function isGlobalEbaySearchInput/)
  assert.match(content, /name === "_nkw"/)
  assert.ok(content.includes('/^\\/sch(?:\\/|$)/'))
  assert.match(content, /unsafeExplicitAction = Boolean\(rawAction && !isOfficialResearchTarget\(rawAction\)\)/)
  assert.match(content, /function officialResearchFormFor/)
  assert.ok((content.match(/method && method !== "get"/g) ?? []).length >= 2)
  assert.match(content, /function isProductResearchInput/)
  assert.match(content, /closestAcrossOpenRoots\(input, 'main,\[role="main"\]'\)/)
  assert.match(content, /isOfficialResearchTarget\(action\) && \(localMainControl \|\| explicitResearchAction\)/)
  assert.match(content, /setSearchInputValue\(input, query\)[\s\S]*MANUAL_SEARCH_REQUIRED/)
  assert.match(content, /if \(!form \|\| typeof form\.requestSubmit !== "function"\)[\s\S]*return/)
  assert.match(content, /function requestResearchSubmitWithGuidedFragment/)
  assert.match(content, /target\.hash = window\.location\.hash/)
  assert.match(content, /requestResearchSubmitWithGuidedFragment\(form\)/)
  assert.match(content, /Never fall back to Enter/)
  assert.doesNotMatch(content, /new KeyboardEvent\("keydown"/)
  assert.doesNotMatch(content, /method\s*=\s*["']post["']/i)
  assert.match(content, /\^\\\/sh\\\/research/)
  assert.match(content, /postMessage/)
  assert.match(content, /VISUAL_PATTERN_SCHEMA_VERSION/)
  assert.match(content, /function visibleVisualPatternForRow/)
  assert.match(content, /getImageData/)
  assert.match(content, /pixelData\.data\.fill\(0\)/)
  assert.match(content, /canvas\.width = 0/)
  assert.doesNotMatch(content, /\bfetch\s*\(|document\.cookie|localStorage|sessionStorage|outerHTML|innerHTML|toDataURL|toBlob|captureVisibleTab/)
  assert.doesNotMatch(content, /\.src\b|getAttribute\(["']src/)
  const archive = readFileSync(
    "public/seller-os-tools/ebay-product-research-capture-extension-v1.2.6.zip",
  )
  assert.equal(archive.subarray(0, 4).toString("hex"), "504b0304")
  assert.ok(archive.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])))
  const archiveEntries = storedZipEntries(archive)
  assert.deepEqual([...archiveEntries.keys()].sort(), ["README.md", "content.js", "manifest.json"])
  for (const file of archiveEntries.keys()) {
    assert.deepEqual(archiveEntries.get(file), readFileSync(
      `tools/browser-extensions/ebay-product-research-capture/${file}`,
    ))
  }
  assert.deepEqual(archive, readFileSync(
    "public/seller-os-tools/ebay-product-research-capture-extension.zip",
  ))
})

test("every operator surface names the current Product Research extension", () => {
  const surfaces = [
    readFileSync("app/admin/today-launch-panel.tsx", "utf8"),
    readFileSync(
      "app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx",
      "utf8",
    ),
    readFileSync(
      "app/api/admin/ebay/listing-ai/product-research-capture/route.ts",
      "utf8",
    ),
  ].join("\n")
  assert.match(surfaces, /v1\.2\.6/)
  assert.doesNotMatch(surfaces, /v1\.2\.[0-5]/)
})

test("query planning groups Luna candidates into at most fifteen broad deterministic searches", () => {
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    supplierVariantId: `variant-${index}`,
    productName: `Lysol Disinfecting Wipes ${index % 4 === 0 ? "Lemon" : "Fresh"} ${index + 1} Pack`,
    brand: "Lysol",
    categoryId: String(1000 + index % 20),
    priorityScore: 100 - index,
  }))
  const first = buildProductResearchQueryPlan(candidates)
  const second = buildProductResearchQueryPlan([...candidates].reverse())
  assert.ok(first.queries.length > 0)
  assert.ok(first.queries.length <= 15)
  assert.equal(first.inputHash, second.inputHash)
  assert.deepEqual(first.queries, second.queries)
  assert.ok(first.queries.every((query) => query.searchQuery.length <= 100))
  assert.ok(first.queries.every((query) => !/\bpack\b/i.test(query.searchQuery)))
  assert.ok(first.queries.every((query) => query.candidateVariantHashes.length === query.candidateCount))
  assert.doesNotMatch(JSON.stringify(first), /competitor|buyer|cookie|token/i)
})

test("Seller OS downloads the same current guided extension validated by the suite", () => {
  const sellerOsUi = readFileSync(
    "app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx",
    "utf8",
  )
  assert.match(
    sellerOsUi,
    /ebay-product-research-capture-extension-v1\.2\.6\.zip/,
  )
  assert.match(sellerOsUi, /extensión asistida v1\.2\.6/)
  assert.doesNotMatch(
    sellerOsUi,
    /ebay-product-research-capture-extension-v1\.2\.[0-5]\.zip/,
  )
})

test("the expected Product Research query hash ignores harmless casing and whitespace changes", () => {
  const plan = buildProductResearchQueryPlan([{
    supplierVariantId: "luna-1", productName: "Lysol Disinfecting Wipes Lemon",
    brand: "Lysol", categoryId: "123", priorityScore: 1,
  }])
  const query = plan.queries[0]
  assert.ok(query)
  assert.equal(productResearchPlannedQueryHash(`  ${query.searchQuery.toUpperCase()}  `), query.queryHash)
  assert.notEqual(productResearchPlannedQueryHash("different product"), query.queryHash)
})

test("the Product Research plan ignores punctuation and Luna's non-variant placeholder", () => {
  const planned = "9001E e Series Battery Switch Selector 4 Position Red Default Title"
  const visible = "9001E e-Series Battery Switch, Selector 4 Position, Red"
  assert.equal(productResearchDisplayQuery(planned),
    "9001E e Series Battery Switch Selector 4 Position Red")
  assert.equal(productResearchPlannedQueryHash(visible), productResearchPlannedQueryHash(planned))
  assert.notEqual(productResearchPlannedQueryHash(`${visible} 2 Pack`),
    productResearchPlannedQueryHash(planned))
  const embedded = buildSameDayProductResearchQuery({
    id: "candidate-80144", candidateKey: "candidate-80144",
    productTitle: "80144 Universal Turbo Pressure Washer Nozzle Default Title",
    variantTitle: null, gtin: null,
  })
  assert.equal(embedded.query, "80144 Universal Turbo Pressure Washer Nozzle")
})

test("a family query may omit trailing net content without treating other sizes as exact", () => {
  const planned = "Lever 2000 Bar Soap Original 3 75 oz"
  const family = "Lever 2000 Bar Soap Original"
  assert.equal(productResearchDisplayQuery(planned), family)
  assert.equal(productResearchQueriesMatch(planned, family), true)
  assert.equal(productResearchQueriesMatch(planned, "Lever 2000 Aloe Soap"), false)
  const query = buildSameDayProductResearchQuery({
    id: "lever", candidateKey: "lever", productTitle: "Lever 2000 Bar Soap Original, 3.75 oz",
    variantTitle: "Default Title", gtin: null, brand: null, mpn: null,
  })
  assert.equal(query.strategy, "FAMILY_IDENTITY_RECONCILIATION")
  assert.equal(query.query, family)
  // Query compatibility only authorizes the captured family table. Existing
  // row-level reconciliation remains responsible for exact size/pack evidence.
})

test("query-plan migration is additive, Preview-safe and blocks browser writes", () => {
  const migration = readFileSync(
    "supabase/migrations/20260717141000_create_product_research_query_plans.sql", "utf8",
  )
  assert.doesNotMatch(migration, /drop\s+table|drop\s+constraint|delete\s+from|truncate/i)
  assert.match(migration, /marketplace_product_research_query_plans/)
  assert.match(migration, /marketplace_product_research_query_tasks/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /revoke all[^;]+anon, authenticated, service_role/)
  assert.match(migration, /grant select, insert, update[^;]+service_role/)
  assert.doesNotMatch(migration, /grant[^;]+anon|grant[^;]+authenticated/i)
  assert.match(migration, /openai_calls = 0 and ebay_writes = 0/)
  assert.doesNotMatch(migration,
    /\bcompetitor_title\b|\braw_html\b|\bimage_url\b|\bbuyer_(?:name|email|phone|id)\b|\bshipping_address\b/i)
})

test("official Developer Analytics quota is sanitized and exposes the real Browse reset", () => {
  const quota = parseEbayApplicationBrowseQuota({ rateLimits: [{
    apiContext: "buy",
    apiName: "browse",
    resources: [{ name: "item_summary", rates: [{
      limit: 5_000,
      count: 4_990,
      remaining: 10,
      reset: "2026-07-18T00:00:00.000Z",
      secret: "must-not-propagate",
    }] }],
  }] }, "2026-07-17T14:00:00.000Z")
  assert.equal(quota.status, "AVAILABLE")
  assert.equal(quota.limit, 5_000)
  assert.equal(quota.remaining, 10)
  assert.equal(quota.resetAt, "2026-07-18T00:00:00.000Z")
  assert.doesNotMatch(JSON.stringify(quota), /must-not-propagate/)
  assert.equal(quota.secretsExposed, false)
  assert.equal(quota.ebayWrites, 0)
})

test("receiver validates eBay origin and route resumes the same Loop 1 run without Discovery or writes", () => {
  const receiver = readFileSync(
    "app/admin/ebay/mobile-review/product-research-capture/page.tsx", "utf8",
  )
  const route = readFileSync(
    "app/api/admin/ebay/listing-ai/product-research-capture/route.ts", "utf8",
  )
  const queryPlan = readFileSync(
    "lib/ebay/ebay-product-research-query-plan.ts", "utf8",
  )
  assert.match(receiver, /event\.origin !== EBAY_PRODUCT_RESEARCH_ORIGIN/)
  assert.match(receiver, /event\.source !== opener/)
  assert.doesNotMatch(receiver, /temporaryTitle/)
  assert.match(route, /sameRunResumed: true, discoveryRepeated: false/)
  assert.match(route, /assertProductResearchCaptureMatchesNextQuery/)
  assert.match(route, /currentPilotProductResearchPlanId/)
  assert.match(route, /searchQuery: capture\.searchQuery, planId: pilotPlanId/)
  assert.match(queryPlan, /planId\?: string \| null/)
  assert.match(queryPlan, /\.eq\("id", input\.planId\)/)
  assert.match(queryPlan, /PRODUCT_RESEARCH_QUERY_PLAN_SCOPE_MISSING/)
  assert.match(route, /taskId: plannedTask\.taskId/)
  assert.match(route, /visualContext: \{ categoryId: plannedTask\?\.categoryId \?\? null \}/)
  assert.match(route, /sameRunResumed: true, discoveryRepeated: false/)
  assert.match(queryPlan, /\.eq\("marketplace", "EBAY_US"\)\.eq\("status", "PROCESSED"\)/)
  assert.match(queryPlan, /alreadyProcessed: true as const/)
  assert.match(queryPlan, /\.eq\("status", "COMPLETED"\)\.gte\("completed_at", replayWindowStart\)/)
  assert.match(queryPlan, /return await processedReplayForPlan\(completedPlan\)/)
  assert.match(queryPlan, /throw new Error\("PRODUCT_RESEARCH_QUERY_PLAN_NEXT_QUERY_REQUIRED"\)/)
  assert.match(route, /plannedTask\?\.alreadyProcessed && plannedTask\.captureBatchId/)
  assert.match(route, /PROCESSED_CAPTURE_REPLAY_REDIRECTED/)
  assert.match(route, /observationsImported: 0, discoveryRepeated: false/)
  assert.match(receiver, /TABLA YA PROCESADA/)
  assert.match(receiver, /No se importó ni duplicó nuevamente/)
  assert.match(receiver, /result\?\.queryPlan\?\.status === "COMPLETED"/)
  assert.match(receiver, /CONTINUAR EN SELLER OS/)
  assert.match(receiver, /El plan terminó\. Regresa a Seller OS/)
  assert.match(receiver, /returnToSellerOs: !navigationCorrection/)
  assert.match(receiver, /nextQuery: navigationCorrection/)
  assert.match(receiver, /allí verás el siguiente producto antes de abrir otra consulta/)
  assert.match(route, /openAiCalls: 0, ebayWrites: 0, canPublish: false/)
  assert.doesNotMatch(route, /publishOffer|createOffer|shipping_fulfillment/)
})

test("v1.2.6 reuses one authenticated receiver and exposes one chronological CTA", () => {
  const receiver = readFileSync(
    "app/admin/ebay/mobile-review/product-research-capture/page.tsx", "utf8",
  )
  const content = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/content.js", "utf8",
  )
  const manifest = JSON.parse(readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/manifest.json", "utf8",
  ))
  assert.equal(manifest.version, "1.2.6")
  assert.deepEqual(manifest.permissions, [])
  assert.deepEqual(manifest.host_permissions, ["https://www.ebay.com/sh/research*"])
  assert.match(content, /const RECEIVER_WINDOW_NAME = "sellerOsProductResearchBatchReceiver"/)
  assert.match(content, /function reusableReceiverWindow\(\)/)
  assert.match(content, /window\.open\("", RECEIVER_WINDOW_NAME, RECEIVER_WINDOW_FEATURES\)/)
  assert.doesNotMatch(content, /window\.open\(RECEIVER_URL/)
  assert.match(content, /candidate\.location\.href === "about:blank"/)
  assert.match(content, /Do not navigate or reload it/)
  assert.match(content, /dispatchedCaptureId !== pending\.captureId/)
  assert.match(receiver, /const startReadyHeartbeat = \(\) =>/)
  assert.match(receiver, /const stopReadyHeartbeat = \(\) =>/)
  assert.match(receiver, /completedCaptureResults = useRef\(new Map/)
  assert.match(receiver, /const completed = completedCaptureResults\.current\.get\(captureId\)/)
  assert.match(receiver, /postCaptureResult\(completed\)/)
  assert.match(receiver, /finally \{[\s\S]*startReadyHeartbeat\(\)/)
  assert.match(receiver, /Sesión segura del lote activa/)
  assert.match(receiver, /target="sellerOsDashboard" rel="noopener"/)
  assert.match(content, /function paintWorkflowStep/)
  assert.match(content, /future: \{ background: "#172033"/)
  assert.match(content, /enabled: manualCopy/)
  assert.match(content, /enabled: manualSearch/)
  assert.match(content, /enabled: !waitingForResults/)
  assert.match(content, /searchStepButton\.addEventListener\("click", revealResearchSearchControl\)/)
  assert.match(content, /function completeGuidedPlan[\s\S]*guidedPlanCompleted = true[\s\S]*clearNextQuery\(\)/)
  assert.match(content, /captureButton\.textContent = "VOLVER A SELLER OS"/)
  assert.doesNotMatch(content, /document\.cookie|localStorage|sessionStorage/)
  assert.doesNotMatch(receiver, /document\.cookie|localStorage|sessionStorage/)
})

test("a table from the wrong tab becomes navigation-only and never reaches import", () => {
  const receiver = readFileSync(
    "app/admin/ebay/mobile-review/product-research-capture/page.tsx", "utf8",
  )
  const content = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/content.js", "utf8",
  )
  const route = readFileSync(
    "app/api/admin/ebay/listing-ai/product-research-capture/route.ts", "utf8",
  )
  const correctionStart = route.indexOf(
    'if (code !== "PRODUCT_RESEARCH_QUERY_PLAN_NEXT_QUERY_REQUIRED")',
  )
  const importStart = route.indexOf(
    "const result = await importProductResearchBrowserCapture",
  )
  assert.ok(correctionStart >= 0)
  assert.ok(importStart > correctionStart)
  const correction = route.slice(correctionStart, importStart)
  assert.match(correction, /queryPlan\?\.status !== "ACTIVE" \|\| !queryPlan\.nextQuery/)
  assert.match(correction, /return listingAiResponse/)
  assert.match(correction, /captureQueryCorrected: true/)
  assert.match(correction, /navigationOnly: true/)
  assert.match(correction, /rowCount: 0, validCount: 0, importedCount: 0/)
  assert.match(correction, /commercialEvidenceStored: false/)
  assert.match(correction, /observationsImported: 0/)
  assert.match(correction, /openAiCalls: 0, ebayWrites: 0, canPublish: false/)
  assert.doesNotMatch(correction, /importProductResearchBrowserCapture/)
  assert.match(receiver, /captureQueryCorrected\?: boolean/)
  assert.match(receiver, /CONSULTA CORREGIDA/)
  assert.match(receiver, /no correspondía a la consulta pendiente y no fue guardada/)
  assert.match(receiver, /nextQuery: navigationCorrection[\s\S]*payload\.result\.queryPlan\?\.nextQuery\?\.searchQuery \?\? null : null/)
  assert.match(receiver, /navigationOnly: payload\.result\.navigationOnly === true/)
  assert.match(receiver, /captureQueryCorrected: payload\.result\.captureQueryCorrected === true/)
  assert.match(content, /La tabla no correspondía y no fue guardada/)
  assert.match(content, /advanceAfterCorrectedCapture/)
  assert.match(content, /navigationOnly \? advanceAfterCorrectedCapture : advanceAfterAcceptedCapture/)
})

test("the prepared query UI separates product family, exact query, open and copy actions", () => {
  const panel = readFileSync("app/admin/today-launch-panel.tsx", "utf8")
  const loop2 = readFileSync(
    "app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx", "utf8",
  )
  const mobile = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
  assert.match(panel, /researchTasks=\{productResearchTasks\}/)
  assert.match(panel, /candidates=\{candidates\}/)
  assert.match(panel, /queryKey\(task\?\.action_schema\?\.query\) === queryKey\(guidedQuery\)/)
  assert.match(panel, /queryFamilyKey\(task\?\.action_schema\?\.query\) === queryFamilyKey\(guidedQuery\)/)
  assert.match(panel, /const nextQuery = guidedTask \? guidedQuery : durableTaskQuery/)
  assert.match(panel, /Productos del lote actual/)
  assert.match(panel, /current \? " · AHORA" : ""/)
  assert.match(panel, /productFamily \|\| `Familia de \$\{familyCandidateCount \|\| 1\} candidato\(s\)`/)
  assert.match(panel, /Familia \/ producto de referencia/)
  assert.match(panel, /Consulta exacta que se enviará/)
  assert.match(panel, /ABRIR PRODUCT RESEARCH/)
  assert.match(panel, /COPIAR CONSULTA EXACTA/)
  assert.match(panel, /navigator\.clipboard\.writeText\(nextQuery\)/)
  assert.match(panel, /event\.currentTarget\.select\(\)/)
  assert.match(panel, /Abrir transfiere la consulta a la extensión/)
  assert.doesNotMatch(panel, /ABRIR CONSULTA PREPARADA/)
  assert.match(loop2, /Familia cubierta/)
  assert.match(loop2, /Consulta exacta que se enviará/)
  assert.match(loop2, /seller-os-query=\$\{encodeURIComponent/)
  assert.match(loop2, /Abrir Product Research/)
  assert.match(loop2, /Copiar consulta exacta/)
  assert.doesNotMatch(loop2, /Abrir próxima búsqueda · consulta copiada/)
  const mobileOpen = mobile.slice(
    mobile.indexOf("const openProductResearchCapture"), mobile.indexOf("const sourceLabel"),
  )
  assert.match(mobileOpen, /seller-os-query=\$\{encodeURIComponent\(query\)\}/)
  assert.match(mobileOpen, /consulta exacta transferida a la extensión/)
  assert.doesNotMatch(mobileOpen, /clipboard/)
})

test("migration is additive, append-only, RLS protected and stores no sensitive browser content", () => {
  const migration = readFileSync(
    "supabase/migrations/20260717022000_create_product_research_browser_capture.sql", "utf8",
  )
  assert.doesNotMatch(migration, /drop\s+table|drop\s+constraint|delete\s+from|truncate/i)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /revoke all[^;]+anon, authenticated, service_role/)
  assert.match(migration, /grant select, insert[^;]+service_role/)
  assert.doesNotMatch(migration, /grant[^;]+update|grant[^;]+delete/i)
  assert.match(migration, /raw_html_stored boolean not null default false/)
  assert.match(migration, /temporary_title_stored boolean not null default false/)
  assert.match(migration, /competitor_image_downloaded boolean not null default false/)
  assert.match(migration, /pii_stored boolean not null default false/)
})

test("visual observation migration is append-only and explicitly excludes reconstructive content", () => {
  const migration = readFileSync(
    "supabase/migrations/20260717160000_create_product_research_visual_pattern_observations.sql", "utf8",
  )
  const visual = readFileSync("lib/ebay/ebay-product-research-visual-pattern.ts", "utf8")
  const receiver = readFileSync("app/admin/ebay/mobile-review/product-research-capture/page.tsx", "utf8")
  const dashboard = readFileSync("app/admin/ebay/mobile-review/loop2-top20-opportunity-pool.tsx", "utf8")
  assert.doesNotMatch(migration, /drop\s+table|drop\s+constraint|delete\s+from|truncate/i)
  assert.match(migration, /force row level security/)
  assert.match(migration, /grant select, insert[^;]+service_role/)
  assert.doesNotMatch(migration, /grant[^;]+update|grant[^;]+delete/i)
  assert.match(migration, /before update or delete/)
  assert.match(migration, /raw_image_bytes_stored boolean not null default false/)
  assert.match(migration, /image_urls_stored boolean not null default false/)
  assert.match(migration, /openai_calls = 0 and ebay_writes = 0/)
  assert.doesNotMatch(migration, /\bimage_url\s+(?:text|jsonb|bytea)|\bthumbnail_url\s+(?:text|jsonb|bytea)|\bbase64(?:_data)?\s+(?:text|jsonb|bytea)|\bblob(?:_data)?\s+(?:text|jsonb|bytea)|\bscreenshot(?:_data)?\s+(?:text|jsonb|bytea)/i)
  assert.match(visual, /VISUAL_NOT_CAPTURED_LEGACY/)
  assert.doesNotMatch(receiver, /Patrones visuales observados/)
  assert.doesNotMatch(dashboard, /Patrones visuales observados/)
})
