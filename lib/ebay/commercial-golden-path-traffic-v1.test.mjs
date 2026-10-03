import assert from 'node:assert/strict'
import test from 'node:test'
import { readGoldenTrafficWindowsV1 } from './commercial-golden-path-traffic-v1.ts'
import { getEbaySellerAccountScopeConfiguration } from './ebay-seller-account-scope.ts'

test('targeted traffic reads exactly 24H/7D/30D UTC; absent rows/errors never become zero', async () => {
  const keys=['EBAY_SELLER_ACCOUNT_KEY','EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID','EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT','EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT']
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
  process.env.EBAY_SELLER_ACCOUNT_KEY='FIXTURE';process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID='FIXTURE_OWNER'
  delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT;delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
  try {
    const input={accountKey:getEbaySellerAccountScopeConfiguration().accountKey,itemId:'999999999999',now:new Date('2026-10-03T04:00:00Z')}
    const requests=[]
    const reader=async request=>{requests.push(request);return {startDate:request.dateFrom,endDate:request.dateTo,lastUpdatedDate:'2026-10-03T00:00:00Z',warnings:[],header:{dimensionKeys:[{key:'LISTING'}],metrics:[{key:'TOTAL_IMPRESSION_TOTAL'},{key:'LISTING_VIEWS_TOTAL'},{key:'TRANSACTION'}]},records:[{dimensionValues:[{value:input.itemId}],metricValues:[0,0,0].map(value=>({value,applicable:true}))}]}}
    const good=await readGoldenTrafficWindowsV1(input,reader)
    assert.deepEqual(requests.map(r=>r.dateFrom),['2026-10-02','2026-09-26','2026-09-03'])
    assert.ok(requests.every(r=>r.timeZone==='UTC'&&r.listingIds.length===1))
    assert.equal(good.snapshots.length,3);assert.equal(good.snapshots[0].transactions,0)
    for(const badReader of [async()=>{throw Error('TEST_SOURCE_UNAVAILABLE')},async req=>({...await reader(req),records:[]}),async req=>({...await reader(req),startDate:'2026-09-01'})]) {
      const bad=await readGoldenTrafficWindowsV1(input,badReader)
      assert.equal(bad.snapshots.length,0);assert.equal(bad.limitations.length,3)
    }
    const wrong=await readGoldenTrafficWindowsV1({...input,accountKey:'WRONG'},async()=>{throw Error('MUST_NOT_CALL')})
    assert.equal(wrong.snapshots.length,0)
  } finally {for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}}
})
