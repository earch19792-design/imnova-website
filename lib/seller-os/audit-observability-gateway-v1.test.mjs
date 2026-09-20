import assert from "node:assert/strict"
import test from "node:test"
import { registerHooks } from "node:module"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch { /* normal resolver */ }
  }
  return nextResolve(specifier, context)
} })

const {
  SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1,
  SELLER_OS_CODEX_AUDIT_PROTOCOL_V1,
  projectSellerOsHistoricalMismatchFieldV1,
  readSellerOsProductCaseAuditV1,
} = await import("./audit-observability-gateway-v1.ts")

test("Product Case fails closed without field receipts; downstream package is not source truth", async () => {
  const tables = {
    ebay_luna_opportunity_queue: [{id:'queue',candidate_key:'candidate',supplier_product_id:'123',
      supplier_variant_id:'456',supplier_sku:'TEST42',assessment:{productTruth:{title:'legacy'}}}],
    ebay_listing_packages: [{id:'package',package_data:{brand:'Unsupported',model:'Comparable',
      mpn:'Reference',imageUrls:['https://generated.test/image.jpg']}}],
  }
  const supabase = {from(table) {
    let single=false
    const builder = {select(){return this},eq(){return this},order(){return this},limit(){return this},
      maybeSingle(){single=true;return this},then(resolve){return Promise.resolve({
        data:single?(tables[table]?.[0]??null):(tables[table]??[]),error:null}).then(resolve)}}
    return builder
  }}
  const result=await readSellerOsProductCaseAuditV1({supabase,accountKey:'test',
    identityType:'LUNA_PRODUCT_ID',identity:'123',detailMode:'EVIDENCE'})
  assert.equal(result.PRODUCT_JOURNEY.find(x=>x.STAGE==='PRODUCT_TRUTH').STATUS,'UNPROVEN')
  for(const name of ['BRAND','MODEL','MPN','IMAGES']) {
    assert.equal(result.FIELD_TRUTH.find(x=>x.FIELD===name).VALUE,null)
  }
  const sourceField={FIELD:'MATERIAL',VALUE:'Nylon',SEMANTIC_CLASS:'FACT',EVIDENCE_STATUS:'PROVEN',
    SOURCE_AUTHORITY:'SUPPLIER',EVIDENCE_ID:'sha256:source',SOURCE_EVIDENCE:[{RAW_VALUE:'Nylon'}],
    CAPTURED_AT:'2026-08-01T12:00:00Z',OBSERVED_AT:'2026-08-01T12:00:00Z',
    FRESH_UNTIL:null,CONTRADICTION:false,REASONING_BASIS:'Explicit supplier attribute'}
  tables.ebay_luna_opportunity_queue[0].assessment.productTruth.fieldTruthV1={
    contractVersion:'LUNA_FIELD_PRODUCT_TRUTH_V1',fields:[sourceField],status:'PROVEN'}
  const projected=await readSellerOsProductCaseAuditV1({supabase,accountKey:'test',
    identityType:'LUNA_PRODUCT_ID',identity:'123',detailMode:'EVIDENCE'})
  assert.equal(projected.PRODUCT_JOURNEY.find(x=>x.STAGE==='PRODUCT_TRUTH').STATUS,'PARTIAL')
  for(const [key,value] of Object.entries(sourceField))
    assert.deepEqual(projected.FIELD_TRUTH.find(x=>x.FIELD==='MATERIAL')[key],value)
})

test("registers exactly the two bounded read-only audit tools", () => {
  assert.deepEqual(SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1.map((tool) =>
    tool.name), ["seller_os_get_product_case",
    "seller_os_get_publication_execution"])
  assert.equal(SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1.length, 2)
  for (const tool of SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1) {
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.equal(tool.annotations.destructiveHint, false)
    assert.equal(tool.annotations.openWorldHint, false)
  }
})

test("historical mismatch ambiguity is never reconstructed", () => {
  assert.equal(projectSellerOsHistoricalMismatchFieldV1({
    error_class: "EBAY_OFFER_EXACT_PAYLOAD_MISMATCH",
    mismatch_fields: [],
  }), "UNPROVEN")
  assert.equal(projectSellerOsHistoricalMismatchFieldV1({}), "UNPROVEN")
  assert.deepEqual(projectSellerOsHistoricalMismatchFieldV1({
    mismatch_fields: ["categoryId", "price"],
  }), ["categoryId", "price"])
})

