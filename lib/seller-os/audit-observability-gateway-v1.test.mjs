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

test("documents progressive audit disclosure before repo inspection", () => {
  assert.deepEqual(SELLER_OS_CODEX_AUDIT_PROTOCOL_V1.slice(0, 3), [
    "seller_os_get_system_review_bundle",
    "seller_os_get_product_case",
    "seller_os_get_publication_execution when Publisher-related",
  ])
})
