import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { projectLunaFieldTruthV1 } from '../lib/seller-os/luna-field-truth-projection-v1.ts'
import { captureLunaExplicitProductFieldsV1 } from '../lib/luna-product-source-fields-v1.ts'

// Isolated PostgreSQL, no production credentials/network or product fixtures.
const moduleRoot = process.env.LUNA_TEST_PGLITE_ROOT
const { PGlite } = await import(moduleRoot ? pathToFileURL(`${moduleRoot}/dist/index.js`) : '@electric-sql/pglite')
const { pgcrypto } = await import(moduleRoot ? pathToFileURL(`${moduleRoot}/dist/contrib/pgcrypto.js`) : '@electric-sql/pglite/contrib/pgcrypto')
const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`create schema extensions; create extension pgcrypto with schema extensions;
  create role anon; create role authenticated; create role service_role;
  create table market_radar_sources(id uuid primary key,key text);
  create table market_radar_products(id uuid primary key,source_id uuid,supplier_product_id text,
    product_url text,title text,body_html text,metadata jsonb,image_urls jsonb,
    last_snapshot_at timestamptz,updated_at_source timestamptz);
  create table market_radar_snapshots(id uuid primary key,product_id uuid,supplier_variant_id text,
    sku text,price numeric,compare_at_price numeric,barcode text,available boolean,
    inventory_quantity integer,weight numeric,weight_unit text,raw jsonb,captured_at timestamptz,
    source_observed_at timestamptz);
  create table market_radar_current_variant_snapshots(product_id uuid,supplier_variant_id text,snapshot_id uuid);
  create table ebay_listing_packages(id uuid primary key,candidate_key text,package_data jsonb,updated_at timestamptz);
  create table ebay_luna_opportunity_queue(id uuid primary key,candidate_key text,market_radar_product_id uuid,
    supplier_product_id text,supplier_variant_id text,supplier_sku text,assessment jsonb,decision text);`)
const p = { id: '10000000-0000-4000-8000-000000000001', source_id: '10000000-0000-4000-8000-000000000002',
  supplier_product_id: '1234567890123', product_url: 'https://lunaportex.com/products/test-funnels',
  title: '3-piece nylon funnel set', metadata: {},
  body_html: '<h3>Product Specifications</h3><ul><li>Material: Nylon</li><li>Color: Blue</li><li>Sizes Included: 2 cm, 6 cm, 9 cm</li></ul><h3>Key Features</h3><ul><li>Premium dishwasher safe finish</li></ul>',
  image_urls: ['https://cdn.example.test/a.jpg','https://cdn.example.test/b.jpg'],
  last_snapshot_at: '2026-08-01T12:00:00Z', updated_at_source: '2026-08-01T11:59:00Z' }
const s = { id: '20000000-0000-4000-8000-000000000001', product_id: p.id,
  supplier_variant_id: '2234567890123', sku: 'TEST42', price: 7, compare_at_price: 10,
  available: true, inventory_quantity: null, weight: 200, weight_unit: 'g',
  raw: { variant: { option1: 'Blue', featured_image: {src: p.image_urls[1]} },
    inventory_context: {inventory_scope: 'availability_only'} }, captured_at: p.last_snapshot_at }
const expected = { lunaProductId: p.supplier_product_id, lunaVariantId: s.supplier_variant_id, supplierSku: s.sku }
const q = { id: '30000000-0000-4000-8000-000000000001', candidate_key: 'test-candidate',
  market_radar_product_id: p.id, supplier_product_id: p.supplier_product_id,
  supplier_variant_id: s.supplier_variant_id, supplier_sku: s.sku,
  assessment: { originalReceipt: {opaque: 'unchanged'}, productTruth: {evidenceDigest: 'legacy-immutable'} }, decision: 'HOLD' }