test("completed Commercial Trace is the canonical SKU readback when legacy queue is absent", async () => {
  const identity = { key: "LUNA_PORTEX:9220800774368:48809601859808:ITEM6255",
    source: "LUNA_PORTEX", status: "PROVEN", productId: "9220800774368",
    variantId: "48809601859808", supplierSku: "ITEM6255",
    provenance: "LUNA_STRUCTURED_PRODUCT_VARIANT" }
  const tables = {
    ebay_luna_opportunity_queue: [],
    seller_os_live_commercial_traces_v1: [{ trace_id: "trace-current",
      supplier_product_id: "9220800774368", supplier_variant_id: "48809601859808",
      state: "COMPLETED", completed_at: "2026-09-15T13:18:43.750Z",
      result: { PRODUCT_TRUTH: { title: "Black Women Leather Backpack",
        productId: "9220800774368", variantId: "48809601859808",
        supplierSku: "ITEM6255", canonicalSkuIdentity: identity,
        fieldTruthV1: { contractVersion: "LUNA_FIELD_PRODUCT_TRUTH_V1",
          fields: [], status: "PROVEN" } } } }],
  }
  const supabase = { from(table) {
    let single = false
    const builder = { select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
      maybeSingle() { single = true; return this }, then(resolve) {
        return Promise.resolve({ data: single ? (tables[table]?.[0] ?? null) : (tables[table] ?? []), error: null }).then(resolve)
      } }
    return builder
  } }
  const result = await readSellerOsProductCaseAuditV1({ supabase, accountKey: "test",
    identityType: "SUPPLIER_SKU", identity: "ITEM6255", detailMode: "SUMMARY" })
  assert.equal(result.RESOLVED_CANONICAL_IDENTITY.candidateId,
    "LUNA_PORTEX:9220800774368:48809601859808:ITEM6255")
  assert.equal(result.RESOLVED_CANONICAL_IDENTITY.lunaProductId, "9220800774368")
  assert.equal(result.RESOLVED_CANONICAL_IDENTITY.lunaVariantId, "48809601859808")
  assert.equal(result.RESOLVED_CANONICAL_IDENTITY.supplierSku, "ITEM6255")
  assert.equal(result.PRODUCT_JOURNEY.find((stage) => stage.STAGE === "LUNA_SOURCE").STATUS, "PROVEN")
  assert.equal(result.PRODUCT_JOURNEY.find((stage) => stage.STAGE === "LUNA_SOURCE").SOURCE_AUTHORITY,
    "seller_os_live_commercial_traces_v1.PRODUCT_TRUTH")
})

function catalogSupabase(preflightStatus = "PREFLIGHT_PASS", fieldTruth = null,
  sourceFingerprint = "sha256:catalog") {
  const tables = {
    ebay_luna_opportunity_queue: [],
    luna_catalog_snapshots_v1: [{ snapshot_id: "snapshot-current",
      snapshot_status: "COMPLETE",
      snapshot_completed_at: "2026-09-15T17:55:21.486Z",
      identity_engine_version: "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3",
      preflight_contract_version: "LUNA_CATALOG_PREFLIGHT_CONTRACT_V1" }],
    luna_catalog_snapshot_variants_v1: [{ product_id: "9220805492960",
      variant_id: "48809607364832", sku: "ITEM5827",
      canonical_url: "https://lunaportex.com/products/example",
      title: "American Flag Metal Trailer Hitch Cover",
      price: 16.4, availability: true, observed_at: "2026-09-15T17:55:21.486Z",
      source_fingerprint: sourceFingerprint,
      preflight_status: preflightStatus, preflight_reasons: [],
      field_truth_v1: fieldTruth,
      identity_result: { productFamily: "TRAILER_HITCH_COVER",
        identitySufficient: preflightStatus === "PREFLIGHT_PASS" } }],
  }
  let writes = 0
  const supabase = { from(table) {
    let single = false
    const builder = { select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
      maybeSingle() { single = true; return this }, then(resolve) {
        return Promise.resolve({ data: single ? (tables[table]?.[0] ?? null) : (tables[table] ?? []), error: null }).then(resolve)
      } }
    return builder
  }, get writes() { return writes } }
  return { supabase, writes: () => writes }
}

test("PREFLIGHT_PASS_NEW_CATALOG_PRODUCT_WITHOUT_OPPORTUNITY_QUEUE_ROW", async () => {
  const { supabase } = catalogSupabase()
  const result = await readSellerOsProductCaseAuditV1({ supabase, accountKey: "test",
    identityType: "SUPPLIER_SKU", identity: "ITEM5827", detailMode: "SUMMARY" })
  assert.deepEqual(result.RESOLVED_CANONICAL_IDENTITY, {
    candidateId: "LUNA_PORTEX:9220805492960:48809607364832:ITEM5827",
    sourceTraceId: null, sourceSnapshotId: "snapshot-current",
    sourceIdentityAuthority: "luna_catalog_snapshot_variants_v1",
    preflightStatus: "PREFLIGHT_PASS", sourceFingerprint: "sha256:catalog",
    opportunityId: null, productCaseId: null, lunaProductId: "9220805492960",
    lunaVariantId: "48809607364832", supplierSku: "ITEM5827", ebaySku: null,
    ebayItemId: null, packageId: null })
  assert.equal(result.PRODUCT_JOURNEY.find((stage) => stage.STAGE === "LUNA_SOURCE").STATUS, "PROVEN")
  assert.equal(result.PRODUCT_JOURNEY.find((stage) => stage.STAGE === "LUNA_SOURCE").SOURCE_AUTHORITY,
    "luna_catalog_snapshot_variants_v1")
})

