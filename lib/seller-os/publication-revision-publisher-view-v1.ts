import { keywordRecord as record } from './keyword-intelligence-handoff-v1'
export function publicationRevisionPublisherViewV1(publication:unknown, assessment:unknown, historicalError:unknown) {
 const p=record(publication), r=record(record(record(p.sanitized_result).publicationPreparationV1).current), a=record(assessment)
 const resolution=record(record(record(p.sanitized_result).publicationPreparationV1).publisherResolutionV1)
 const durableSuperseded=resolution.issueSignature==='EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED' &&
  resolution.publisherContract==='SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1' && resolution.resolution==='SUPERSEDED' &&
  resolution.resolutionBasis==='CURRENT_CERTIFIED_FULL_SOURCE_GALLERY' && resolution.publicationId===p.id &&
  resolution.packageId===r.packageId && resolution.publicationAuthorized===false &&
  Number.isFinite(Date.parse(String(resolution.recordedAt))) &&
  /^sha256:[a-f0-9]{64}$/.test(String(resolution.imageSetDigest)) &&
  resolution.imageSetDigest===record(record(record(r.certifiedPackage).sourceProvenance).images).ownImageSetDigest
 const valid=a.pass===true && a.publicationAuthorized===false && a.marketplaceWrites===0 &&
  r.version==='SELLER_OS_PACKAGE_PREVIEW_REVISION_V1' && r.publicationId===p.id &&
  a.packageHash===r.packageHash && a.generation===r.packageGeneration && Number(a.imageCount)>0
 const superseded=(valid || durableSuperseded) && historicalError==='EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED'
 const currentViolation=a.contractVersion==='SELLER_OS_CURRENT_SOURCE_GALLERY_PUBLICATION_V1' &&
  a.currentViolationProven===true && a.packageHash===r.packageHash && a.generation===r.packageGeneration
 return {currentRevisionImageContractPass:valid,historicalPublisherContradictionSuperseded:superseded,
  currentPublisherContradictionCount:currentViolation || historicalError && !superseded?1:0,
  currentIssue:currentViolation?'CURRENT_GALLERY_PROVENANCE_MISMATCH':null,
  status:currentViolation?'REQUIRES_ATTENTION':superseded?valid?'WAITING_FOR_CURRENT_REVISION_PREPARATION':'WAITING_FOR_CURRENT_IMAGE_EVIDENCE':historicalError?'REQUIRES_ATTENTION':'WAITING_FOR_PREVALIDATION',
  historicalError:historicalError??null,publicationAuthorized:false}
}
