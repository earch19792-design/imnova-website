import { keywordRecord as record } from './keyword-intelligence-handoff-v1'
export function publicationRevisionPublisherViewV1(publication:unknown, assessment:unknown, historicalError:unknown) {
 const p=record(publication), r=record(record(record(p.sanitized_result).publicationPreparationV1).current), a=record(assessment)
 const valid=a.pass===true && a.publicationAuthorized===false && a.marketplaceWrites===0 &&
  r.version==='SELLER_OS_PACKAGE_PREVIEW_REVISION_V1' && r.publicationId===p.id &&
  a.packageHash===r.packageHash && a.generation===r.packageGeneration && Number(a.imageCount)>0
 const superseded=valid && historicalError==='EBAY_PUBLICATION_HIGH_QUALITY_EXACT_SEVEN_REQUIRED'
 return {currentRevisionImageContractPass:valid,historicalPublisherContradictionSuperseded:superseded,
  currentPublisherContradictionCount:historicalError && !superseded?1:0,
  status:superseded?'WAITING_FOR_CURRENT_REVISION_PREPARATION':historicalError?'REQUIRES_ATTENTION':'WAITING_FOR_PREVALIDATION',
  historicalError:historicalError??null,publicationAuthorized:false}
}