test("snapshot-native durable field truth projects without a legacy opportunity row", async () => {
  const fieldTruth = { contractVersion: "LUNA_FIELD_PRODUCT_TRUTH_V1",
    sourceSnapshotId: "snapshot-current", sourceProductId: "9220805492960",
    sourceVariantId: "48809607364832", sourceSupplierSku: "ITEM5827",
    sourceCatalogFingerprint: "sha256:catalog",
    evidenceDigest: `sha256:${"a".repeat(64)}`, capturedAt: "2026-09-15T17:55:21.486Z",
    counts: { facts: 1, missing: 24, inferred: 0, contradicted: 0, supplierClaims: 0 },
    fields: [{ FIELD: "LUNA_PRODUCT_ID", VALUE: "9220805492960",
      SEMANTIC_CLASS: "FACT", EVIDENCE_STATUS: "PROVEN",
      SOURCE: "LUNA_EXACT_VARIANT", SOURCE_AUTHORITY: "SUPPLIER",
      SOURCE_EVIDENCE: [{ SOURCE_RECEIPT_ID: "snapshot-current" }],
      EVIDENCE_ID: `sha256:${"b".repeat(64)}`, OBSERVED_AT: "2026-09-15T17:55:21.486Z" }] }
  const { supabase } = catalogSupabase("PREFLIGHT_PASS", fieldTruth)
  const result = await readSellerOsProductCaseAuditV1({ supabase, accountKey: "test",
    identityType: "SUPPLIER_SKU", identity: "ITEM5827", detailMode: "SUMMARY" })
  assert.equal(result.PRODUCT_TRUTH_COMPLETENESS.STATUS, "PARTIAL")
  assert.equal(result.FIELD_TRUTH.find((entry) => entry.FIELD === "LUNA_PRODUCT_ID").VALUE,
    "9220805492960")
  assert.equal(result.PRODUCT_JOURNEY.find((stage) => stage.STAGE === "PRODUCT_TRUTH").SOURCE_AUTHORITY,
    "luna_catalog_snapshot_variants_v1.field_truth_v1")
})

