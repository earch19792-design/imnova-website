import assert from 'node:assert/strict'
import test from 'node:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerGoldenPathControlToolsV1, GOLDEN_PATH_MCP_TOOL_NAMES_V1 } from './commercial-golden-path-mcp-v1.ts'
import { normalizeGoldenStoredMarketV1, importGoldenManualV1, importGoldenOwnerProductTruthV1, importGoldenVisualComparisonV1 } from './commercial-golden-path-runtime-v1.ts'
import { goldenDigest } from './commercial-golden-path-domain-v1.ts'

test('automatic source normalization never upgrades an ACTIVE or main-search visible price to realized SOLD',()=>{
  assert.equal(normalizeGoldenStoredMarketV1({source_class:'ACTIVE',source_type:'EBAY_BROWSE_ACTIVE',realized_price_status:'PROVEN'}),null)
  const main=normalizeGoldenStoredMarketV1({source_class:'MAIN_SEARCH_SOLD',source_type:'EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE',realized_price_status:'PROVEN'})
  assert.equal(main.realizedPriceStatus,'UNPROVEN')
})

test('MCP contract: eight bounded internal-receipt tools, no marketplace writer, fail closed before network', async () => {
  const server = new McpServer({name:'fixture-contract-only',version:'1'})
  const client = new Client({name:'fixture-contract-only',version:'1'})
  registerGoldenPathControlToolsV1(server,{ownerUserId:'fixture-owner',commandClientId:'fixture-client',scopes:[]},'https://fixture.invalid/mcp')
  const [a,b] = InMemoryTransport.createLinkedPair()
  const savedFetch = globalThis.fetch, savedAlias = process.env.EBAY_SELLER_ACCOUNT_KEY
  let outbound = 0
  globalThis.fetch = async () => { outbound++; throw Error('FIXTURE_NETWORK_FORBIDDEN') }
  delete process.env.EBAY_SELLER_ACCOUNT_KEY
  try {
    await server.connect(a); await client.connect(b)
    const {tools} = await client.listTools()
    assert.deepEqual(tools.map(t=>t.name),[...GOLDEN_PATH_MCP_TOOL_NAMES_V1])
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint,false)
      assert.equal(tool._meta.marketplaceWriteCapability,'ABSENT')
      assert.equal(tool.inputSchema.additionalProperties,false)
    }
    const preview = tools[0].inputSchema.properties
    assert.equal(preview.targetNetProfit.minimum,4)
    assert.equal(preview.limit.maximum,20)
    assert.ok(tools[2].inputSchema.properties.rows.items.required.includes('marketplace'))
    assert.equal(tools[2].inputSchema.properties.rows.items.properties.marketplace.const,'EBAY_US')
    assert.equal(tools[1].inputSchema.properties.ownerProvisionalFeePolicy.properties.operatorAttested.const,true)
    assert.equal(tools[4].inputSchema.properties.dryRun.default,true)
    assert.equal(tools[6].inputSchema.properties.operatorAttested.const,true)
    assert.deepEqual(tools[6].inputSchema.properties.observations.items.properties.factClass.enum,['VISIBLE_BRAND_MARKING','OBSERVED_MARKING'])
    assert.equal(tools[6].annotations.idempotentHint,true)
    assert.equal(tools[7].inputSchema.properties.operatorAttested.const,true)
    assert.deepEqual(tools[7].inputSchema.properties.supplierObservation.properties.sourceRole,{type:'string',const:'SUPPLIER_IMAGE'})
    assert.deepEqual(tools[7].inputSchema.properties.comparisons.items.properties.marketplaceObservation.properties.sourceRole.enum,['MARKETPLACE_SOLD_IMAGE','MARKETPLACE_ACTIVE_IMAGE'])
    assert.equal(tools[7].annotations.idempotentHint,true)
    const invalid = await client.callTool({name:tools[0].name,arguments:{category:'Personal Care',limit:21}})
    assert.equal(invalid.isError,true)
    const closed = await client.callTool({name:tools[0].name,arguments:{category:'Personal Care',limit:1,targetNetProfit:4}})
    assert.equal(closed.isError,true)
    assert.equal(closed.structuredContent.result.status,'UNPROVEN')
    assert.deepEqual(closed.structuredContent.result.reasonCodes,['GOLDEN_PATH_CANONICAL_ACCOUNT_REQUIRED'])
    assert.equal(outbound,0)
  } finally {
    globalThis.fetch=savedFetch
    if(savedAlias===undefined) delete process.env.EBAY_SELLER_ACCOUNT_KEY; else process.env.EBAY_SELLER_ACCOUNT_KEY=savedAlias
    await client.close(); await server.close()
  }
})

