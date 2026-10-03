import assert from 'node:assert/strict'
import test from 'node:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerGoldenPathControlToolsV1, GOLDEN_PATH_MCP_TOOL_NAMES_V1 } from './commercial-golden-path-mcp-v1.ts'
import { normalizeGoldenStoredMarketV1, importGoldenManualV1 } from './commercial-golden-path-runtime-v1.ts'
import { goldenDigest } from './commercial-golden-path-domain-v1.ts'

test('automatic source normalization never upgrades an ACTIVE or main-search visible price to realized SOLD',()=>{
  assert.equal(normalizeGoldenStoredMarketV1({source_class:'ACTIVE',source_type:'EBAY_BROWSE_ACTIVE',realized_price_status:'PROVEN'}),null)
  const main=normalizeGoldenStoredMarketV1({source_class:'MAIN_SEARCH_SOLD',source_type:'EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE',realized_price_status:'PROVEN'})
  assert.equal(main.realizedPriceStatus,'UNPROVEN')
})

test('MCP contract: six bounded internal-receipt tools, no marketplace writer, fail closed before network', async () => {
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
