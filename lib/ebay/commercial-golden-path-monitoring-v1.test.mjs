import assert from 'node:assert/strict'
import test from 'node:test'
import { projectGoldenMonitoringV1 } from './commercial-golden-path-monitoring-v1.ts'
const now = new Date('2026-10-03T04:00:00Z')
const input = { accountKey: 'FIXTURE', itemId: '999999999999', now, snapshots: [], readAvailable: true, stock: {} }
const row = { id: 'FIXTURE_ONLY', marketplace_account_key: 'FIXTURE', marketplace: 'EBAY_US', listing_id: input.itemId, window_start: '2026-10-02', window_end: '2026-10-02', observed_at: now.toISOString(), completeness_status: 'complete', source: { queryTimeZone:'UTC', analytics: 'EBAY_SELL_ANALYTICS_TRAFFIC_REPORT', syntheticFallbackUsed: false, fixtureEvidenceUsed: false }, impressions: 0, views: 0, external_views: 0, transactions: 0 }
test('missing, unavailable, stale and mismatched windows never become zeros', () => {
  for (const changes of [{ snapshots: [] }, { readAvailable: false }, { snapshots: [{...row, window_start:'2026-10-01'}] }, { snapshots:[{...row, observed_at:'2026-09-01T00:00:00Z'}] }, { snapshots:[{...row, marketplace_account_key:'OTHER'}] }]) {
    const r = projectGoldenMonitoringV1({...input,...changes})
    assert.equal(r.windows['24H'].impressions,null); assert.equal(r.windows['24H'].unitsSold,null); assert.equal(r.state,'UNPROVEN')
  }
})
test('an exact observed zero is preserved; sales units never become orders or realized profit', () => {
  const r = projectGoldenMonitoringV1({...input, snapshots:[row]})
  assert.equal(r.windows['24H'].impressions,0); assert.equal(r.windows['24H'].unitsSold,0)
  assert.equal(r.windows['24H'].orders,null); assert.equal(r.windows['24H'].netProfit,null)
  assert.equal(r.windows['7D'].impressions,null); assert.equal(r.automaticEndAllowed,false)
})
test('eBay views exclude separately proven external views; stock risk only uses certified fresh evidence', () => {
  const r = projectGoldenMonitoringV1({...input, snapshots:[{...row,views:20,external_views:5,source:{...row.source,calculatedCtrApplicable:true,calculatedCtrNumerator:10,calculatedCtrDenominator:100},transactions:2}],stock:{supplierLinkage:'CERTIFIED',stockFreshness:'FRESH',supplierAvailability:'OUT_OF_STOCK'}})
  assert.equal(r.windows['24H'].ebayViews,15); assert.equal(r.windows['24H'].ctr,10)
  assert.equal(r.windows['24H'].conversion,10); assert.equal(r.state,'STOCK_RISK')
  assert.equal(projectGoldenMonitoringV1({...input,stock:{supplierAvailability:'OUT_OF_STOCK'}}).state,'UNPROVEN')
})