test('OWNER Product Truth intake is append-only, content-deduplicated and preserves every unknown field',async()=>{
 const candidate={productId:'9220801986784',variantId:'48809603137760',supplierSku:'ITEM6127',supplierQuantity:1}
 const fingerprint=goldenDigest('fixture-item6127-source')
 const canonicalUrl='https://lunaportex.com/products/safari-de-matting-comb'
 const source={snapshot_id:'10000000-0000-4000-8000-000000000001',snapshot_status:'COMPLETE',product_id:candidate.productId,variant_id:candidate.variantId,sku:candidate.supplierSku,source_fingerprint:fingerprint,canonical_url:canonicalUrl,preflight_status:'PREFLIGHT_PASS'}
 const tables={luna_catalog_snapshots_v1:[source],luna_catalog_snapshot_variants_v1:[source],seller_os_golden_owner_product_truth_v1:[],seller_os_golden_path_receipts_v1:[]}
 const from=table=>{
  let filters=[],values=null,maximum=Infinity
  const data=()=>tables[table].filter(row=>filters.every(filter=>filter(row))).filter(row=>!values||values.values.includes(row[values.key])).slice(0,maximum)
  const q={select(){return q},eq(key,value){filters.push(row=>row[key]===value);return q},in(key,selected){values={key,values:selected};return q},order(){return q},limit(value){maximum=value;return q},maybeSingle(){return Promise.resolve({data:data()[0]??null,error:null})},then(yes,no){return Promise.resolve({data:data(),error:null}).then(yes,no)},upsert(rows,options){for(const row of Array.isArray(rows)?rows:[rows]){const keys=options.onConflict.split(',');if(!tables[table].some(existing=>keys.every(key=>existing[key]===row[key])))tables[table].push({...structuredClone(row),created_at:'2026-10-03T18:05:00Z'})}return Promise.resolve({error:null})}}
  return q
 }
 const ctx={accountKey:'fixture-account',principal:{ownerUserId:'10000000-0000-4000-8000-000000000002',commandClientId:'fixture-client',scopes:[]},invocationSource:'SERVICE_CERTIFICATION_DIAGNOSTIC',now:new Date('2026-10-03T18:05:00Z'),supabase:{from}}
 const ownerSource={canonicalUrl,sourceLocator:canonicalUrl,sourceDigest:'sha256:8cbf84a8b878a93685448142be80af2afdcdc5260ba517500095c504807240c0',capturedAt:'2026-10-03T16:41:37.0224509Z',sourceMediaType:'IMAGE'}
 const observations=[{factClass:'VISIBLE_BRAND_MARKING',value:'SAFARI',evidenceStatement:'OWNER confirms the supplier image visibly shows SAFARI on the physical comb.'}]
 const first=await importGoldenOwnerProductTruthV1(ctx,candidate,ownerSource,observations)
 const replay=await importGoldenOwnerProductTruthV1(ctx,candidate,ownerSource,observations)
 assert.equal(tables.seller_os_golden_owner_product_truth_v1.length,1)
 assert.equal(tables.seller_os_golden_path_receipts_v1.length,1)
 assert.equal(first.durableReceipt.readback,'PASS')
 assert.equal(replay.durableReceipt.receiptId,first.durableReceipt.receiptId)
 assert.equal(first.supplierTruthModified,false)
 assert.equal(first.manufacturerBrandPromoted,false)
 assert.equal(first.unknownFieldsPromoted,false)
 assert.deepEqual(first.unknownFields,['MANUFACTURER_BRAND','UPC','GTIN','MPN','MODEL','PACK_COUNT'])
 const payload=tables.seller_os_golden_owner_product_truth_v1[0].payload
 assert.equal(payload.normalizedValue,'SAFARI')
 assert.equal(payload.capturedAt,'2026-10-03T16:41:37.0224509Z')
 assert.equal(payload.manufacturerBrandPromoted,false)
 assert.equal(payload.supplierTruthModified,false)
 assert.equal(payload.marketplaceWrites,0)
 assert.equal(payload.supplierPurchases,0)
 assert.equal(payload.draftIsLive,false)
 assert.deepEqual(source,tables.luna_catalog_snapshot_variants_v1[0])
 await assert.rejects(importGoldenOwnerProductTruthV1(ctx,candidate,{...ownerSource,canonicalUrl:'https://example.com/products/safari'},observations),/OWNER_PRODUCT_TRUTH_EVIDENCE_INVALID/)
})

