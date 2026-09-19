import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql=readFileSync(new URL('../../supabase/migrations/20260919143000_stockguard_listing_link_authority_p0.sql',import.meta.url),'utf8')
const manual=readFileSync(new URL('./ebay-manual-listing-service.ts',import.meta.url),'utf8')
const route=readFileSync(new URL('../../app/api/admin/ebay/listings/register/route.ts',import.meta.url),'utf8')

test('migration defines lifecycle, immutable history and atomic bounded primitives',()=>{
 for(const state of ['ACTIVE','SUPERSEDED','UNLINKED','INVALIDATED']) assert.match(sql,new RegExp(`'${state}'`))
 for(const primitive of ['create','replace','unlink','invalidate']) assert.match(sql,new RegExp(`${primitive}_seller_os_listing_product_link_authority_v1`))
 assert.match(sql,/prevent_seller_os_listing_link_event_mutation_v1/)
 assert.match(sql,/pg_advisory_xact_lock/)
 assert.match(sql,/previous_authority_id/)
 assert.match(sql,/actor_reference/)
 assert.match(sql,/forwardReadback/)
  assert.match(sql,/reverseReadback/)
  assert.match(sql,/IDEMPOTENT_SUCCESS/)
  assert.match(sql,/LISTING_LINK_REPLACE_RESOLVER_PATCH_TARGET_UNPROVEN/)
  assert.match(sql,/coalesce\(v_existing\.decision_version,0\)\+1/)
})

test('controlled manual/API flow establishes authority before StockGuard and exposes lifecycle operations',()=>{
  const ensureAt=manual.indexOf('ensureStockguardAuthorityFromDecisionP0({')
  const refreshAt=manual.indexOf('refreshCertifiedManualListingStockGuard(',ensureAt)
  assert.ok(ensureAt>=0&&refreshAt>ensureAt)
  assert.match(route,/parseListingAuthorityMutationP0/)
  assert.match(route,/mutateStockguardListingLinkAuthorityP0/)
  assert.match(route,/MUTAR_AUTORIDAD_DE_VINCULO/)
})

test('uniqueness and duplicate-live policy preserve facts while blocking inherited authority',()=>{
 assert.match(sql,/seller_os_listing_link_one_active_item_v1/)
 assert.match(sql,/seller_os_listing_link_one_active_ebay_sku_v1/)
 assert.match(sql,/seller_os_listing_link_one_active_reverse_identity_v1/)
 assert.match(sql,/DUPLICATE_LIVE_EBAY_SKU/)
 assert.match(sql,/from public\.ebay_active_listings a\s+join public\.ebay_active_listings other/)
 assert.match(sql,/where not exists[\s\S]+lifecycle_state='ACTIVE'/)
 assert.doesNotMatch(sql,/delete from public\.ebay_active_listings/)
})

test('tombstones, pack identity and StockGuard authority fail closed',()=>{
 assert.match(sql,/LISTING_LINK_AUTHORITY_TOMBSTONE_REQUIRES_REPLACE/)
 assert.match(sql,/are_seller_os_luna_linkage_components_approvable_v1/)
 assert.match(sql,/LISTING_LINK_AUTHORITY_PACK_IDENTITY_INVALID/)
 assert.match(sql,/guard_seller_os_luna_stock_job_authority_p0/)
 assert.match(sql,/STOCKGUARD_CANONICAL_ACTIVE_LINK_AUTHORITY_REQUIRED/)
 assert.match(sql,/- 'canonicalSupplierLineage'/)
})

test('service role can read tables but mutations are RPC-only and migration is unapplied locally',()=>{
 assert.match(sql,/revoke all on table[\s\S]+service_role/)
 assert.match(sql,/grant select on table[\s\S]+to service_role/)
 assert.doesNotMatch(sql,/grant select, insert|grant select, update/)
 assert.match(sql,/grant execute on function public\.create_seller_os_listing_product_link_authority_v1/)
 assert.match(sql,/is_seller_os_service_role_request_v1/)
 assert.doesNotMatch(sql,/ebay_published_acquisition_identities\s+(?:drop|alter|create|insert|update|delete)/i)
})
