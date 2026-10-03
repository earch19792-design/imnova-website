import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { readGoldenPresaleAuthorityV1 } from './commercial-golden-path-presale-authority-v1.ts'

test('standalone pre-sale candidate authority cannot create a package or guess missing truth/bounds', async () => {
  const saved=globalThis.fetch;let requests=0
  globalThis.fetch=async()=>{requests++;throw Error('TEST_NETWORK_FORBIDDEN')}
  try {
    const result=await readGoldenPresaleAuthorityV1({supabase:{from(){throw Error('TEST_DATABASE_FORBIDDEN')}},accountKey:'FIXTURE_ONLY',candidate:{productId:'1',variantId:'2',supplierSku:'FIXTURE_ONLY',supplierQuantity:2},source:null,price:20})
    assert.equal(result.category.status,'UNPROVEN');assert.equal(result.fee.status,'UNPROVEN');assert.equal(requests,0)
    const source=readFileSync(new URL('./commercial-golden-path-presale-authority-v1.ts',import.meta.url),'utf8')
    assert.doesNotMatch(source,/\.from\(["'](?:ebay_listing_packages|ebay_luna_opportunity_queue)["']/)
    assert.doesNotMatch(source,/\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/)
    assert.match(source,/produceEbayFeeAuthorityV1/)
    assert.match(source,/listingPackageCreated: false/)
    assert.match(source,/PROVEN_PRE_SALE/)
    assert.match(source,/OFFICIAL_PRE_SALE_EXPOSURE_BOUND_UNPROVEN/)
  } finally {globalThis.fetch=saved}
})