test('visual comparison intake binds existing market evidence and returns durable readback',async()=>{
 const candidate={productId:'9220801986784',variantId:'48809603137760',supplierSku:'ITEM6127',supplierQuantity:1}
 const fingerprint=goldenDigest('fixture-item6127-visual-source')
 const canonicalUrl='https://lunaportex.com/products/safari-de-matting-comb'
 const source={snapshot_id:'10000000-0000-4000-8000-000000000001',snapshot_status:'COMPLETE',product_id:candidate.productId,variant_id:candidate.variantId,sku:candidate.supplierSku,source_fingerprint:fingerprint,canonical_url:canonicalUrl,preflight_status:'PREFLIGHT_PASS'}
 const marketPayload={evidenceId:goldenDigest('fixture-market-evidence'),source:'OWNER_ATTESTED_MANUAL_TERAPEAK',sourceLocator:'https://www.ebay.com/sh/research?fixture=visual',sourceDigest:goldenDigest('fixture-market-screenshot'),listingState:'SOLD',identity:{productName:'2 Pack Safari De-Matting Comb',packCount:2},requestedClassification:'CLOSE',reviewed:true,reviewReason:'Fixture market comparison',soldQuantity:1,realizedSoldPrice:31.99,buyerShipping:15.43,currency:'USD',lastSoldDate:'2026-09-18T00:00:00Z',capturedAt:'2026-10-03T16:45:00Z',realizedPriceStatus:'PROVEN'}
 const tables={luna_catalog_snapshots_v1:[source],luna_catalog_snapshot_variants_v1:[source],marketplace_sold_evidence_observations:[],seller_os_golden_manual_market_v1:[{account_key:'fixture-account',owner_user_id:'10000000-0000-4000-8000-000000000002',product_id:candidate.productId,variant_id:candidate.variantId,supplier_sku:candidate.supplierSku,supplier_quantity:1,payload:marketPayload}],seller_os_golden_visual_comparison_v1:[],seller_os_golden_path_receipts_v1:[]}
 const from=table=>{
  let filters=[],values=null,maximum=Infinity
  const data=()=>tables[table].filter(row=>filters.every(filter=>filter(row))).filter(row=>!values||values.values.includes(row[values.key])).slice(0,maximum)
  const q={select(){return q},eq(key,value){filters.push(row=>row[key]===value);return q},gte(){return q},in(key,selected){values={key,values:selected};return q},order(){return q},limit(value){maximum=value;return q},maybeSingle(){return Promise.resolve({data:data()[0]??null,error:null})},then(yes,no){return Promise.resolve({data:data(),error:null}).then(yes,no)},upsert(rows,options){for(const row of Array.isArray(rows)?rows:[rows]){const keys=options.onConflict.split(',');if(!tables[table].some(existing=>keys.every(key=>existing[key]===row[key])))tables[table].push({...structuredClone(row),created_at:'2026-10-03T18:40:00Z'})}return Promise.resolve({error:null})}}
  return q
 }
 const ctx={accountKey:'fixture-account',principal:{ownerUserId:'10000000-0000-4000-8000-000000000002',commandClientId:'fixture-client',scopes:[]},invocationSource:'SERVICE_CERTIFICATION_DIAGNOSTIC',now:new Date('2026-10-03T18:40:00Z'),supabase:{from}}
 const visible=(factClass,value,confidence='HIGH')=>({factClass,value,confidence,evidenceStatement:`Fixture visual observation records ${factClass} as ${value}.`})
 const supplierObservation={sourceRole:'SUPPLIER_IMAGE',mediaReference:'sha256:fixture-supplier',sourceLocator:canonicalUrl,sourceDigest:'sha256:8cbf84a8b878a93685448142be80af2afdcdc5260ba517500095c504807240c0',capturedAt:'2026-10-03T16:41:37.0224509Z',method:'OWNER_REVIEWED',methodVersion:'OWNER_VISUAL_REVIEW_V1',imageWidthPixels:738,imageHeightPixels:739,subjectRegionWidthPixels:680,subjectRegionHeightPixels:680,cropStatus:'FULL_FRAME',facts:[visible('VISIBLE_BRAND_MARKING','SAFARI'),visible('PRODUCT_SHAPE','CURVED COMB HEAD')]}
 const marketplaceObservation={sourceRole:'MARKETPLACE_SOLD_IMAGE',mediaReference:`${marketPayload.sourceDigest}#region=ROW_1_THUMBNAIL`,sourceLocator:marketPayload.sourceLocator,sourceDigest:marketPayload.sourceDigest,capturedAt:marketPayload.capturedAt,method:'OWNER_REVIEWED',methodVersion:'OWNER_VISUAL_REVIEW_V1',imageWidthPixels:1661,imageHeightPixels:538,subjectRegionWidthPixels:97,subjectRegionHeightPixels:97,cropStatus:'FULL_FRAME',facts:[visible('VISIBLE_TEXT','2 PACK'),visible('VISIBLE_PACKAGING','TWO COMBS'),visible('EXPLICIT_OFFER_QUANTITY','2')]}
 const relations=[{factClass:'EXPLICIT_OFFER_QUANTITY',relation:'CONFLICT',confidence:'HIGH',evidenceStatement:'The marketplace image explicitly signals two units while the candidate is one supplier unit.'}]
 const comparisons=[{marketEvidenceId:marketPayload.evidenceId,marketplaceObservation,relations}]
 const first=await importGoldenVisualComparisonV1(ctx,candidate,supplierObservation,comparisons)
 const replay=await importGoldenVisualComparisonV1(ctx,candidate,supplierObservation,comparisons)
 assert.equal(tables.seller_os_golden_visual_comparison_v1.length,1)
 assert.equal(tables.seller_os_golden_path_receipts_v1.length,1)
 assert.equal(first.durableReceipt.readback,'PASS')
 assert.equal(replay.durableReceipt.receiptId,first.durableReceipt.receiptId)
 assert.equal(first.outcomes[0].outcome,'CONTRADICTS')
 assert.equal(first.visualAuthority,'CLOSE_SUPPORT_OR_CONTRADICTION_NEVER_EXACT')
 assert.equal(first.supplierTruthModified,false)
 assert.equal(first.manufacturerBrandInferred,false)
 assert.equal(first.safety.marketplaceWrites,0)
})

 test('manual intake rejects inconsistent SOLD/ACTIVE rows before any evidence write',async()=>{
  let writes=0
  const query=(data)=>{const q={select(){return q},eq(){return q},order(){return q},limit(){return q},maybeSingle(){return Promise.resolve({data:data[0],error:null})},then(yes,no){return Promise.resolve({data,error:null}).then(yes,no)},upsert(){writes++;throw Error('WRITE_FORBIDDEN')}};return q}
  const candidate={productId:'1',variantId:'2',supplierSku:'FIXTURE',supplierQuantity:1}
  const ctx={accountKey:'fixture',now:new Date('2026-10-03T03:00:00Z'),principal:{ownerUserId:'fixture',commandClientId:'fixture',scopes:[]},supabase:{from(table){return query(table==='luna_catalog_snapshots_v1'?[{snapshot_id:'fixture'}]:[{product_id:'1',variant_id:'2',sku:'FIXTURE'}])}}}
  const row={marketplace:'EBAY_US',sourceLocator:'fixture://manual',sourceDigest:'sha256:'+'a'.repeat(64),listingState:'SOLD',identity:{productName:'Fixture',packCount:1},reviewReason:'Fixture comparison only',soldQuantity:1,realizedSoldPrice:10,buyerShipping:0,currency:'USD',lastSoldDate:'2026-10-03T02:00:00Z',capturedAt:'2026-10-03T02:30:00Z',realizedPriceStatus:'PROVEN'}
  await assert.rejects(importGoldenManualV1(ctx,candidate,[row,{...row,capturedAt:'2026-10-03T01:00:00Z'}]),/MANUAL_SOLD_QUANTITY_PRICE_DATE_REQUIRED/)
  await assert.rejects(importGoldenManualV1(ctx,candidate,[row,{...row,listingState:'ACTIVE',soldQuantity:null,lastSoldDate:null,realizedPriceStatus:'UNPROVEN'}]),/ACTIVE_IS_NOT_SOLD/)
  await assert.rejects(importGoldenManualV1(ctx,candidate,[{...row,marketplace:undefined}]),/MANUAL_MARKETPLACE_EBAY_US_REQUIRED/)
  await assert.rejects(importGoldenManualV1(ctx,candidate,[{...row,marketplace:'EBAY_GB'}]),/MANUAL_MARKETPLACE_EBAY_US_REQUIRED/)
  assert.equal(writes,0)
 })

