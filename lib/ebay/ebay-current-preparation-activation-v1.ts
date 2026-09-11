import { keywordRecord as record, keywordWireDigestV1 as digest } from '../seller-os/keyword-intelligence-handoff-v1'
import { currentUnpublishedPayloadAcceptedV1 } from './ebay-current-package-preparation-v1'

// Publication ledger stores SHA-256 hex; package receipts use the URI prefix.
// Compute from content, never assign an unrelated hash to bypass alignment.
export const currentPreviewLedgerHashV1=(preview:unknown)=>digest(preview).slice(7)

// Reconciliation of accepted non-LIVE work, not a new marketplace operation or
// publish grant. No historic approval, execution, or economics is an input.
export function currentPreparationActivationEvidenceV1(publication: unknown, preflight: unknown, now=new Date()) {
 const p=record(publication),prep=record(record(p.sanitized_result).publicationPreparationV1),r=record(prep.current),f=record(preflight)
 const read=record(f.currentOfferReadback),inventory=record(f.currentInventoryReadback),account=record(f.officialAccountPreflight)
 const age=now.getTime()-Date.parse(String(f.observedAt))
 const exact=currentUnpublishedPayloadAcceptedV1(p,r,now) && f.publicationId===p.id && f.packageId===p.listing_package_id &&
  f.packageHash===r.packageHash && f.packageGeneration===r.packageGeneration && f.previewHash===r.previewHash &&
  record(account.identity).status==='BOUND' && record(account.identity).accountFingerprint===p.account_fingerprint &&
  account.status==='READY' && f.currentPolicySelectionExact===true && record(f.officialCategoryPreflight).safe===true &&
  record(f.imageAuthority).pass===true && f.currentPreparationReceiptBound===true && inventory.safe===true &&
  read.safe===true && read.offerId===p.offer_id && read.sku===p.sku && read.status==='UNPUBLISHED' && read.listingPresent===false && read.payloadMatches===true &&
  Array.isArray(f.preflightErrors) && f.preflightErrors.length===0 && Array.isArray(f.warnings) && f.warnings.length===0 &&
  age>=0 && age<=120000 && p.phase==='preview_ready' && p.publish_attempt_count===0 && !p.publication_idempotency_key && !p.claim_token && !p.listing_id
 if(!exact)throw Error('CURRENT_PREPARATION_ACTIVATION_EVIDENCE_INVALID')
 const binding={publicationId:p.id,packageId:p.listing_package_id,accountKey:p.marketplace_account_key,sku:p.sku,offerId:p.offer_id,
  packageGeneration:r.packageGeneration,packageHash:r.packageHash,previewGeneration:r.revisionKey,previewHash:r.previewHash}
 return {version:'CURRENT_PREPARATION_ACTIVATION_V1',binding,key:digest(binding),observedAt:f.observedAt,
  inventoryReadback:inventory,offerReadback:read,publicationAuthorized:false,economicsInherited:false,
  authority:'CURRENT_OFFICIAL_READBACK_AND_EXISTING_PREPARATION_AUTHORITY'}
}

export function currentPreparationActivationReadbackV1(publication:unknown, execution:unknown, approval:unknown) {
 const p=record(publication), e=record(execution), approvalRow=record(approval)
 const prep=record(record(p.sanitized_result).publicationPreparationV1),r=record(prep.current),a=record(prep.activation)
 const proof=record(record(e.sanitized_result).currentPreparationActivationV1),b=record(proof.binding)
 const expected={publicationId:p.id,packageId:p.listing_package_id,accountKey:p.marketplace_account_key,sku:p.sku,offerId:p.offer_id,
  packageGeneration:r.packageGeneration,packageHash:r.packageHash,previewGeneration:r.revisionKey,previewHash:r.previewHash}
 return a.version==='CURRENT_PREPARATION_ACTIVATION_V1' && a.scope==='PREPARE_UNPUBLISHED_ONLY' &&
  a.publicationAuthorized===false && a.historicalExecutionReused===false &&
  a.previewHash===p.preview_hash && a.draftExecutionId===p.draft_execution_id && e.id===p.draft_execution_id && e.id!==r.priorDraftExecutionId &&
  a.draftApprovalId===p.draft_approval_id && e.approval_id===approvalRow.id && approvalRow.id===p.draft_approval_id &&
  e.phase==='completed' && e.offer_id===p.offer_id && e.sku===p.sku && e.actor_user_id===p.actor_user_id &&
  e.listing_package_id===p.listing_package_id && e.account_fingerprint===p.account_fingerprint &&
  approvalRow.actor_user_id===p.actor_user_id && approvalRow.listing_package_id===p.listing_package_id &&
  approvalRow.account_fingerprint===p.account_fingerprint && approvalRow.status==='consumed' &&
  approvalRow.approval_phrase_version==='CURRENT_PREPARATION_RECONCILIATION_V1' &&
  e.request_hash===approvalRow.payload_hash && proof.version==='CURRENT_PREPARATION_ACTIVATION_V1' &&
  digest(b)===digest(expected) && proof.key===digest(expected) && a.receiptBindingKey===proof.key &&
  proof.publicationAuthorized===false && proof.economicsInherited===false &&
  p.preview_hash===currentPreviewLedgerHashV1(r.preview) && digest(p.preview)===r.previewHash &&
  digest(record(approvalRow.approved_payload).inventoryItemPayload)===digest(record(r.preview).inventoryItemPayload) &&
  digest(record(approvalRow.approved_payload).offerPayload)===digest(record(r.preview).offerPayload) &&
  record(record(approvalRow.approved_payload).economics).historicalStateInherited===false &&
  p.phase==='preview_ready' && p.publish_attempt_count===0 && !p.publication_idempotency_key && !p.claim_token && !p.listing_id
}
