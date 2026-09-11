import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const migration=readFileSync(new URL('../../supabase/migrations/20260911092221_publication_nonmaterial_evidence_refresh_v1.sql',import.meta.url),'utf8')
test('SQL: new image receipts preserve current gallery authority; resolution is idempotent and exact scoped',async()=>{
 const db=new PGlite()
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table public.ebay_authorized_listing_publications(id uuid primary key,listing_package_id uuid,opportunity_id uuid,actor_user_id uuid,marketplace_account_key text,sanitized_result jsonb,publish_attempt_count int,claim_token uuid,listing_id text);
 create table public.ebay_listing_packages(id uuid,status text,opportunity_id uuid,candidate_key text,account_key text,created_by uuid);
 create table public.ebay_luna_opportunity_queue(id uuid,supplier_product_id text,supplier_variant_id text,supplier_sku text,candidate_key text,assessment jsonb);
 create function public.publication_revision_content_matches_v1(jsonb,jsonb) returns boolean language sql as $$select $1#>'{snapshot,content}'=$1#>'{certifiedPackage,listingPackage,content}'$$;`)
 await db.exec(migration)
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];const [pub,pkg,op,actor]=ids
 const img={SOURCE_IMAGE_URL:'https://own/image',IMAGE_ORDINAL:1,CAPTURED_AT:'2020-01-01'},sha='sha256:'+'a'.repeat(64)
 const r={version:'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1',publicationId:pub,packageId:pkg,accountKey:'account',packageHash:sha,packageGeneration:'gen',preview:{},snapshot:{binding:{ACCOUNT_KEY:'account',PRODUCT_ID:'prod',VARIANT_ID:'var',SKU:'sku',CANDIDATE_KEY:'c',OPPORTUNITY_ID:op},content:{imageUrls:[img.SOURCE_IMAGE_URL]}},certifiedPackage:{listingPackage:{generation:'gen',content:{imageUrls:[img.SOURCE_IMAGE_URL]}},imageHandoffPass:true,competitorContaminationCount:0,unsupportedClaimCount:0,sourceProvenance:{images:{evidenceId:'old',ownImageSetDigest:sha,images:[img]}}}}
 const fact={FIELD:'IMAGES',EVIDENCE_STATUS:'PROVEN',SEMANTIC_CLASS:'FACT',CONTRADICTION:false,SOURCE_AUTHORITY:'SUPPLIER',EVIDENCE_ID:'new',OBSERVED_AT:'2020-01-02',VALUE:[{...img,CAPTURED_AT:'2020-01-02'}]}
 const own={lunaProductId:'prod',lunaVariantId:'var',supplierSku:'sku',productIdentityExact:true,exactSupplierLineageCertified:true,allExactProductImagesReviewed:true,imageSetDigest:sha,exactImageUrls:[img.SOURCE_IMAGE_URL]}
 const assessment={productTruth:{fieldTruthV1:{fields:[fact]}},canonicalMarketplaceReadinessV1:{requiredItemSpecificsTruth:{lunaExactProductEvidenceSetV1:own}}}
 await db.query('insert into public.ebay_authorized_listing_publications values($1,$2,$3,$4,$5,$6,0,null,null)',[pub,pkg,op,actor,'account',JSON.stringify({publicationPreparationV1:{current:r}})])
 await db.query("insert into public.ebay_listing_packages values($1,'approved',$2,'c','account',$3)",[pkg,op,actor])
 await db.query("insert into public.ebay_luna_opportunity_queue values($1,'prod','var','sku','c',$2)",[op,JSON.stringify(assessment)])
 const assess=async()=> (await db.query('select public.assess_publication_revision_images_v1($1,$2,$3) a',[pub,actor,'account'])).rows[0].a
 assert.equal((await assess()).pass,true)
 const resolve=async()=> (await db.query('select public.record_publication_publisher_resolution_v1($1,$2,$3) a',[pub,actor,'account'])).rows[0].a
 const first=await resolve();assert.equal(first.resolution,'SUPERSEDED');assert.deepEqual(await resolve(),first)
 assert.equal((await db.query('select public.assess_publication_revision_images_v1($1,$2,$3) a',[pub,actor,'wrong'])).rows[0].a.pass,false)
 fact.CONTRADICTION=true
 await db.query('update public.ebay_luna_opportunity_queue set assessment=$1 where id=$2',[JSON.stringify(assessment),op]);assert.equal((await assess()).pass,false)
 await assert.rejects(resolve(),/CURRENT_PUBLISHER_RESOLUTION_UNPROVEN/)
 fact.CONTRADICTION=false;fact.VALUE[0].SOURCE_IMAGE_URL='https://other/image'
 await db.query('update public.ebay_luna_opportunity_queue set assessment=$1 where id=$2',[JSON.stringify(assessment),op]);assert.equal((await assess()).pass,false)
 const saved=(await db.query('select sanitized_result from public.ebay_authorized_listing_publications where id=$1',[pub])).rows[0].sanitized_result
 assert.deepEqual(saved.publicationPreparationV1.current,r);assert.deepEqual(saved.publicationPreparationV1.publisherResolutionV1,first)
 }finally{await db.close()}
})
