import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer, readSellerOsControlRegisteredCatalogV1, SELLER_OS_CONTROL_SERVER_VERSION_V1 } from './teo-pre-research-control-mcp-v1.ts'
import { GOLDEN_PATH_MCP_TOOL_NAMES_V1 } from './commercial-golden-path-mcp-v1.ts'

test('actual Control SDK registration and tools/list agree on all eight Golden tools and seven legacy tools',async()=>{
 const issuer=process.env.SELLER_OS_CONTROL_OAUTH_ISSUER, resource=process.env.SELLER_OS_CONTROL_OAUTH_RESOURCE
 process.env.SELLER_OS_CONTROL_OAUTH_ISSUER='https://fixture.invalid/auth/v1'
 process.env.SELLER_OS_CONTROL_OAUTH_RESOURCE='https://fixture.invalid/api/seller-os/control/mcp'
 const server=createServer({ownerUserId:'fixture-owner',commandClientId:'fixture-client',scopes:['openid','profile']})
 const client=new Client({name:'SYNTHETIC_SCHEMA_DIAGNOSTIC_NOT_REAL_OAUTH',version:'1'})
 const originalFetch=globalThis.fetch;let calls=0
 globalThis.fetch=async()=>{calls++;throw Error('CATALOG_NETWORK_FORBIDDEN')}
 try{
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b)
  const list=await client.listTools(), diagnostic=readSellerOsControlRegisteredCatalogV1(server,process.env.SELLER_OS_CONTROL_OAUTH_RESOURCE)
  assert.equal(SELLER_OS_CONTROL_SERVER_VERSION_V1,'1.3.0')
  assert.equal(list.tools.length,15);assert.equal(diagnostic.toolCount,15)
  assert.deepEqual(diagnostic.toolNames,list.tools.map(t=>t.name).sort())
  assert.deepEqual(diagnostic.goldenToolNames,[...GOLDEN_PATH_MCP_TOOL_NAMES_V1].sort())
  assert.equal(diagnostic.goldenRegistrationStatus,'COMPLETE')
  assert.equal(diagnostic.discoveryScope,'SERVER_REGISTRY_NOT_CHATGPT_IMPORTED_CATALOG')
  assert.equal(diagnostic.marketplaceWriteCapability,'ABSENT');assert.equal(calls,0)
 }finally{
  globalThis.fetch=originalFetch;await client.close();await server.close()
  for(const [key,value] of [['SELLER_OS_CONTROL_OAUTH_ISSUER',issuer],['SELLER_OS_CONTROL_OAUTH_RESOURCE',resource]])if(value===undefined)delete process.env[key];else process.env[key]=value
 }
})
