import assert from 'node:assert/strict'
import test from 'node:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerGoldenPathControlToolsV1, GOLDEN_PATH_MCP_TOOL_NAMES_V1 } from './commercial-golden-path-mcp-v1.ts'
import { normalizeGoldenStoredMarketV1 } from './commercial-golden-path-runtime-v1.ts'

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
