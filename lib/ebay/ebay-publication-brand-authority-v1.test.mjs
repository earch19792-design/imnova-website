import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const fullPage = await import("./ebay-luna-full-page-required-facts-v1.ts")
const ownerPolicy = await import(
  "./ebay-owner-supplier-merchandise-policy-v1.ts")

const ACCOUNT = "account-test"
const POLICY_ID = "11111111-1111-4111-8111-111111111111"
const AUTHORIZATION_DIGEST = `sha256:${"c".repeat(64)}`

function durableBrandPolicy() {
  return ownerPolicy.validateLunaUnbrandedAfterFullPageReviewPolicyRowV1({
    id: POLICY_ID,
    marketplace_account_key: ACCOUNT,
    marketplace: "EBAY_US",
    supplier_code: "LUNA_PORTEX",
    policy_code: "LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW",
    policy_version: "LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW_V1",
    decision: "CERTIFIED",
    policy_payload: {
      statement: ownerPolicy.LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW_STATEMENT,
      conditionLabel: null,
      brandValue: "Unbranded",
      exactSupplierLineageRequired: true,
      productIdentityExactRequired: true,
      fullLunaPageEvidenceRequired: true,
      explicitLunaBrandPreserved: true,
      imageEvidenceReviewRequired: true,
      factInvented: false,
    },
    evidence_digest:
      ownerPolicy.lunaUnbrandedAfterFullPageReviewPolicyDigestV1(),
    authorization_reference_digest: AUTHORIZATION_DIGEST,
    certified_at: "2026-09-03T12:00:00.000Z",
    revoked_at: null,
  }, ACCOUNT)
}

function exactFixture(overrides = {}) {
  const imageUrls = overrides.image_urls ?? []
  const opportunity = {
    id: "queue-1",
    supplier_product_id: "100",
    supplier_variant_id: "200",
    supplier_sku: "SKU-1",
    assessment: {},
    ...overrides.opportunity,
  }
  const catalogRow = {
    supplier_product_id: opportunity.supplier_product_id,
    supplier_variant_id: opportunity.supplier_variant_id,
    sku: opportunity.supplier_sku,
    title: "Exact Luna product",
    variant_title: "Default",
    body_html: "",
    product_metadata: {},
    metadata: {},
    featured_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    ...overrides,
  }
  delete catalogRow.opportunity
  return { opportunity, catalogRow }
}

function withPolicyAndImageReview(fixture, brandEvidenceStatus =
  "NO_EXPLICIT_BRAND", explicitBrand = null) {
  const policy = durableBrandPolicy()
  const imageUrls = [...new Set([
    fixture.catalogRow.featured_image_url,
    ...fixture.catalogRow.image_urls,
  ].filter(Boolean))]
  const review = fullPage.buildLunaFullPageImageReviewV1({
    lunaProductId: fixture.opportunity.supplier_product_id,
    lunaVariantId: fixture.opportunity.supplier_variant_id,
    supplierSku: fixture.opportunity.supplier_sku,
    imageUrls,
    brandEvidenceStatus,
    explicitBrand,
    reviewedAt: "2026-09-03T12:05:00.000Z",
  })
  const application = ownerPolicy.buildOwnerLunaUnbrandedPolicyApplicationV1({
    policy,
    lunaProductId: fixture.opportunity.supplier_product_id,
    lunaVariantId: fixture.opportunity.supplier_variant_id,
    supplierSku: fixture.opportunity.supplier_sku,
    exactSupplierLineageCertified: true,
    productIdentityExact: true,
    appliedAt: "2026-09-03T12:06:00.000Z",
  })
  return { ...fixture, opportunity: { ...fixture.opportunity, assessment: {
    ...fixture.opportunity.assessment,
    lunaFullPageImageReviewV1: review,
    ownerLunaUnbrandedPolicyApplicationV1: application,
  } } }
}

