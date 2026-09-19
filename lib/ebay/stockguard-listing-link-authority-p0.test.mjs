import test from 'node:test'
import assert from 'node:assert/strict'
import { projectStockguardListingAuthorityP0,
 resolveCanonicalReverseListingAuthorityP0,
 parseListingAuthorityMutationP0 } from './stockguard-listing-link-authority-p0.ts'

const itemA='366666581320',itemB='366672502737',sku='IMN-LST-000027'
const authority={authority_id:'listing-link-authority-v1:sha256:'+'a'.repeat(64),account_key:'account',marketplace_id:'EBAY_US',
 ebay_item_id:itemA,ebay_sku:sku,seller_os_product_id:'11111111-1111-4111-8111-111111111111',luna_product_id:'9220815749344',
 luna_variant_id:'48809620930784',luna_sku:'ITEM5195',supplier_quantity_required:1,evidence_maximum_age_seconds:21600,
 components:[],identity_key:'listing-product-identity-v1:sha256:'+'b'.repeat(64),linkage_id:'luna-linkage-v1:sha256:'+'c'.repeat(64),
 source_decision_id:'luna-linkage-decision-v1:sha256:'+'d'.repeat(64),lifecycle_state:'ACTIVE',previous_authority_id:null,
 transition_reason_code:'CERTIFIED',actor_type:'SYSTEM',actor_reference:'SYSTEM:TEST',identity_preflight_status:'PREFLIGHT_PASS',
 source_fingerprint:'f',identity_engine_version:'V1_3',preflight_contract_version:'V1',activated_at:'2026-09-19T00:00:00Z',
 ended_at:null,created_at:'2026-09-19T00:00:00Z',updated_at:'2026-09-19T00:00:00Z'}
const live=[{ebay_item_id:itemA,ebay_sku:sku,listing_status:'active'},{ebay_item_id:itemB,ebay_sku:sku,listing_status:'active'}]
const quarantine={quarantine_id:'q',account_key:'account',marketplace_id:'EBAY_US',ebay_item_id:itemB,ebay_sku:sku,
 quarantine_state:'ACTIVE',reason_code:'DUPLICATE_LIVE_EBAY_SKU',conflicting_item_ids:[itemA],authority_id:null,
 observed_at:'2026-09-19T00:00:00Z',resolved_at:null}

test('canonical A remains authoritative while duplicate LIVE B cannot inherit identity',()=>{
 const a=projectStockguardListingAuthorityP0({listing:live[0],liveListings:live,authorities:[authority],quarantines:[quarantine]})
 const b=projectStockguardListingAuthorityP0({listing:live[1],liveListings:live,authorities:[authority],quarantines:[quarantine]})
 assert.equal(a.stockguardEligible,true);assert.equal(a.authority.luna_sku,'ITEM5195')
 assert.deepEqual(a.conflictingLiveItemIds,[itemB])
 assert.equal(b.stockguardEligible,false);assert.equal(b.authority,null)
 assert.equal(b.limitationCode,'QUARANTINED_DUPLICATE_SKU')
})

test('reverse lookup exposes lifecycle history but only one non-quarantined ACTIVE authority',()=>{
 const history={...authority,authority_id:'listing-link-authority-v1:sha256:'+'e'.repeat(64),lifecycle_state:'SUPERSEDED',ended_at:'2026-09-19T01:00:00Z'}
 const result=resolveCanonicalReverseListingAuthorityP0({identityKey:authority.identity_key,authorities:[history,authority],quarantines:[quarantine]})
 assert.equal(result.authoritative.authority_id,authority.authority_id)
  assert.deepEqual(result.history.map(row=>row.state).sort(),['ACTIVE','SUPERSEDED'])
  assert.equal(resolveCanonicalReverseListingAuthorityP0({lunaTuple:{productId:authority.luna_product_id,
    variantId:authority.luna_variant_id,sku:authority.luna_sku},authorities:[authority],quarantines:[]}).authoritative.ebay_item_id,itemA)
  assert.equal(resolveCanonicalReverseListingAuthorityP0({ebaySku:sku,
    authorities:[authority],quarantines:[]}).authoritative.ebay_item_id,itemA)
})

test('controlled operations require exact durable references and are deterministic',()=>{
 const unlink=parseListingAuthorityMutationP0({action:'UNLINK',ebayItemId:itemA,expectedAuthorityId:authority.authority_id,reasonCode:'OWNER_UNLINKED_LISTING_PRODUCT'})
 assert.equal(unlink.action,'UNLINK')
 assert.throws(()=>parseListingAuthorityMutationP0({action:'CREATE',ebayItemId:itemB,reasonCode:'CERTIFIED_LINK'}),/SOURCE_DECISION_REQUIRED/)
 assert.throws(()=>parseListingAuthorityMutationP0({action:'INVALIDATE',ebayItemId:itemA,expectedAuthorityId:'bad',reasonCode:'OWNER_INVALIDATED'}),/EXPECTED_ACTIVE_REQUIRED/)
})