test("PARTIAL Product Truth advances to the next stage when the exact Trace minimum is proven", async () => {
  const snapshotId = "snapshot-current"
  const productId = "9220805492960"
  const variantId = "48809607364832"
  const sku = "ITEM5827"
  const fingerprint = `sha256:${"c".repeat(64)}`
  const allFields = ["LUNA_PRODUCT_ID", "LUNA_VARIANT_ID", "SUPPLIER_SKU",
    "TITLE", "BRAND", "MODEL", "MATERIAL", "COLOR", "DIMENSIONS",
    "SIZE_SET", "WEIGHT", "PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT",
    "FORM_FACTOR", "FEATURES", "INTENDED_USES", "GTIN", "MPN",
    "SUPPLIER_COST", "REGULAR_PRICE", "SALE_PRICE", "SUPPLIER_AVAILABILITY",
    "SUPPLIER_STOCK", "IMAGES", "VARIANT_OPTIONS"]
  const requiredValues = { LUNA_PRODUCT_ID: productId,
    LUNA_VARIANT_ID: variantId, SUPPLIER_SKU: sku,
    TITLE: "American Flag Metal Trailer Hitch Cover", SUPPLIER_COST: 16.4,
    SUPPLIER_AVAILABILITY: "AVAILABLE" }
  const productReceipt = `luna_catalog:${snapshotId}:${productId}`
  const variantReceipt = `${productReceipt}:${variantId}`
  const productFields = new Set(["LUNA_PRODUCT_ID", "TITLE"])
  const fields = allFields.map((name) => name in requiredValues ? {
    FIELD: name, VALUE: requiredValues[name], SEMANTIC_CLASS: "FACT",
    EVIDENCE_STATUS: "PROVEN", CONTRADICTION: false,
    EVIDENCE_ID: `sha256:${"b".repeat(64)}`,
    OBSERVED_AT: "2026-09-15T17:55:21.486Z",
    FRESH_UNTIL: ["SUPPLIER_COST", "SUPPLIER_AVAILABILITY"].includes(name)
      ? "2026-09-16T17:55:21.486Z" : null,
    SOURCE_EVIDENCE: [{ EVIDENCE_ID: `sha256:${"d".repeat(64)}`,
      SOURCE_RECEIPT_ID: productFields.has(name)
        ? productReceipt : variantReceipt }],
  } : { FIELD: name, VALUE: null, SEMANTIC_CLASS: "MISSING",
    EVIDENCE_STATUS: "MISSING", CONTRADICTION: false,
    EVIDENCE_ID: null, SOURCE_EVIDENCE: [] })
  const fieldTruth = { contractVersion: "LUNA_FIELD_PRODUCT_TRUTH_V1",
    sourceAuthorityContract: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
    sourceSnapshotId: snapshotId, sourceProductId: productId,
    sourceVariantId: variantId, sourceSupplierSku: sku,
    sourceCatalogFingerprint: fingerprint,
    evidenceDigest: `sha256:${"a".repeat(64)}`, status: "PARTIAL",
    counts: { facts: 6, missing: 19, inferred: 0, contradicted: 0,
      supplierClaims: 0 }, fields }
  const { supabase } = catalogSupabase("PREFLIGHT_PASS", fieldTruth, fingerprint)
  const result = await readSellerOsProductCaseAuditV1({ supabase,
    accountKey: "test", identityType: "SUPPLIER_SKU", identity: sku,
    detailMode: "TRACE", now: new Date("2026-09-16T12:00:00Z") })
  assert.equal(result.PRODUCT_TRUTH_COMPLETENESS.STATUS, "PARTIAL")
  assert.equal(result.TRACE_PRODUCT_TRUTH_SUFFICIENT, "YES")
  assert.equal(result.TRACE_COMPATIBILITY, "YES")
  assert.notEqual(result.NEXT_BLOCKING_STAGE, "PRODUCT_TRUTH")
  assert.ok(result.FIELD_TRUTH.filter((entry) =>
    Object.keys(requiredValues).includes(entry.FIELD)).every((entry) =>
      entry.DOWNSTREAM_CONSUMERS.includes("COMMERCIAL_TRACE")))
  assert.equal(result.safety.databaseBusinessWrites, 0)
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("snapshot-native field truth with a mismatched binding fails closed", async () => {
  const { supabase } = catalogSupabase("PREFLIGHT_PASS", {
    contractVersion: "LUNA_FIELD_PRODUCT_TRUTH_V1",
    sourceSnapshotId: "wrong-snapshot", sourceProductId: "9220805492960",
    sourceVariantId: "48809607364832", sourceSupplierSku: "ITEM5827",
    sourceCatalogFingerprint: "sha256:catalog",
    evidenceDigest: `sha256:${"a".repeat(64)}` })
  const result = await readSellerOsProductCaseAuditV1({ supabase, accountKey: "test",
    identityType: "SUPPLIER_SKU", identity: "ITEM5827" })
  assert.equal(result.STATUS, "CONTRADICTED")
  assert.equal(result.CONTRADICTION, "LUNA_PRODUCT_TRUTH_BINDING_INVALID")
})

for (const [status, contradiction] of [
  ["SOURCE_IDENTITY_BLOCKED", "LUNA_SOURCE_IDENTITY_BLOCKED"],
  ["CONTRADICTED", "LUNA_IDENTITY_CONTRADICTED"],
  ["SEMANTIC_IDENTITY_INCOMPLETE", "LUNA_SEMANTIC_IDENTITY_INCOMPLETE"],
]) {
  test(`${status}_FAIL_CLOSED`, async () => {
    const { supabase } = catalogSupabase(status)
    const result = await readSellerOsProductCaseAuditV1({ supabase, accountKey: "test",
      identityType: "SUPPLIER_SKU", identity: "ITEM5827" })
    assert.equal(result.STATUS, "CONTRADICTED")
    assert.equal(result.CONTRADICTION, contradiction)
    assert.equal(result.RESOLVED_CANONICAL_IDENTITY, null)
  })
}

test("PRE_RESEARCH_NOT_REQUIRED_FOR_TRACE_IDENTITY", async () => {
  const { supabase } = catalogSupabase()
  const result = await readSellerOsProductCaseAuditV1({ supabase, accountKey: "test",
    identityType: "LUNA_PRODUCT_ID", identity: "9220805492960" })
  assert.equal(result.RESOLVED_CANONICAL_IDENTITY.supplierSku, "ITEM5827")
  assert.equal(result.RESOLVED_CANONICAL_IDENTITY.opportunityId, null)
})

test("documents progressive audit disclosure before repo inspection", () => {
  assert.deepEqual(SELLER_OS_CODEX_AUDIT_PROTOCOL_V1.slice(0, 3), [
    "seller_os_get_system_review_bundle",
    "seller_os_get_product_case",
    "seller_os_get_publication_execution when Publisher-related",
  ])
})