async function insert(table, obj) {
  await db.query(`insert into ${table} select * from jsonb_populate_record(null::${table},$1::jsonb)`,[JSON.stringify(obj)])
}
await insert('market_radar_sources',{id:p.source_id,key:'lunaportex'})
await insert('market_radar_products',p)
await insert('market_radar_snapshots',s)
await insert('market_radar_current_variant_snapshots',{product_id:p.id,supplier_variant_id:s.supplier_variant_id,snapshot_id:s.id})
await insert('ebay_luna_opportunity_queue',q)
await db.exec(await readFile(new URL('../supabase/migrations/20260908002125_luna_product_truth_field_parity_v1.sql',import.meta.url),'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260908004733_luna_product_truth_multiline_evidence_v1.sql',import.meta.url),'utf8'))
async function derive(product=p,snapshot=s,pkg={}) {
  return (await db.query('select derive_luna_field_truth_v1($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) r',
    [product,snapshot,expected,pkg].map(JSON.stringify))).rows[0].r
}
const truth = await derive()
assert.equal((await derive(p,{...s,raw:{...s.raw,variant:{...s.raw.variant,price:'7.00'}}})).fields.find(x=>x.FIELD==='SUPPLIER_COST').SEMANTIC_CLASS,'FACT')
const f = (name,t=truth) => t.fields.find(x=>x.FIELD===name)
function pass(name,fn) { fn(); console.log(name) }
pass('PASS_SOURCE_FIELD_PERSISTS_TO_PRODUCT_TRUTH',()=>assert.equal(f('MATERIAL').VALUE,'Nylon'))
pass('PASS_MISSING_SOURCE_REMAINS_MISSING',()=>assert.equal(f('GTIN').SEMANTIC_CLASS,'MISSING'))
pass('PASS_SUPPLIER_CLAIM_NOT_PROMOTED_TO_FACT',()=>assert.equal(f('FEATURES').SEMANTIC_CLASS,'SUPPLIER_CLAIM'))
pass('PASS_STRUCTURED_SIZE_SET_PRESERVED',()=>assert.deepEqual(f('SIZE_SET').VALUE.map(x=>[x.NORMALIZED_VALUE,x.UNIT]),[[2,'cm'],[6,'cm'],[9,'cm']]))
pass('PASS_PACKAGE_COUNT_PRESERVED',()=>assert.equal(f('QUANTITY_OR_SET_COUNT').VALUE,3))
pass('PASS_NUMERIC_STOCK_NOT_INVENTED',()=>assert.equal(f('SUPPLIER_STOCK').VALUE,null))
pass('PASS_AVAILABLE_WITHOUT_QUANTITY_REMAINS_QUANTITY_UNPROVEN',()=>{
  assert.equal(f('SUPPLIER_AVAILABILITY').VALUE,'AVAILABLE');assert.equal(f('SUPPLIER_STOCK').QUANTITY_STATUS,'QUANTITY_UNPROVEN')
})
const downstream = await derive(p,s,{brand:'Wrong Brand',model:'Reference Model',mpn:'REF-42'})
pass('PASS_BRAND_NOT_INFERRED_FROM_UNSUPPORTED_DOWNSTREAM_PACKAGE',()=>{
  assert.equal(f('BRAND',downstream).SEMANTIC_CLASS,'MISSING');assert.equal(downstream.unsupportedDownstreamValues.length,3)
})
pass('PASS_MODEL_MPN_NOT_INHERITED_FROM_REFERENCE',()=>{
  assert.equal(f('MODEL',downstream).VALUE,null);assert.equal(f('MPN',downstream).VALUE,null)
})
const conflict = await derive({...p,metadata:{source_product_fields_v1:{color:'Red'}}})
pass('PASS_CONTRADICTION_PRESERVED',()=>{
  assert.equal(f('COLOR',conflict).SEMANTIC_CLASS,'CONTRADICTED');assert.equal(f('COLOR',conflict).VALUE,null)
  assert.equal(f('COLOR',conflict).CONFLICTING_EVIDENCE_IDS.length,2)
})
assert.deepEqual(captureLunaExplicitProductFieldsV1({brand:'Explicit',vendor:'Supplier',ownerEmail:'private',model:'M1'}),{brand:'Explicit',model:'M1'})
const multiline=await derive({...p,body_html:'<h3>Features</h3>\\n<ul>\\n<li>\\n<strong>Finish:</strong> Rust resistant\\n</li>\\n</ul>'},s,{aspects:{Brand:'Unsupported Brand'}})
assert.equal(f('FEATURES',multiline).SEMANTIC_CLASS,'SUPPLIER_CLAIM')
assert.deepEqual(f('FEATURES',multiline).VALUE,['Finish: Rust resistant'])
assert.equal(multiline.unsupportedDownstreamValues[0].FIELD,'BRAND')
console.log('PASS_MULTILINE_CLAIMS_AND_PACKAGE_ASPECT_DIAGNOSTIC')
pass('PASS_IMAGE_PROVENANCE_PRESERVED',()=>{
  assert.deepEqual(f('IMAGES').VALUE.map(x=>x.SOURCE_IMAGE_URL),p.image_urls)
  assert.equal(f('IMAGES').VALUE[0].VARIANT_ASSOCIATION_IF_PROVEN,null)
  assert.equal(f('IMAGES').VALUE[1].VARIANT_ASSOCIATION_IF_PROVEN,s.supplier_variant_id)
  assert.ok(f('IMAGES').VALUE[1].CAPTURED_AT)
})
const recovery = (await db.query('select recover_luna_product_truth_parity_v1() r')).rows[0].r
pass('PASS_EXISTING_COHORT_RECOVERY',()=>assert.equal(recovery.recoveredCount,0))
const stored = (await db.query('select assessment,decision from ebay_luna_opportunity_queue')).rows[0]
assert.equal(stored.assessment.productTruth.fieldTruthV1.fields.length,25)
const repeat = (await db.query('select recover_luna_product_truth_parity_v1() r')).rows[0].r
pass('PASS_REPROCESS_IDEMPOTENT',()=>assert.equal(repeat.recoveredCount,0))
await db.query('update ebay_luna_opportunity_queue set assessment=$1',[JSON.stringify(q.assessment)])
const afterLegacyWrite = (await db.query('select assessment,decision from ebay_luna_opportunity_queue')).rows[0]
pass('PASS_EXISTING_RECEIPTS_IMMUTABLE',()=>assert.deepEqual(afterLegacyWrite,stored))
const projection = projectLunaFieldTruthV1(truth,new Date('2026-08-01T13:00:00Z'))
pass('PASS_PRODUCT_CASE_FIELD_PARITY',()=>{
  assert.equal(projection.status,'PARTIAL')
  for(const field of truth.fields) for(const [key,value] of Object.entries(field))
    assert.deepEqual(projection.fields.find(x=>x.FIELD===field.FIELD)[key],value)
})
const stale = projectLunaFieldTruthV1(truth,new Date('2026-08-03T13:00:00Z'))
assert.equal(stale.fields.find(x=>x.FIELD==='SUPPLIER_COST').DOWNSTREAM_CONSUMABLE,false)
// Both normal catalog triggers must see the new row in the same transaction.
await db.query("update market_radar_products set body_html=body_html||'<li>Brand: Source Brand</li>', last_snapshot_at='2026-08-02T12:00:00Z' where id=$1",[p.id])
let updated=(await db.query('select assessment from ebay_luna_opportunity_queue')).rows[0].assessment
assert.equal(f('BRAND',updated.productTruth.fieldTruthV1).VALUE,'Source Brand')
const s2={...s,id:'20000000-0000-4000-8000-000000000002',available:false,captured_at:'2026-08-02T13:00:00Z'}
await insert('market_radar_snapshots',s2)
await db.query('update market_radar_current_variant_snapshots set snapshot_id=$1',[s2.id])
updated=(await db.query('select assessment from ebay_luna_opportunity_queue')).rows[0].assessment
assert.equal(f('SUPPLIER_AVAILABILITY',updated.productTruth.fieldTruthV1).VALUE,'OUT_OF_STOCK')
const history=updated.productTruth.fieldTruthHistoryV1
assert.deepEqual(history.slice(0,stored.assessment.productTruth.fieldTruthHistoryV1.length),stored.assessment.productTruth.fieldTruthHistoryV1)
await insert('ebay_luna_opportunity_queue',{...q,id:'30000000-0000-4000-8000-000000000002',candidate_key:'second-candidate',market_radar_product_id:null})
const second=(await db.query("select assessment from ebay_luna_opportunity_queue where candidate_key='second-candidate'")).rows[0].assessment
assert.equal(second.productTruth.fieldTruthV1.fields.length,25)
console.log('PASS_NORMAL_SOURCE_TRIGGERS_AND_NULL_CACHED_ID')
await assert.rejects(()=>derive(p,{...s,sku:'OTHER'}),/EXACT_SOURCE_BINDING_INVALID/)
await db.close()