test('synthetic intake storage preserves marketplace/title/provenance, SOLD landed price, ACTIVE separation and replay deduplication',async()=>{
 const candidate={productId:'1',variantId:'2',supplierSku:'FIXTURE-ONLY',supplierQuantity:1}
 const source={snapshot_id:'fixture',product_id:'1',variant_id:'2',sku:'FIXTURE-ONLY'}
 const tables={luna_catalog_snapshots_v1:[{snapshot_id:'fixture',snapshot_status:'COMPLETE'}],luna_catalog_snapshot_variants_v1:[source],seller_os_golden_manual_market_v1:[],seller_os_golden_path_receipts_v1:[]}
 const before=structuredClone(source)
 const from=table=>{
  let filters=[],maximum=Infinity
  const data=()=>tables[table].filter(r=>filters.every(f=>f(r))).slice(0,maximum)
  const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,vs){filters.push(r=>vs.includes(r[k]));return q},order(){return q},limit(n){maximum=n;return q},maybeSingle(){return Promise.resolve({data:data()[0]??null,error:null})},then(a,b){return Promise.resolve({data:data(),error:null}).then(a,b)},upsert(rows,options){for(const row of Array.isArray(rows)?rows:[rows]){const keys=options.onConflict.split(',');if(!tables[table].some(r=>keys.every(k=>r[k]===row[k])))tables[table].push({...structuredClone(row),created_at:'2026-10-03T06:00:00Z'})}return Promise.resolve({error:null})}}
  return q
 }
 const ctx={accountKey:'fixture-account',principal:{ownerUserId:'fixture-owner',commandClientId:'fixture-client',scopes:[]},invocationSource:'SERVICE_CERTIFICATION_DIAGNOSTIC',now:new Date('2026-10-03T06:00:00Z'),supabase:{from}}
 const sold={marketplace:'EBAY_US',sourceLocator:'fixture://sold-row',sourceDigest:goldenDigest('synthetic-sold-document'),listingState:'SOLD',identity:{productName:'Synthetic observed listing title',packCount:1},requestedClassification:'CLOSE',reviewReason:'Synthetic comparable review only',soldQuantity:4,realizedSoldPrice:20,buyerShipping:2,currency:'USD',lastSoldDate:'2026-10-02T00:00:00Z',capturedAt:'2026-10-03T05:00:00Z',realizedPriceStatus:'PROVEN'}
 const active={...sold,sourceLocator:'fixture://active-row',listingState:'ACTIVE',soldQuantity:null,realizedSoldPrice:null,activeListingPrice:99,buyerShipping:0,lastSoldDate:null,realizedPriceStatus:'UNPROVEN'}
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('INTAKE_EXTERNAL_WRITE_FORBIDDEN')}
 try{
  const first=await importGoldenManualV1(ctx,candidate,[sold,active])
  const repeat=await importGoldenManualV1(ctx,candidate,[sold,active])
  assert.equal(first.durableReceipt.readback,'PASS');assert.equal(repeat.durableReceipt.receiptId,first.durableReceipt.receiptId)
  assert.equal(tables.seller_os_golden_manual_market_v1.length,2)
  const observed=first.importedEvidence.map(r=>r.payload)
  assert.equal(observed[0].marketplace,'EBAY_US');assert.equal(observed[0].listingTitle,sold.identity.productName)
  assert.equal(observed[0].sourceDigest,sold.sourceDigest);assert.equal(observed[0].buyerLandedPrice,22)
  assert.equal(observed[1].buyerLandedPrice,null);assert.equal(observed[1].activeListingPrice,99)
  assert.deepEqual(source,before);assert.equal(first.supplierTruthModified,false);assert.equal(first.safety.marketplaceWrites,0)
 }finally{globalThis.fetch=originalFetch}
})
