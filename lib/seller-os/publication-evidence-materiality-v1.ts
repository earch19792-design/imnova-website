import { keywordRecord as record, keywordWireDigestV1 as digest, KEYWORD_DECISION_VERSION } from './keyword-intelligence-handoff-v1'
import { prepareSellOneLikeThisV1 } from './sell-one-like-this-v1'
import type { PipelineCurrentAuthorityV1 } from './listing-pipeline-consistency-v1'

// Only observation metadata is excluded. Values, authority classes, source
// locators, contradictions, hashes of image bytes and image order remain material.
const observationKeys = new Set(['EVIDENCE_ID', 'SOURCE_RECEIPT_ID', 'CAPTURED_AT', 'OBSERVED_AT', 'FRESH_UNTIL'])
export function observationIndependentFactV1(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const result = value.map(v => observationIndependentFactV1(v))
    return key === 'SOURCE_EVIDENCE' ? result.sort((a,b) => digest(a).localeCompare(digest(b))) : result
  }
  if (!value || typeof value !== 'object') return value
  const row=record(value), sources=Array.isArray(row.SOURCE_EVIDENCE)?row.SOURCE_EVIDENCE.map(record):[]
  const locators=[...new Set(sources.map(s=>s.SOURCE_LOCATOR_OR_FIELD))].filter(v=>typeof v==='string').sort()
  const result=Object.fromEntries(Object.entries(row).filter(([k]) => !observationKeys.has(k))
    .map(([k,v]) => [k, observationIndependentFactV1(v,k)]))
  // The reducer may select another member of the same corroborating source
  // set after refresh. Retain the full locator set, never an arbitrary locator.
  if (locators.length && locators.includes(String(row.SOURCE_LOCATOR_OR_FIELD))) result.SOURCE_LOCATOR_OR_FIELD=locators
  return result
}

export function sameKeywordSemanticsV1(old: unknown, current: unknown) {
  const a=record(old), b=record(current)
  const classes=(v:unknown)=>Object.fromEntries(Object.entries(record(v)).map(([k,terms])=>
    [k,Array.isArray(terms)?[...terms].sort():null]))
  return [a,b].every(k => k.STATUS==='ACCEPTED' && k.DECISION_VERSION===KEYWORD_DECISION_VERSION &&
    k.LEGACY_FALLBACK_USED===false && Array.isArray(k.BLOCKERS) && k.BLOCKERS.length===0) &&
    ['ACCOUNT_KEY','PRODUCT_ID','VARIANT_ID','CANDIDATE_KEY','OPPORTUNITY_ID'].every(k=>
      Boolean(record(a.BINDING)[k]) && record(a.BINDING)[k]===record(b.BINDING)[k]) &&
    digest(classes(a.CLASSIFICATIONS))===digest(classes(b.CLASSIFICATIONS))
}

// Re-evaluate the existing pure content producer. Its temporary result is used
// only for comparison: no package, revision, receipt or authorization is written.
export function publicationEvidenceMaterialityV1(existing:unknown, a:PipelineCurrentAuthorityV1) {
  const old=record(existing), oldContent=record(record(old.listingPackage).content)
  const current=prepareSellOneLikeThisV1(a)
  const facts=(v:unknown)=>Array.isArray(v)?v.map(record).map(f=>observationIndependentFactV1(f))
    .sort((x,y)=>String(record(x).FIELD).localeCompare(String(record(y).FIELD))):[]
  const previousFacts=facts(record(old.sourceProvenance).product), currentFacts=facts(current.sourceProvenance.product)
  const keywordSame=sameKeywordSemanticsV1(old.keyword,current.keyword)
  const truthSame=previousFacts.length>0 && digest(previousFacts)===digest(currentFacts)
  const contentSame=digest(oldContent)===digest(current.preview)
  const categoryAuthoritySame=record(record(record(old.commercialEnvelope).components).category).reference===
    record(record(record(current.commercialEnvelope).components).category).reference
  const equivalent=current.listingPackagePass && old.listingPackagePass===true &&
    old.competitorContaminationCount===0 && old.unsupportedClaimCount===0 && old.ownProductTruthWins===true &&
    digest(old.binding)===digest(current.binding) && old.sourcePackageId===current.sourcePackageId &&
    old.referenceItemId===current.referenceItemId && categoryAuthoritySame && keywordSame && truthSame && contentSame
  return {equivalent,classification:equivalent?'NON_MATERIAL':'MATERIAL_OR_UNPROVEN',
    keywordSemanticDecisionChanged:!keywordSame,productTruthMaterialChange:!truthSame,
    downstreamPackageValuesChanged:!contentSame,categoryAuthoritySame,
    currentKeywordFingerprint:current.keyword.INPUT_FINGERPRINT,previousKeywordFingerprint:record(old.keyword).INPUT_FINGERPRINT,
    previousFactSemanticDigest:digest(previousFacts),currentFactSemanticDigest:digest(currentFacts),
    currentSourceDigest:current.sourceDigest,packageWrites:0,previewWrites:0}
}