const {publicationBrandAuthorityV1}=await import('../seller-os/publication-brand-authority-v1.ts')
function brandFixture(){
 const f=withPolicyAndImageReview(exactFixture({body_html:'A bracelet with charms'})),policy=durableBrandPolicy()
 const evidence=fullPage.buildLunaExactProductEvidenceSetV1(f)
 const rt={supplierProductId:f.opportunity.supplier_product_id,supplierVariantId:f.opportunity.supplier_variant_id,
 candidateKey:f.opportunity.candidate_key,lunaExactProductEvidenceSetV1:evidence,
 aspectContracts:[{name:'Brand',source:'EBAY_TAXONOMY_OFFICIAL_READONLY',freeTextAllowed:true,allowedValues:['Unbranded'],allowedValuesComplete:true}]}
 const opportunity={...f.opportunity,assessment:{...f.opportunity.assessment,canonicalMarketplaceReadinessV1:{requiredItemSpecificsTruth:rt}}}
 const policyRow={id:policy.id,marketplace_account_key:ACCOUNT,marketplace:'EBAY_US',supplier_code:'LUNA_PORTEX',
 policy_code:'LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW',policy_version:'LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW_V1',decision:'CERTIFIED',revoked_at:null,
 certified_at:policy.certifiedAt,evidence_digest:policy.evidenceDigest,authorization_reference_digest:policy.authorizationReferenceDigest,
 policy_payload:{statement:ownerPolicy.LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW_STATEMENT,conditionLabel:null,brandValue:'Unbranded',exactSupplierLineageRequired:true,
 productIdentityExactRequired:true,fullLunaPageEvidenceRequired:true,explicitLunaBrandPreserved:true,imageEvidenceReviewRequired:true,factInvented:false}}
 return {opportunity,policyRow,accountKey:ACCOUNT,aspects:{Brand:'Unbranded'},now:new Date('2026-09-11T08:00:00Z')}
}
test('qualified Unbranded is marketplace policy, never a supplier BRAND fact',()=>{
 const i=brandFixture(),before=JSON.stringify(i),r=publicationBrandAuthorityV1(i)
 assert.equal(r.supported,true);assert.equal(r.authorityClass,'MARKETPLACE_POLICY_VALUE');assert.equal(r.supplierFactProven,false)
 assert.equal(JSON.stringify(i),before)
})
test('unknown brand, revoked policy, wrong product, unreviewed images and forged evidence fail closed',()=>{
 for(const edit of [i=>i.policyRow.revoked_at='2026-09-10',i=>i.accountKey='OTHER',i=>i.opportunity.supplier_variant_id='OTHER',
 i=>delete i.opportunity.assessment.ownerLunaUnbrandedPolicyApplicationV1,
 i=>i.opportunity.assessment.canonicalMarketplaceReadinessV1.requiredItemSpecificsTruth.lunaExactProductEvidenceSetV1.allExactProductImagesReviewed=false,
 i=>i.opportunity.assessment.canonicalMarketplaceReadinessV1.requiredItemSpecificsTruth.lunaExactProductEvidenceSetV1.description='Manufacturer Brand: OTHER',
 i=>i.opportunity.assessment.canonicalMarketplaceReadinessV1.requiredItemSpecificsTruth.aspectContracts[0].allowedValues=[]]){
 const i=structuredClone(brandFixture());edit(i);assert.equal(publicationBrandAuthorityV1(i).supported,false)
 }
})

const {publicationRevisionPublisherViewV1}=await import('../seller-os/publication-revision-publisher-view-v1.ts')
test('current image contract supersedes only exact historical seven-image contradiction, never authorizes publish',()=>{
 const r={version:'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1',publicationId:'PUB',packageHash:'HASH',packageGeneration:'GEN'}
 const p={id:'PUB',sanitized_result:{publicationPreparationV1:{current:r}}},a={pass:true,packageHash:'HASH',generation:'GEN',imageCount:5,publicationAuthorized:false,marketplaceWrites:0}
 const good=publicationRevisionPublisherViewV1(p,a,'EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED')
 assert.equal(good.historicalPublisherContradictionSuperseded,true);assert.equal(good.publicationAuthorized,false);assert.match(good.status,/WAITING/)
 for(const patch of [{packageHash:'OTHER'},{generation:'OTHER'},{pass:false},{imageCount:0}])assert.equal(publicationRevisionPublisherViewV1(p,{...a,...patch},'EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED').historicalPublisherContradictionSuperseded,false)
 assert.equal(publicationRevisionPublisherViewV1(p,a,'IDENTITY_DRIFT').currentPublisherContradictionCount,1)
})
