import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../../supabase/migrations/20261003033856_commercial_golden_path_v1.sql', import.meta.url), 'utf8')
const ownerTruthSql = readFileSync(new URL('../../supabase/migrations/20261003180449_seller_os_owner_product_truth_evidence_v1.sql', import.meta.url), 'utf8')
test('Golden SQL: syntax, closed permissions, immutable receipts and atomic fail-closed reconciliation', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.luna_catalog_snapshots_v1(snapshot_id uuid primary key,snapshot_status text,snapshot_completed_at timestamptz);
      create table public.luna_catalog_snapshot_variants_v1(snapshot_id uuid,product_id text,variant_id text,sku text,source_fingerprint text,preflight_status text);
      create function public.is_seller_os_service_role_request_v1() returns boolean language sql stable as $$select current_setting('request.jwt.claim.role',true)='service_role'$$;
      select set_config('request.jwt.claim.role','service_role',false);`)
    const authoritySql = readFileSync(new URL('../../supabase/migrations/20260919143000_stockguard_listing_link_authority_p0.sql', import.meta.url),'utf8').split('create or replace function public.prevent_seller_os_listing_link_event_mutation_v1')[0]
    await db.exec(authoritySql)
    await db.exec(readFileSync(new URL('../../supabase/migrations/20260924041700_seller_os_canonical_listing_cases_v1.sql',import.meta.url),'utf8'))
    await db.exec(sql)
    await db.exec(ownerTruthSql)
    await db.exec(readFileSync(new URL('../../supabase/migrations/20261003035030_commercial_golden_path_managed_birth_authority_v1.sql',import.meta.url),'utf8'))
    await db.exec(readFileSync(new URL('../../supabase/migrations/20261003041445_commercial_golden_path_shipping_cart_lease_v1.sql',import.meta.url),'utf8'))
    const permissions = (await db.query(`select has_table_privilege('anon','public.seller_os_golden_manual_market_v1','INSERT') as anon_write,has_function_privilege('authenticated','public.seller_os_golden_enroll_v1(text,uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE') as authenticated_execute`)).rows[0]
    assert.equal(permissions.anon_write, false); assert.equal(permissions.authenticated_execute, false)
    const ownerPermissions = (await db.query(`select has_table_privilege('anon','public.seller_os_golden_owner_product_truth_v1','SELECT') as anon_read,has_table_privilege('authenticated','public.seller_os_golden_owner_product_truth_v1','INSERT') as authenticated_write,has_table_privilege('service_role','public.seller_os_golden_owner_product_truth_v1','INSERT') as service_insert`)).rows[0]
    assert.equal(ownerPermissions.anon_read,false);assert.equal(ownerPermissions.authenticated_write,false);assert.equal(ownerPermissions.service_insert,true)
    const account = 'FIXTURE_ACCOUNT', owner = '10000000-0000-4000-8000-000000000001', packageId = '10000000-0000-4000-8000-000000000002'
    const candidate = { productId: '900000000001', variantId: '900000000002', supplierSku: 'FIXTURE_ONLY', supplierQuantity: 2 }
    await db.query(`insert into public.seller_os_golden_path_receipts_v1(receipt_id,account_key,owner_user_id,kind,evidence_digest,payload) values($1,$2,$3,'DRAFT',$4,$5)`, [packageId,account,owner,`sha256:${'a'.repeat(64)}`,JSON.stringify({state:'DRAFT_ONLY',published:false,candidate})])
    await assert.rejects(db.query(`update public.seller_os_golden_path_receipts_v1 set payload='{}' where receipt_id=$1`,[packageId]), /IMMUTABLE/)
    const ownerEvidenceId=`sha256:${'9'.repeat(64)}`, ownerSourceDigest=`sha256:${'8'.repeat(64)}`, ownerSourceFingerprint=`sha256:${'7'.repeat(64)}`
    const capturedAt='2026-10-03T16:41:37.0224509Z', canonicalUrl='https://lunaportex.com/products/fixture-only'
    const ownerEvidence={schemaVersion:'SELLER_OS_OWNER_PRODUCT_TRUTH_EVIDENCE_V1',evidenceId:ownerEvidenceId,evidenceDigest:ownerEvidenceId,authorityClass:'OWNER_ATTESTED_SUPPLIER_VISUAL_OBSERVATION',candidate:{...candidate,supplierQuantity:1},accountKey:account,ownerUserId:owner,canonicalUrl,sourceLocator:canonicalUrl,sourceMediaType:'IMAGE',capturedAt,evidenceStatement:'The supplied image visibly shows SAFARI on the physical product.',factClass:'VISIBLE_BRAND_MARKING',normalizedValue:'SAFARI',sourceDigest:ownerSourceDigest,sourceFingerprint:ownerSourceFingerprint,operatorAttested:true,manufacturerBrandPromoted:false,supplierTruthModified:false,unknownFieldsPromoted:false,marketplaceWrites:0,supplierPurchases:0,draftIsLive:false}
    await db.query(`insert into public.seller_os_golden_owner_product_truth_v1(evidence_id,account_key,owner_user_id,product_id,variant_id,supplier_sku,supplier_quantity,source_fingerprint,fact_class,normalized_value,source_digest,source_captured_at,payload) values($1,$2,$3,$4,$5,$6,1,$7,'VISIBLE_BRAND_MARKING','SAFARI',$8,$9,$10)`,[ownerEvidenceId,account,owner,candidate.productId,candidate.variantId,candidate.supplierSku,ownerSourceFingerprint,ownerSourceDigest,capturedAt,JSON.stringify(ownerEvidence)])
    await assert.rejects(db.query(`update public.seller_os_golden_owner_product_truth_v1 set normalized_value='OTHER' where evidence_id=$1`,[ownerEvidenceId]),/IMMUTABLE/)
    await assert.rejects(db.query(`delete from public.seller_os_golden_owner_product_truth_v1 where evidence_id=$1`,[ownerEvidenceId]),/IMMUTABLE/)
    await db.query(`insert into public.seller_os_golden_path_receipts_v1(receipt_id,account_key,owner_user_id,kind,evidence_digest,payload) values($1,$2,$3,'PRODUCT_TRUTH_INTAKE',$4,$5)`,['10000000-0000-4000-8000-000000000009',account,owner,ownerEvidenceId,JSON.stringify({evidenceId:ownerEvidenceId})])
    const payload = {status:'LIVE_VERIFIED',source:'EBAY_TRADING_GET_ITEM_READONLY',itemId:'999999999001',ownership:'verified',listingStatus:'Active',marketplaceSite:'US',sku:candidate.supplierSku,observedAt:new Date().toISOString()}
    const authority = {authority_id:'listing-link-authority-v1:sha256:'+'c'.repeat(64),account_key:account,ebay_item_id:payload.itemId,luna_product_id:candidate.productId,luna_variant_id:candidate.variantId,luna_sku:candidate.supplierSku,supplier_quantity_required:2,source_fingerprint:'fixture-fingerprint',seller_os_product_id:owner,components:[{lunaProductId:candidate.productId,lunaVariantId:candidate.variantId,lunaSku:candidate.supplierSku,supplierQuantityRequired:2}],identity_key:'listing-product-identity-v1:sha256:'+'d'.repeat(64),linkage_id:'luna-linkage-v1:sha256:'+'e'.repeat(64),source_decision_id:'luna-linkage-decision-v1:sha256:'+'f'.repeat(64)}
    const call = async (p = payload) => db.query(`select public.seller_os_golden_enroll_v1($1,$2,$3,$4,$5,$6,$7) as result`,[account,owner,packageId,'10000000-0000-4000-8000-000000000003',`sha256:${'b'.repeat(64)}`,JSON.stringify(p),JSON.stringify(authority)])
    for (const field of ['source','ownership','listingStatus','marketplaceSite','observedAt']) { const incomplete = {...payload}; delete incomplete[field]; await assert.rejects(call(incomplete), /OFFICIAL_BINDING_REQUIRED/) }
    await assert.rejects(call(), /CURRENT_LUNA_BINDING_REQUIRED/)
    assert.equal((await db.query('select count(*)::integer as n from public.seller_os_listing_product_link_authorities_v1')).rows[0].n,0)
    await db.query(`insert into public.luna_catalog_snapshots_v1 values($1,'COMPLETE',now())`,[owner])
    await db.query(`insert into public.luna_catalog_snapshot_variants_v1 values($1,$2,$3,$4,'fixture-fingerprint','PREFLIGHT_PASS')`,[owner,candidate.productId,candidate.variantId,candidate.supplierSku])
    await db.exec('set role service_role')
    assert.equal((await db.query("select has_table_privilege('service_role','public.seller_os_listing_product_link_authorities_v1','INSERT') as can_insert")).rows[0].can_insert,false)
    const result = (await call()).rows[0].result
    assert.equal((await db.query('select count(*)::integer as n from public.seller_os_listing_product_link_events_v1')).rows[0].n,1); assert.equal(result.stockguard_enrolled,true); assert.equal(result.analytics_enrolled,true); assert.equal(result.marketplace_actions_enabled,false)
    assert.deepEqual((await call()).rows[0].result,result)
    assert.equal((await db.query(`select count(*)::integer as n from public.seller_os_golden_managed_listings_v1`)).rows[0].n,1)
    const leaseId='10000000-0000-4000-8000-000000000004', otherId='10000000-0000-4000-8000-000000000005'
    const claim=async id=>(await db.query('select public.seller_os_claim_golden_shipping_cart_v1($1) as claimed',[id])).rows[0].claimed
    const release=async(id,restored)=>(await db.query('select public.seller_os_release_golden_shipping_cart_v1($1,$2) as released',[id,restored])).rows[0].released
    assert.equal(await claim(leaseId),true);assert.equal(await claim(otherId),false)
    assert.equal(await release(otherId,true),false);assert.equal(await release(leaseId,true),true)
    assert.equal(await claim(otherId),true);assert.equal(await release(otherId,false),true);assert.equal(await claim(leaseId),false)
    await db.query("update public.seller_os_golden_shipping_cart_leases_v1 set state='AVAILABLE'")
    assert.equal(await claim(leaseId),true)
    await db.query("update public.seller_os_golden_shipping_cart_leases_v1 set expires_at=now()-interval '1 second'")
    assert.equal(await claim(otherId),false)
    assert.equal((await db.query('select state from public.seller_os_golden_shipping_cart_leases_v1')).rows[0].state,'UNPROVEN')
  } finally { await db.close() }
})
