import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { keywordRecord as record, keywordWireDigestV1 as digest } from "../seller-os/keyword-intelligence-handoff-v1"
import { readCurrentDraftPreparationV1 } from "./ebay-current-package-preparation-server-v1"
import { currentPreparationBindingValidV1, currentPreparationVisualGateV1 } from "./ebay-current-package-preparation-v1"
import { prepareExistingUnpublishedRevisionV1 } from "./ebay-draft-only-gateway"

// Trusted server runtime only. Reuses the one publication intent; it never
// consumes the publish key or changes its phase, preview or historical ledger.
export async function executeCurrentUnpublishedPreparationV1(input: {
  supabase: SupabaseClient; accountKey: string; packageId: string; actor: string;
}, fetchImpl: typeof fetch = fetch) {
  const db=input.supabase
  const packageRead=await db.from("ebay_listing_packages")
    .select("id,created_by,account_key,candidate_key,opportunity_id,package_data")
    .eq("id",input.packageId).eq("created_by",input.actor).maybeSingle()
  if(packageRead.error || !packageRead.data)throw Error("CURRENT_PREPARATION_PACKAGE_NOT_FOUND")
  const pkg=record(packageRead.data)
  const opRead=await db.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku")
    .eq("id",String(pkg.opportunity_id)).maybeSingle()
  if(opRead.error || !opRead.data)throw Error("CURRENT_PREPARATION_PRODUCT_NOT_FOUND")
  const authority=await readCurrentDraftPreparationV1({...input,listingPackage:pkg})
  if(!authority || !currentPreparationBindingValidV1(authority,pkg,opRead.data,input.accountKey.split(":").at(-1)??"")
    || !currentPreparationVisualGateV1(authority).allowed)throw Error("CURRENT_PREPARATION_AUTHORITY_UNPROVEN")
  const r=record(authority.revision),p=record(r.preview)
  const readPub=async()=>{
    const result=await db.from("ebay_authorized_listing_publications")
      .select("id,updated_at,sanitized_result,offer_id,phase,publish_attempt_count,publication_idempotency_key,claim_token,listing_id")
      .eq("id",String(r.publicationId)).eq("marketplace_account_key",input.accountKey)
      .eq("actor_user_id",input.actor).eq("listing_package_id",input.packageId).single()
    const row=record(result.data),current=record(record(record(row.sanitized_result).publicationPreparationV1).current)
    if(result.error || row.phase!=="preview_ready" || row.publish_attempt_count!==0 || row.publication_idempotency_key
      || row.claim_token || row.listing_id || current.packageHash!==r.packageHash || current.packageGeneration!==r.packageGeneration
      || current.previewHash!==r.previewHash)throw Error("CURRENT_PREPARATION_CONCURRENT_CHANGE")
    return row
  }
  let pub=await readPub()
  const offerId=String(pub.offer_id??"")
  if(!/^[0-9]+$/.test(offerId))throw Error("EXISTING_UNPUBLISHED_OFFER_REQUIRED")
  const binding={publicationId:r.publicationId,packageId:input.packageId,accountKey:input.accountKey,
    offerId,sku:p.sku,packageHash:r.packageHash,packageGeneration:r.packageGeneration,previewHash:r.previewHash}
  const key=digest(binding)
  const cas=async(next:Record<string,unknown>)=>{
    const old=record(pub.sanitized_result)
    const result=await db.from("ebay_authorized_listing_publications")
      .update({sanitized_result:{...old,currentUnpublishedPreparationV1:next},updated_at:new Date().toISOString()})
      .eq("id",String(pub.id)).eq("updated_at",String(pub.updated_at))
      .eq("offer_id",offerId).is("claim_token",null).is("listing_id",null).is("publication_idempotency_key",null)
      .eq("sanitized_result->publicationPreparationV1->current->>packageHash",String(r.packageHash))
      .eq("sanitized_result->publicationPreparationV1->current->>packageGeneration",String(r.packageGeneration))
      .eq("sanitized_result->publicationPreparationV1->current->>previewHash",String(r.previewHash))
      .eq("phase","preview_ready").eq("publish_attempt_count",0)
      .select("id,updated_at,sanitized_result,offer_id,phase,publish_attempt_count,publication_idempotency_key,claim_token,listing_id").maybeSingle()
    if(result.error || !result.data)throw Error("CURRENT_PREPARATION_RESERVATION_CONFLICT")
    pub=record(result.data)
  }
  const result=await prepareExistingUnpublishedRevisionV1({accountKey:input.accountKey,offerId,sku:String(p.sku),
    inventoryItemPayload:record(p.inventoryItemPayload),offerPayload:record(p.offerPayload),
    reserveWrite:async(operation)=>{
      pub=await readPub()
      if(pub.offer_id!==offerId)throw Error("CURRENT_OFFER_ID_CHANGED")
      const prior=record(record(pub.sanitized_result).currentUnpublishedPreparationV1)
      if(prior.key && prior.key!==key)throw Error("CURRENT_PREPARATION_PREVIOUS_GENERATION_UNRECONCILED")
      const attempts=record(prior.attempts)
      // A durable attempted write is read-only on every replay, including timeout.
      if(attempts[operation])return false
      const fresh=await readCurrentDraftPreparationV1({...input,listingPackage:pkg})
      if(!fresh || fresh.revision.packageHash!==r.packageHash || fresh.revision.packageGeneration!==r.packageGeneration || fresh.revision.previewHash!==r.previewHash)throw Error("CURRENT_PREPARATION_REVALIDATION_CHANGED")
      await cas({...prior,version:"CURRENT_UNPUBLISHED_PREPARATION_V1",key,binding,
        attempts:{...attempts,[operation]:{reservedAt:new Date().toISOString()}},state:"READBACK_REQUIRED",publicationAuthorized:false})
      return true
    }},fetchImpl)
  pub=await readPub()
  const prior=record(record(pub.sanitized_result).currentUnpublishedPreparationV1)
  await cas({...prior,version:"CURRENT_UNPUBLISHED_PREPARATION_V1",key,binding,result,
    state:result.state,observedAt:new Date().toISOString(),publicationAuthorized:false})
  return {...result,binding,durableReceipt:true}
}
